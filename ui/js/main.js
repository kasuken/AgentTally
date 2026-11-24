import { Board, projectKey } from "./board.js";
import { SignalDeck } from "./signal-deck.js";
import { setupWorkspaceLayout } from "./workspace-layout.js";
import { providerMeta, STATUS_TEXT, describe, sessionAction, fileActivityOnly, escapeHtml as esc } from "./meta.js";
import { WINDOWS, selectSessions, matchesStatus, needsAttention, inWindow, streamEvents, livePresentation } from "./selectors.js";

const $ = (id) => document.getElementById(id);
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Preferences are optional. */ } };
setupWorkspaceLayout(load, save);
const params = new URLSearchParams(location.search);
const tauri = window.__TAURI__;
const demo = params.has("demo") || (!tauri && !params.has("live"));
const returnKey = `tally.live-return.${demo ? "demo" : "local"}`;
const staleMs = 12000;
const windowPref = load("tally.window", "live");
const sortPref = load("tally.sort", "attention");
const hiddenPref = load("tally.hidden", []);
const state = {
  snap: null, visible: [], received: 0, error: false, fixture: false,
  window: Object.hasOwn(WINDOWS, windowPref) ? windowPref : "live",
  sort: ["attention", "recent", "project"].includes(sortPref) ? sortPref : "attention",
  hidden: new Set(Array.isArray(hiddenPref) ? hiddenPref.filter((x) => typeof x === "string") : []),
  query: "", project: "", status: "all", selected: null, selectedEvent: null, opener: null,
};
// Visiting a report should not clear the current drill-down. Unlike durable
// source/time preferences, this handoff lives only in the same tab and mode.
try {
  const previous = JSON.parse(sessionStorage.getItem(returnKey));
  sessionStorage.removeItem(returnKey);
  if (previous) {
    for (const key of ["query", "project", "selected"]) if (typeof previous[key] === "string") state[key] = previous[key];
    if (["all", "attention", "working", "resting"].includes(previous.status)) state.status = previous.status;
    $("search").value = state.query;
  }
} catch { /* Per-tab storage is optional. */ }
const board = new Board($("board"), choose);
const deck = new SignalDeck(choose, (key) => { state.project = key; refresh(); });
const cache = new WeakMap();
const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const exactTime = (ts) => new Date(ts).toLocaleString();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const text = (el, value) => { if (el.textContent !== value) el.textContent = value; };
const html = (el, markup) => {
  if (cache.get(el) !== markup) { el.innerHTML = markup; cache.set(el, markup); }
};
const timestamp = (ts) => `<time datetime="${new Date(ts).toISOString()}" title="${esc(exactTime(ts))}">${esc(clock.format(ts))}</time>`;
const now = () => state.snap ? state.snap.now + Math.max(0, Date.now() - state.received) : Date.now();
const stale = () => state.error || (state.snap && (Date.now() - state.received > staleMs || Date.now() - state.snap.now > staleMs));
const hasFilters = () => !!(state.query.trim() || state.project || state.hidden.size || state.status !== "all" || state.window !== "live");

const streamRecords = new WeakMap();
const eventLabels = { tool: "Tool call", wait: "Wait recorded", reply: "Agent reply", think: "Thinking", user: "User message", done: "Turn complete", error: "Error" };

function choose(key, opener, event = null) {
  state.selected = key;
  state.selectedEvent = event;
  state.opener = opener;
  board.select(key);
  renderDetail();
  $("detail-title").focus({ preventScroll: true });
  $("detail").scrollIntoView({ block: "nearest" });
}

function closeDetail() {
  if (!state.selected) return;
  const key = state.selected;
  const fromStream = !!state.selectedEvent;
  state.selected = null;
  state.selectedEvent = null;
  board.select(null);
  renderDetail();
  renderStream();
  if (state.opener?.isConnected && !state.opener.closest("[hidden]")) state.opener.focus();
  else if (fromStream) $("feed-title").focus();
  else board.focus(key);
}

