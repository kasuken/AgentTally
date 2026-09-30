import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSessions, sortSessions, inWindow } from '../ui/js/selectors.js';
import { World } from '../ui/js/world.js';
import { HEX } from '../ui/js/sprites.js';
const now = 100_000_000;
const session = (key, status, age = 0, other = {}) => ({ key, status, lastTs: now - age, project: 'app', provider: 'codex', title: key, ...other });
const filters = { hidden: new Set(), window: '6h', status: 'all', query: '', project: '' };
test('attention remains visible outside the historical window, while old idle sessions age out', () => {
  for (const status of ['working','blocked','waiting']) assert.equal(inWindow(session(status,status,30*3600e3),'1h',now),true);
  assert.equal(inWindow(session('old','idle',2*3600e3),'1h',now),false);
});
test('live excludes sleeping/offline and only retains recent idle sessions', () => {
  const sessions = [session('active','working'),session('recent','idle',60e3),session('old','idle',16*60e3),session('closed','offline'),session('sleep','sleeping')];
  assert.deepEqual(selectSessions(sessions,{...filters,window:'live'},now).map(s=>s.key),['active','recent']);
});
test('search, provider, status, and full project path filters compose', () => {
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
  assert.equal(list[0].key,'z'); // sorting must not mutate snapshots
});
test('project sorting groups projects before prioritizing status', () => {
  const list = [session('b','blocked',0,{project:'B'}),session('a','working',0,{project:'A'})];
  assert.deepEqual(sortSessions(list,'project').map(s=>s.key),['a','b']);
});
test('world fit can show a large map in a small viewport', () => {
  const world = Object.assign(Object.create(World.prototype),{terrain:{minX:0,minY:0,maxX:1000,maxY:800},cam:{},cw:400,ch:300,userZoom:false,sizeBuffer(){}});
  world.fit();
  assert.ok(world.scale < 0.4);
  assert.ok(1000*world.scale <= 400 && 800*world.scale <= 300);
});
test('cursor-anchored zoom keeps the world point beneath the cursor stationary', () => {
  const world = Object.assign(Object.create(World.prototype),{cam:{x:20,y:30},cw:800,ch:600,scale:2,sizeBuffer(){}});
  const anchor = {x:600,y:120};
  const before = [world.cam.x+(anchor.x-400)/world.scale,world.cam.y+(anchor.y-300)/world.scale];
  world.zoom(1,anchor);
  assert.deepEqual([world.cam.x+(anchor.x-400)/world.scale,world.cam.y+(anchor.y-300)/world.scale],before);
});
test('empty map clears old terrain instead of allocating an invalid canvas', () => {
  const world = Object.assign(Object.create(World.prototype),{cells:[],terrain:{}});
  world.renderTerrain();
  assert.equal(world.terrain,null);
});
test('paused motion still applies new robot positions and camera focus', () => {
  const robot = {x:0,y:0,tx:20,ty:30,drone:false};
  const world = Object.assign(Object.create(World.prototype),{paused:true,cam:{x:0,y:0},cameraTarget:{x:40,y:50},robots:new Map([['r',robot]]),fx:[]});
  world.update(.03);
  assert.equal(robot.x,20); assert.equal(robot.y,30); assert.equal(robot.walking,false);
  assert.deepEqual(world.cam,{x:40,y:50});
});
test('fit frames the islands, not the surrounding water ring', () => {
  const terrain = {minX:-300,minY:-300,maxX:300,maxY:300,land:{minX:-100,minY:-50,maxX:100,maxY:50}};
  const world = Object.assign(Object.create(World.prototype),{terrain,cam:{},cw:800,ch:400,userZoom:false,sizeBuffer(){}});
  world.fit();
  assert.equal(world.cam.x,0);
  assert.ok(world.scale >= 2, `scale ${world.scale} should use the land bounds`);
});

