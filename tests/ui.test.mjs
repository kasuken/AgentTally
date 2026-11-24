import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSessions, sortSessions, inWindow, nestSubagents, streamEvents, livePresentation } from '../ui/js/selectors.js';
import { groupProjects, timelineTicks, eventTone, TIMELINE_MS } from '../ui/js/board.js';
import { sessionAction } from '../ui/js/meta.js';
import { priorityQueue, projectSignals } from '../ui/js/signal-deck.js';

const now = 100_000_000;
const session = (key, status, age = 0, other = {}) => ({
  key, status, lastTs: now - age, project: 'app', provider: 'codex', title: key, events: [], ...other,
});
const filters = { hidden: new Set(), window: '6h', status: 'all', query: '', project: '' };

test('the inbox exposes every request, approvals before replies, then falls back to working sessions only', () => {
  const list = [session('reply','waiting'),session('approval','blocked'),session('busy','working',500),session('fresh','working')];
  const queued = () => priorityQueue(list).map(s => s.key);
  assert.deepEqual(queued(),['approval','reply']);
  list[0].status = 'working';
  assert.deepEqual(queued(),['approval']);
  list[1].status = 'idle';
  assert.deepEqual(queued(),['busy','fresh','reply']);
  assert.deepEqual(priorityQueue([list[1]]),[]);
});
test('project signal counts recorded events at minute boundaries without merging names or inferring duration', () => {
  const start = now - TIMELINE_MS;
  const event = (ts,kind='tool') => ({ts,kind});
  const a = session('one','working',0,{cwd:'/one/app',events:[event(start-1),event(start),event(start+7*60000),event(now),event(now+1)]});
  const b = session('two','working',0,{cwd:a.cwd,events:[event(now,'wait'),event(now,'system')]});
  const c = session('three','working',0,{cwd:'/two/app',presenceOnly:true});
  const [first,second] = projectSignals([c,a,b],now);
  assert.equal(first.key,a.cwd); assert.equal(first.total,4);
  assert.deepEqual(first.bins.flatMap((n,i)=>n ? [[i,n]] : []),[[0,1],[7,1],[29,2]]);
  assert.deepEqual([...first.waits],[29]);
  assert.equal(second.key,c.cwd); assert.equal(second.total,0);
});