function acceptSnapshot(snap) {
  if (!snap || !Array.isArray(snap.sessions) || !Array.isArray(snap.providers) || !Number.isFinite(snap.now)) throw new Error("Invalid snapshot");
  // A slow bootstrap invoke may finish after a newer push. Re-reading the same
  // cached snapshot is not a heartbeat from the scanner.
  if (!state.snap || snap.now > state.snap.now) {
    state.snap = snap;
    state.received = Date.now();
  }
  state.error = false;
  refresh();
}

function renderConnection() {
  const failed = stale();
  const badge = $("source-badge");
  const source = demo ? "Browser demo" : state.fixture ? "Fixture playback" : "Local scanner";
  badge.dataset.mode = failed ? "error" : !state.snap ? "pending" : demo || state.fixture ? "sample" : "local";
  text(badge, failed ? `${source} · interrupted` : !state.snap ? "Connecting" : source);
  text($("source-note"), demo || state.fixture ? `${source}. Sample data only; no local logs connected.` : "Local activity only. No data leaves this machine.");
  text($("updated"), state.snap ? `Snapshot at ${clock.format(state.snap.now)}${failed ? " · stale" : ""}` : "No snapshot yet");
  $("connection-warning").hidden = !failed || !$("empty").hidden;
  if (!state.snap && failed) text($("overview-summary"), "No snapshot available.");
  if (failed) text($("connection-warning"), state.snap ? "Updates interrupted. Showing the last snapshot while the connection recovers." :
    `Scanner disconnected. Retrying automatically.${!tauri && !demo && !state.fixture ? " Browser live mode needs a running snapshot server." : ""}`);
}

function renderSummary() {
  const sessions = state.visible;
  const approvals = sessions.filter((s) => s.status === "blocked").length;
  const replies = sessions.filter((s) => s.status === "waiting").length;
  const counts = `${plural(sessions.length, "session")} across ${plural(new Set(sessions.map(projectKey)).size, "project")}.`;
  text($("overview-summary"), counts);
  document.title = `${approvals + replies ? `(${approvals + replies}) ` : ""}Live activity · AgentTally`;
}

function renderFilters() {
  $("window-filter").value = state.window;
  $("sort").value = state.sort;
  $("reset-filters").hidden = !hasFilters();
  text($("sources-button"), state.hidden.size ? `Sources (${state.hidden.size} hidden)` : "Sources");
  if (!state.snap) return;
  const projects = new Map(state.snap.sessions.map((s) => [projectKey(s), s.project]));
  if (state.project && !projects.has(state.project)) projects.set(state.project, state.project);
  const counts = new Map();
  for (const name of projects.values()) counts.set(name, (counts.get(name) || 0) + 1);
  html($("project-filter"), '<option value="">All projects</option>' + [...projects].sort((a,b) => a[1].localeCompare(b[1]))
    .map(([key,name]) => `<option value="${esc(key)}">${esc(counts.get(name) > 1 ? key : name)}</option>`).join(""));
  $("project-filter").value = state.project;
  const existing = new Map([...$("legend").children].map((b) => [b.dataset.p, b]));
  const at = now();
  for (const p of state.snap.providers) {
    let b = existing.get(p.key);
    existing.delete(p.key);
    if (!b) { b = document.createElement("button"); b.type = "button"; b.dataset.p = p.key; $("legend").append(b); }
    const count = state.snap.sessions.filter((s) => s.provider === p.key && inWindow(s, state.window, at)).length;
    const on = !state.hidden.has(p.key);
    b.disabled = !p.detected && !count && on;
    b.setAttribute("aria-pressed", on);
    b.title = b.disabled ? `${p.name} not detected` : `${on ? "Hide" : "Show"} ${p.name}`;
    text(b, `${p.name} (${count})`);
  }
  for (const old of existing.values()) old.remove();
}