test('fit leaves the land clear of the map controls and station guide', () => {
  for (const [cw, ch, top] of [[800, 400, 62], [390, 440, 86]]) {
    const land = {minX:-100,minY:-50,maxX:100,maxY:50};
    const world = Object.assign(Object.create(World.prototype), {terrain:{land},cam:{},cw,ch,userZoom:false,sizeBuffer(){}});
    world.fit();
    const screenTop = ch / 2 + (land.minY - HEX.h / 2 - world.cam.y) * world.scale;
    const screenBottom = ch / 2 + (land.maxY + HEX.h / 2 + HEX.side - world.cam.y) * world.scale;
    assert.ok(screenTop >= top - 0.01);
    assert.ok(screenBottom <= ch - 38 + 0.01);
  }
});

test('each project remains a separate island with all seven stations', () => {
  const world = Object.assign(Object.create(World.prototype), {
    projectOrder:Array.from({length:12}, (_, i) => `project-${i}`), projects:new Map(),
    cw:1200,ch:700,userPan:true,renderTerrain(){},
  });
  world.layout();
  const land = new Set(world.cells.filter(c => c.kind !== 'water').map(c => c.cell.join(',')));
  let islands = 0;
  while (land.size) {
    islands++;
    const pending = [land.values().next().value];
    land.delete(pending[0]);
    while (pending.length) {
      const [q,r] = pending.pop().split(',').map(Number);
      for (const [dq,dr] of [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]) {
        const key = `${q+dq},${r+dr}`;
        if (land.delete(key)) pending.push(key);
      }
    }
  }
  assert.equal(islands, world.projectOrder.length);
  for (const project of world.projects.values()) assert.equal(Object.keys(project.stations).length, 7);
});

// ---------------------------------------------------------------- pro workspace board
import { groupProjects, timelineTicks, eventTone, TIMELINE_MS } from '../ui/js/board.js';

test('board puts projects that need you first and keeps sub-agents under their parent', () => {
  const s = (key, status, other = {}) => ({ ...session(key, status, 0, other), toolCalls: 0, events: [], stations: [0,0,0,0,0,0] });
  const groups = groupProjects([
    s('busy', 'working', { project: 'a', cwd: '/a' }),
    s('child', 'working', { project: 'b', cwd: '/b', parent: 'parent' }),
    s('parent', 'waiting', { project: 'b', cwd: '/b' }),
    s('other', 'idle', { project: 'b', cwd: '/b' }),
    s('approval', 'blocked', { project: 'c', cwd: '/c' }),
  ]);
  assert.deepEqual(groups.map(g => g.name), ['c', 'b', 'a']);
  assert.deepEqual(groups[1].rows.map(r => [r.session.key, r.depth]), [['parent', 0], ['child', 1], ['other', 0]]);
});

test('timeline keeps only events from the last 30 minutes, placed by time', () => {
  const events = [
    { ts: now - TIMELINE_MS - 1, kind: 'tool', station: 'forge' },
    { ts: now - TIMELINE_MS / 2, kind: 'tool', station: 'terminal' },
    { ts: now, kind: 'think' },
    { ts: now - 1000, kind: 'system' },
  ];
  const ticks = timelineTicks(events, now);
  assert.deepEqual(ticks.map(t => [Math.round(t.left), t.tone]), [[50, 'terminal'], [100, 'hub']]);
  assert.equal(eventTone({ kind: 'user' }), 'user');
});

// ---------------------------------------------------------------- sub-agents
import { nestSubagents } from '../ui/js/selectors.js';

test('sub-agents are listed right under their parent, with a count of the busy ones', () => {
  const list = sortSessions([
    session('parent', 'waiting'),
    session('kid-a', 'working', 0, { parent: 'parent' }),
    session('other', 'blocked'),
    session('kid-b', 'idle', 0, { parent: 'parent' }),
    session('orphan', 'working', 0, { parent: 'gone' }),
  ]);
  const rows = nestSubagents(list);
  assert.deepEqual(rows.map((r) => [r.key, r.depth]), [['other', 0], ['parent', 0], ['kid-a', 1], ['kid-b', 1], ['orphan', 0]]);
  assert.deepEqual(rows[1].kids, { total: 2, working: 1 });
});