test('attention stays visible outside the historical window, while old idle sessions age out', () => {
  for (const status of ['working','blocked','waiting']) assert.equal(inWindow(session(status,status,30*3600e3),'1h',now),true);
  assert.equal(inWindow(session('old','idle',2*3600e3),'1h',now),false);
});
test('live excludes sleeping/offline and only retains recent idle sessions', () => {
  const sessions = [session('active','working'),session('recent','idle',60e3),session('old','idle',16*60e3),session('closed','offline'),session('sleep','sleeping')];
  assert.deepEqual(selectSessions(sessions,{...filters,window:'live'},now).map(s=>s.key),['active','recent']);
});
test('standby depends on the live window, not whether the scanner knows any sessions', () => {
  const mode = (sessions, f = {...filters, window:'live'}) =>
    livePresentation({sessions}, selectSessions(sessions, f, now), {filtered:f.window !== 'live' || !!f.query});
  const old = session('prior', 'idle', 2 * 3600e3);
  assert.equal(mode([]), 'standby');
  assert.equal(mode([old]), 'standby');
  for (const status of ['idle','working','blocked','waiting']) assert.equal(mode([old,session('new',status)]), 'sessions');
  assert.equal(mode([old], {...filters, window:'24h'}), 'sessions');
  assert.equal(mode([old], {...filters, window:'24h', query:'absent'}), 'no-results');
});
test('a missing or interrupted snapshot never implies the scanner is on standby', () => {
  const snapshot = {sessions: [session('cached','working')]};
  assert.equal(livePresentation(null, [], {}), 'connecting');
  assert.equal(livePresentation(null, [], {interrupted:true}), 'unavailable');
  assert.equal(livePresentation(snapshot, [], {interrupted:true}), 'stale');
  assert.equal(livePresentation(snapshot, snapshot.sessions, {interrupted:true}), 'sessions');
});
test('search, provider, status and full project path filters compose', () => {
  const sessions = [session('a','blocked',0,{cwd:'C:/one/app',title:'Fix login'}),session('b','waiting',0,{cwd:'C:/two/app',title:'Fix login'}),session('c','blocked',0,{cwd:'C:/one/app',title:'Fix login',provider:'claude'})];
  const f = {...filters,query:' LOGIN ',project:'C:/one/app',status:'attention',hidden:new Set(['claude'])};
  assert.deepEqual(selectSessions(sessions,f,now).map(s=>s.key),['a']);
  assert.equal(selectSessions(sessions,{...f,query:'not found'},now).length,0);
});
test('all resting states are included, without active sessions', () => {
  const list = ['idle','sleeping','offline','working','waiting'].map(s=>session(s,s));
  assert.deepEqual(selectSessions(list,{...filters,status:'resting'},now).map(s=>s.key),['idle','sleeping','offline']);
});
test('search accepts visible provider names, not only internal provider keys', () => {
  const sessions = [session('a','working',0,{provider:'vscode'}),session('b','working',0,{provider:'claude'})];
  assert.deepEqual(selectSessions(sessions,{...filters,query:'Copilot Chat'},now).map(s=>s.key),['a']);
  assert.deepEqual(selectSessions(sessions,{...filters,query:'Claude Code'},now).map(s=>s.key),['b']);
});
test('default order prioritizes approvals and remains stable as working logs update', () => {
  const list = [session('z','working'),session('a','working',1000),session('w','waiting'),session('b','blocked')];
  assert.deepEqual(sortSessions(list).map(s=>s.key),['b','w','a','z']);
  list[0].lastTs += 1000;
  assert.deepEqual(sortSessions(list).map(s=>s.key),['b','w','a','z']);
  assert.equal(sortSessions(list,'recent')[0].key,'z');
  assert.equal(list[0].key,'z');
});
test('project sorting groups projects before prioritizing status', () => {
  const list = [session('b','blocked',0,{project:'B'}),session('a','working',0,{project:'A'})];
  assert.deepEqual(sortSessions(list,'project').map(s=>s.key),['a','b']);
});
test('board sorts projects by attention, activity or name without separating children', () => {
  const sessions = [
    session('busy', 'working', 500, { project: 'A', cwd: '/a' }),
    session('child', 'working', 0, { project: 'B', cwd: '/b', parent: 'parent' }),
    session('parent', 'waiting', 1200, { project: 'B', cwd: '/b' }),
    session('other', 'idle', 1500, { project: 'B', cwd: '/b' }),
    session('approval', 'blocked', 1000, { project: 'C', cwd: '/c' }),
  ];
  const order = (sort) => groupProjects(sessions, sort).map(g => g.name);
  assert.deepEqual(order(), ['C','B','A']);
  assert.deepEqual(order('recent'), ['B','A','C']);
  assert.deepEqual(order('project'), ['A','B','C']);
  assert.deepEqual(groupProjects(sessions)[1].rows.map(r => [r.session.key,r.depth]), [['parent',0],['child',1],['other',0]]);
});
test('timeline places observations on a shared axis without extending to future events', () => {
  const events = [
    { ts: now - TIMELINE_MS - 1, kind: 'tool', station: 'forge' },
    { ts: now - TIMELINE_MS / 2, kind: 'tool', station: 'terminal' },
    { ts: now, kind: 'think' }, { ts: now - 1000, kind: 'system' }, { ts: now + 1, kind: 'tool' },
  ];
  assert.deepEqual(timelineTicks(events, now).map(t => [Math.round(t.left), t.tone]), [[50, 'terminal'], [100, 'hub']]);
  assert.equal(eventTone({ kind: 'user' }), 'user');
});
test('an approval request from a nested agent brings its entire branch to the front', () => {
  const list = [
    session('parent','idle'), session('sibling','working',0,{parent:'parent'}), session('unrelated','waiting'),
    session('intermediate','idle',0,{parent:'parent'}), session('approval','blocked',0,{parent:'intermediate'}),
  ];
  assert.deepEqual(groupProjects(list)[0].rows.map(r=>[r.session.key,r.depth]),[
    ['parent',0],['intermediate',1],['approval',2],['sibling',1],['unrelated',0],
  ]);
});
test('sub-agents are listed right under their parent, with a count of the busy ones', () => {
  const rows = nestSubagents(sortSessions([
    session('parent','waiting'),session('kid-a','working',0,{parent:'parent'}),session('other','blocked'),
    session('kid-b','idle',0,{parent:'parent'}),session('orphan','working',0,{parent:'gone'}),
  ]));
  assert.deepEqual(rows.map(r=>[r.key,r.depth]),[['other',0],['parent',0],['kid-a',1],['kid-b',1],['orphan',0]]);
  assert.deepEqual(rows[1].kids,{total:2,working:1});
});
test('stream rows survive equal timestamps, insertions, and sessions with no detailed events', () => {
  const first = session('a','working',0,{events:[
    {ts:10,kind:'tool',tool:'view',text:'x'}, {ts:10,kind:'tool',tool:'view',text:'y'}, {ts:12,kind:'think',text:''},
  ]});
  const second = session('b','idle');
  const before = streamEvents([first,second]).map(r => r.key);
  assert.equal(before.length, 2); assert.notEqual(...before);
  second.events.push({ts:20,kind:'done',text:'ok'});
  const after = streamEvents([first,second]);
  assert.equal(after[0].s.key, 'b'); assert.deepEqual(after.slice(1).map(r=>r.key), before);
});
test('presence-only observations never imply a reported action or an idle session', () => {
  const placeholder = session('legacy','working',0,{presenceOnly:true});
  assert.equal(sessionAction(placeholder),'File activity only');
  assert.equal(sessionAction({...placeholder,presenceOnly:false}),'No action reported');
  assert.equal(sessionAction(session('read','working',0,{current:{kind:'tool',station:'library',tool:'Read',text:'app.js'}})),'Read: app.js');
});