let detailKey = null;
function renderDetail() {
  const s = state.visible.find((v) => v.key === state.selected);
  $("detail").hidden = $("detail-body").hidden = !s;
  $("feed").hidden = !!s;
  if (!s) { detailKey = null; return; }
  const event = state.selectedEvent;
  text($("detail-title"), event ? "Recorded event" : "Session details");
  $("event-reading").hidden = !event;
  if (event) {
    text($("event-kind"), eventLabels[event.kind] || "Event");
    text($("event-time"), exactTime(event.ts));
    $("event-time").dateTime = new Date(event.ts).toISOString();
    text($("event-description"), describe(event));
  }
  const scroll = detailKey === s.key ? $("detail-body").scrollTop : 0;
  if (s.key !== detailKey) text($("copy-status"), "");
  detailKey = s.key;
  const provider = providerMeta(s.provider).name;
  $("detail-status").className = `state ${s.status}`;
  text($("detail-status"), STATUS_TEXT[s.status]);
  text($("session-title"), s.title);
  text($("current-action"), sessionAction(s));
  $("attention-note").hidden = !needsAttention(s);
  text($("attention-note"), s.status === "blocked" ? `Review the permission request in ${provider}.` : `Continue the conversation in ${provider}.`);
  const parent = s.parent && state.snap.sessions.find((v) => v.key === s.parent);
  const kids = state.snap.sessions.filter((v) => v.parent === s.key);
  const tokens = (n, known) => Number.isFinite(n) && (known ?? n > 0) && !fileActivityOnly(s) ? n.toLocaleString() : "Not reported";
  const facts = [
    ["Project", s.cwd || s.project], s.branch && ["Branch", s.branch],
    ["Agent", [provider, s.client].filter(Boolean).join(" · ")], ["Model", s.model || "Not reported"],
    s.parent && ["Sub-agent", [s.role && s.role !== "subagent" ? s.role : null, parent ? `Child of ${parent.title}` : "Parent not in snapshot"].filter(Boolean).join(" · ")],
    kids.length && ["Sub-agents", `${kids.length} total, ${kids.filter((v) => v.status === "working").length} working`],
    ["Last seen", exactTime(s.lastTs)], s.started && ["Started", exactTime(s.started)],
    ["Tool calls", fileActivityOnly(s) ? "Not reported" : s.toolCalls.toLocaleString()],
    ["Input tokens", tokens(s.tokensIn, s.tokensInKnown)], ["Output tokens", tokens(s.tokensOut, s.tokensOutKnown)],
    ["Coverage", fileActivityOnly(s) ? "File activity only" : "Recent local log records"],
  ].filter(Boolean);
  html($("facts"), facts.map(([k,v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join(""));
  $("copy-path").disabled = !s.cwd;
  const events = [...s.events].sort((a,b) => b.ts - a.ts);
  html($("recent"), events.length ? events.map((e) => `<li>${timestamp(e.ts)}${esc(describe(e))}</li>`).join("") : `<li>${fileActivityOnly(s) ? "This source reports file changes, not detailed events." : "No detailed events were recorded."}</li>`);
  $("detail-body").scrollTop = scroll;
}

function renderStream() {
  if (state.selected) return;
  const list = $("activity-log");
  const rows = streamEvents(state.visible);
  const existing = new Map([...list.children].map((node) => [node.dataset.row, node]));
  const active = document.activeElement, scroll = list.scrollTop;
  // Keep the event being read in place when new entries arrive above it.
  const anchor = scroll > 0 && !list.closest("[hidden]") ?
    [...list.children].find((row) => row.getBoundingClientRect().bottom > list.getBoundingClientRect().top) : null;
  const top = anchor?.getBoundingClientRect().top;
  rows.forEach(({ key, s, e }, i) => {
    let node = existing.get(key);
    existing.delete(key);
    if (!node) { node = document.createElement("li"); node.dataset.row = key; node.append(document.createElement("button")); }
    const b = node.firstElementChild;
    streamRecords.set(b, e);
    b.type = "button"; b.dataset.key = s.key;
    b.setAttribute("aria-controls", "detail");
    b.title = `${s.title}: ${describe(e)}`;
    html(b, `${timestamp(e.ts)}<span class="stream-entry"><span class="who"><strong>${esc(providerMeta(s.provider).name)}</strong><small>${esc(s.project)}</small></span><span class="what">${esc(describe(e))}</span></span>`);
    if (list.children[i] !== node) list.insertBefore(node, list.children[i] || null);
  });
  for (const node of existing.values()) node.remove();
  if (active?.isConnected && active !== document.activeElement) active.focus({ preventScroll: true });
  if (anchor?.isConnected) list.scrollTop += anchor.getBoundingClientRect().top - top;
  else list.scrollTop = scroll;
  $("log-empty").hidden = !!rows.length;
  if (!rows.length) text($("log-empty"), "No detailed events in this view.");
}

function renderEmpty(mode, at, focus) {
  const empty = mode !== "sessions";
  $("main").classList.toggle("empty-workspace", empty);
  $("empty").hidden = !empty;
  $("workspace").hidden = empty;
  if (!empty) {
    if ($("empty").contains(focus)) board.focus();
    return;
  }
  const recent = mode === "standby" ? state.snap.sessions.reduce((latest, s) =>
    s.lastTs > 0 && inWindow(s, "24h", at) && (!latest || s.lastTs > latest.lastTs) ? s : latest, null) : null;
  const copy = {
    standby: ["Standing by for activity", demo || state.fixture
      ? "No live sessions in this sample. New activity will appear here automatically."
      : recent ? "AgentTally is watching local logs. New activity will appear here automatically."
      : "Start a task in Claude Code, Codex, or another supported agent. Its activity will appear here as soon as AgentTally picks up the log."],
    "no-results": ["No matching sessions", "Try a different project, source, search or time window."],
    connecting: ["Connecting to the scanner", "Sessions will appear after the first scan."],
    unavailable: ["Scanner unavailable", !tauri && !demo && !state.fixture ? "Browser live mode needs a running snapshot server. Retrying automatically." : "No snapshot is available yet. Retrying automatically."],
    stale: ["Updates interrupted", "There were no matching sessions in the last snapshot. Retrying automatically."],
  };
  const [title, message] = copy[mode];
  $("empty").dataset.state = mode;
  text($("empty-title"), title);
  text($("empty-message"), message);
  $("empty-history").hidden = !recent;
  $("empty-sources").hidden = mode !== "standby" || !!recent;
  $("last-session").hidden = !recent;
  if (recent) text($("last-session"), `Last seen: ${recent.project} · ${exactTime(recent.lastTs)}`);
  $("empty-reset").hidden = mode !== "no-results";
  if (!focus.isConnected || $("workspace").contains(focus) || focus === $("toggle-overview") ||
      $("overview").contains(focus) || ($("empty").contains(focus) && focus.hidden)) $("empty-title").focus({ preventScroll: true });
}

function refresh() {
  const focus = document.activeElement;
  const at = stale() && state.snap ? state.snap.now : now();
  const scope = state.snap ? selectSessions(state.snap.sessions, { ...state, status: "all", project: "" }, at) : [];
  const projectScope = state.project ? scope.filter((s) => projectKey(s) === state.project) : scope;
  const mapSessions = scope.filter((s) => matchesStatus(s, state.status));
  state.visible = state.project ? mapSessions.filter((s) => projectKey(s) === state.project) : mapSessions;
  for (const button of $("status-lenses").children) {
    const status = button.dataset.status;
    button.setAttribute("aria-pressed", String(state.status === status));
    text(button.lastElementChild, state.snap ? String(projectScope.filter((s) => matchesStatus(s, status)).length) : "–");
  }
  const mode = livePresentation(state.snap, state.visible, { filtered: hasFilters(), interrupted: stale() });
  if (mode === "sessions") deck.render({ sessions: state.visible, mapSessions, at, project: state.project,
    connected: !stale(), hasSnapshot: !!state.snap, filtered: hasFilters() });
  if (state.snap) {
    if (!state.visible.some((s) => s.key === state.selected)) {
      state.selected = null;
      state.selectedEvent = null;
    }
    board.render(state.visible, state.selected, state.sort, at);
    renderSummary(); renderDetail(); renderStream();
  }
  renderFilters(); renderEmpty(mode, at, focus); renderConnection();
}

function resetFilters() {
  state.query = state.project = ""; state.status = "all"; state.hidden.clear(); state.window = "live";
  $("search").value = ""; save("tally.hidden", []); save("tally.window", state.window);
  refresh(); $("search").focus();
}
$("sources-button").onclick = () => {
  $("sources").hidden = !$("sources").hidden;
  $("sources-button").setAttribute("aria-expanded", !$("sources").hidden);
};
$("legend").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  const key = b.dataset.p;
  if (state.hidden.has(key)) state.hidden.delete(key); else state.hidden.add(key);
  save("tally.hidden", [...state.hidden]); refresh();
};
$("search").oninput = (e) => { state.query = e.target.value; refresh(); };
$("project-filter").onchange = (e) => { state.project = e.target.value; refresh(); };
$("status-lenses").onclick = (e) => {
  const button = e.target.closest("button[data-status]");
  if (button) { state.status = button.dataset.status; refresh(); }
};
$("window-filter").onchange = (e) => { state.window = e.target.value; save("tally.window", state.window); refresh(); };
$("sort").onchange = (e) => { state.sort = e.target.value; save("tally.sort", state.sort); refresh(); };
$("reset-filters").onclick = $("empty-reset").onclick = resetFilters;
$("empty-history").onclick = () => {
  state.window = "24h"; save("tally.window", state.window);
  refresh(); $("window-filter").focus();
};
$("empty-sources").onclick = () => {
  if ($("sources").hidden) $("sources-button").click();
  $("sources-button").focus();
};
$("activity-log").onclick = (e) => { const b = e.target.closest("button"); if (b) choose(b.dataset.key, b, streamRecords.get(b)); };
$("close-detail").onclick = closeDetail;
$("focus-agent").onclick = () => board.focus(state.selected);
$("copy-path").onclick = async () => {
  const s = state.visible.find((v) => v.key === state.selected);
  if (!s?.cwd) return;
  let result = "Project path copied.";
  try { await navigator.clipboard.writeText(s.cwd); } catch { result = "Clipboard unavailable. Select and copy the path above."; }
  if (state.selected === s.key) text($("copy-status"), result);
};
$("help-button").onclick = () => $("help").showModal();
$("close-help").onclick = () => $("help").close();
addEventListener("keydown", (e) => {
  if ($("help").open || e.ctrlKey || e.altKey || e.metaKey) return;
  const typing = e.target.closest?.("input, textarea, select, [contenteditable=true]");
  if (e.key === "Escape") { if (typing) e.target.blur(); else closeDetail(); return; }
  if (typing) return;
  if (e.key === "/") { e.preventDefault(); $("search").focus(); }
  if (e.key.toLowerCase() === "f") board.focus();
  if (e.key === "?") $("help").showModal();
});

const modeQuery = demo ? "?demo" : params.has("live") ? "?live" : "";
function rememberLiveView(event) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  const { query, project, status, selected } = state;
  try { sessionStorage.setItem(returnKey, JSON.stringify({ query, project, status, selected })); } catch { /* Optional. */ }
}
for (const link of [$("usage-link"), $("impact-link")]) {
  link.href = link.getAttribute("href") + modeQuery;
  link.addEventListener("click", rememberLiveView);
}
document.querySelector('nav a[aria-current="page"]').href = `index.html${modeQuery}`;
function failed() { state.error = true; refresh(); }
async function start() {
  refresh();
  if (demo) {
    const { createDemo } = await import("./demo.js");
    const sim = createDemo();
    acceptSnapshot(sim.tick());
    setInterval(() => acceptSnapshot(sim.tick()), 1200);
    return;
  }
  let listening = false;
  const started = Date.now();
  async function pull() {
    try {
      if (tauri) {
        if (!listening) {
          await tauri.event.listen("tally", ({ payload }) => { try { acceptSnapshot(payload); } catch { failed(); } });
          listening = true;
        }
        if (!state.received || Date.now() - state.received > 5000) {
          const snap = await tauri.core.invoke("snapshot");
          if (snap) acceptSnapshot(snap);
          else if (Date.now() - started > staleMs) failed();
        }
      } else {
        const response = await fetch("/api/snapshot", { cache: "no-store", signal: AbortSignal.timeout(10000) });
        state.fixture = response.headers.get("X-AgentTally-Fixture") === "1";
        if (!response.ok) throw new Error("Scan failed");
        acceptSnapshot(await response.json());
      }
    } catch { failed(); }
    setTimeout(pull, tauri ? 2500 : 1200);
  }
  setInterval(() => { if (!state.received || Date.now() - state.received > 5000) refresh(); }, 5000);
  await pull();
}
start().catch(failed);
