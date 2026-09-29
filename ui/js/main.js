// Local-only dashboard controller. UI filters never change the underlying sessions.
import { World } from "./world.js";
import { robotSprite } from "./sprites.js";
import { providerMeta, STATUS, STATIONS, KIND_ICON, ago, compact, describe, escapeHtml as esc } from "./meta.js";
import { createDemo } from "./demo.js";
import { WINDOWS, selectSessions, sortSessions, needsAttention, isResting, inWindow } from "./selectors.js";

const $ = (id) => document.getElementById(id);
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage is optional. */ } };
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const storedWindow = load("tally.window", "6h");
const storedHidden = load("tally.hidden", []);
const storedSort = load("tally.sort", "attention");
const state = {
  snap: null, visible: [], scope: [], window: Object.hasOwn(WINDOWS, storedWindow) ? storedWindow : "6h",
  hidden: new Set(Array.isArray(storedHidden) ? storedHidden.filter((x) => typeof x === "string") : []),
  status: "all", query: "", project: "", sort: ["attention", "recent", "project"].includes(storedSort) ? storedSort : "attention",
  selected: null, received: 0, skew: 0, mode: "connecting", error: false,
  paused: load("tally.paused", motionPreference.matches) === true,
};
const world = new World($("world"), { onSelect: (key) => { state.selected = key; renderSide(); renderRoster(); } });
const now = () => Date.now() - state.skew;
const statusLabel = (s) => ({ blocked: "Needs approval", waiting: "Your turn", working: "Working", idle: "Idle", sleeping: "Sleeping", offline: "Offline" })[s];
const projectKey = (s) => s.cwd || s.project;
const exactTime = (ts) => new Date(ts).toLocaleString();
const time = (ts) => `<time data-ts="${ts}" title="${esc(exactTime(ts))}">${ago(now() - ts)}</time>`;
const portraits = new Map();
function portrait(provider, status) {
  const key = provider + status;
  if (!portraits.has(key)) portraits.set(key, robotSprite({ provider, legs: providerMeta(provider).hover ? "hover" : "stand", arms: false,
    eyes: status === "offline" ? "off" : status === "sleeping" ? "closed" : "open", chest: STATUS[status]?.color, gray: status === "offline" }).toDataURL());
  return portraits.get(key);
}
const markupCache = new WeakMap();
function html(el, markup) { if (markupCache.get(el) !== markup) { el.innerHTML = markup; markupCache.set(el, markup); } }
// Keep list buttons alive across polling, including keyboard focus and scroll position.
function reconcile(el, rows, make) {
  const existing = new Map([...el.children].map((node) => [node.dataset.row, node]));
  const active = document.activeElement;
  const scroll = el.scrollTop;
  rows.forEach((row, i) => {
    let node = existing.get(row.key);
    if (!node) { node = document.createElement("li"); node.dataset.row = row.key; node.append(document.createElement("button")); }
    existing.delete(row.key);
    make(node.firstElementChild, row);
    if (el.children[i] !== node) el.insertBefore(node, el.children[i] || null);
  });
  for (const node of existing.values()) node.remove();
  markupCache.delete(el);
  if (active?.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
  el.scrollTop = scroll;
}
function applySnapshot(snap) {
  if (!snap || !Array.isArray(snap.sessions) || !Array.isArray(snap.providers) || !Number.isFinite(snap.now)) throw new Error("Invalid snapshot");
  state.snap = snap; state.received = Date.now(); state.skew = state.received - snap.now; state.error = false;
  refresh(); renderConnection();
}
function refresh() {
  if (!state.snap) return;
  state.scope = state.snap.sessions.filter((s) => !state.hidden.has(s.provider) && inWindow(s, state.window, now()));
  state.visible = selectSessions(state.snap.sessions, state, now());
  world.setSessions(state.visible);
  if (state.selected && !state.visible.some((s) => s.key === state.selected)) world.select(null);
  renderCounters(); renderLegend(); renderProjects(); renderRoster(); renderSide(); renderLog(); renderFilters(); renderEmpty();
}
function renderConnection() {
  const stale = state.received && Date.now() - state.received > 12000;
  const failed = state.error || stale;
  const badge = $("source-badge");
  badge.textContent = failed ? "RECONNECTING" : state.mode === "demo" ? "DEMO" : state.received ? "LIVE" : "CONNECTING";
  badge.className = `source-badge ${failed ? "error" : state.mode === "demo" ? "demo" : ""}`;
  $("subtitle").textContent = failed ? "Updates interrupted" : state.mode === "demo" ? "Simulated agents" : "Watching this machine";
  $("connection-warning").hidden = !failed;
  $("connection-warning").textContent = state.received ? "Live updates are interrupted. Showing the last snapshot; reconnecting automatically." : "Cannot read agent activity yet. Retrying automatically. For browser live preview, build the desktop debug binary first (cargo build in src-tauri).";
  $("updated").textContent = state.received ? `${state.mode === "demo" ? "Simulation" : "Last scan"} · ${ago(Date.now() - state.received)}${failed ? " · data may be out of date" : ""}` : "Waiting for first scan";
}
async function start() {
  const tauri = window.__TAURI__;
  const params = new URLSearchParams(location.search);
  if (params.has("demo") || (!tauri && !params.has("live"))) {
    state.mode = "demo";
    const sim = createDemo(); applySnapshot(sim.tick());
    setInterval(() => applySnapshot(sim.tick()), 1200);
    return;
  }
  state.mode = "live";
  // Sequential polling prevents slow scans from overlapping or arriving out of order.
  let listening = false;
  const pull = async () => {
    try {
      if (tauri) {
        if (!listening) { await tauri.event.listen("tally", (e) => { try { applySnapshot(e.payload); } catch { state.error = true; renderConnection(); } }); listening = true; }
        if (!state.received || Date.now() - state.received > 5000) {
          const first = await tauri.core.invoke("snapshot");
          if (first) applySnapshot(first);
          else if (Date.now() - startedAt > 12000) throw new Error("No snapshot");
        }
      } else {
        const response = await fetch("/api/snapshot", { cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error("Scan failed");
        applySnapshot(await response.json());
      }
    } catch { state.error = true; renderConnection(); }
    setTimeout(pull, 2500);
  };
  const startedAt = Date.now();
  await pull();
}
function renderCounters() {
  const v = state.scope;
  const approval = v.filter((s) => s.status === "blocked").length;
  const ready = v.filter((s) => s.status === "waiting").length;
  const projects = new Set(v.map(projectKey)).size;
  $("overview-summary").textContent = `${v.length} sessions across ${projects} project${projects === 1 ? "" : "s"}`;
  const items = [
    ["attention", "Needs you", approval + ready, "var(--gold)", `${approval} approval${approval === 1 ? "" : "s"} · ${ready} your turn`],
    ["working", "Working", v.filter((s) => s.status === "working").length, "var(--green)", "Agents on a task"],
    ["resting", "At rest", v.filter(isResting).length, "#96b8dc", "Idle, sleeping or offline"],
    ["all", "All sessions", v.length, "var(--ink)", `${projects} projects in view`],
  ];
  for (const [key, label, n, color, hint] of items) {
    let b = $("counters").querySelector(`[data-status="${key}"]`);
    if (!b) { b = document.createElement("button"); b.dataset.status = key; $("counters").append(b); }
    b.className = `counter ${key} ${state.status === key ? "on" : ""}`;
    b.setAttribute("aria-pressed", state.status === key);
    b.title = `${label} in the selected time window and sources. Click to filter.`;
    html(b, `<span class="counter-top"><span class="dot" style="color:${color}"></span>${label}</span><span class="arrow" aria-hidden="true">↗</span><b style="color:${color}">${n}</b><small>${hint}</small>`);
  }
  document.title = `${approval + ready ? `(${approval + ready}) ` : ""}AgentTally`;
}
function renderLegend() {
  for (const p of state.snap.providers) {
    let chip = [...$("legend").children].find((b) => b.dataset.p === p.key);
    if (!chip) { chip = document.createElement("button"); chip.dataset.p = p.key; $("legend").append(chip); }
    const enabled = !state.hidden.has(p.key);
    const count = state.snap.sessions.filter((s) => s.provider === p.key && inWindow(s, state.window, now())).length;
    chip.className = `chip ${enabled ? "" : "off"}`;
    chip.disabled = !p.detected && !count;
    chip.setAttribute("aria-pressed", enabled);
    chip.title = chip.disabled ? `${p.name} not detected` : `${enabled ? "Hide" : "Show"} ${p.name}`;
    html(chip, `<i style="background:${providerMeta(p.key).body}"></i>${esc(p.name)} <em>${count}</em>`);
  }
}
function renderProjects() {
  const projects = new Map(state.snap.sessions.map((s) => [projectKey(s), s.project]));
  const counts = new Map(); for (const name of projects.values()) counts.set(name, (counts.get(name) || 0) + 1);
  // Retain an explicit selection if its session ages out, until the user clears it.
  if (state.project && !projects.has(state.project)) projects.set(state.project, state.project);
  const markup = '<option value="">All projects</option>' + [...projects].sort((a,b) => a[1].localeCompare(b[1])).map(([key,name]) => `<option value="${esc(key)}">${esc(counts.get(name) > 1 ? key : name)}</option>`).join("");
  html($("project-filter"), markup); $("project-filter").value = state.project;
}
function renderRoster() {
  const list = sortSessions(state.visible, state.sort);
  $("party-count").textContent = `${list.length}`;
  reconcile($("roster"), list, (b, s) => {
    const m = providerMeta(s.provider), st = STATUS[s.status];
    b.dataset.key = s.key;
    b.className = `card ${s.status} ${s.key === state.selected ? "sel" : ""}`;
    b.setAttribute("aria-pressed", s.key === state.selected);
    b.title = `${s.title} · ${s.cwd || s.project}`;
    html(b, `<img src="${portrait(s.provider,s.status)}" alt="" /><span class="name"><b>${s.parent ? "↳ " : ""}${esc(s.title)}</b></span><span class="meta"><span class="project">${esc(s.project)}</span>${time(s.lastTs)}</span><span class="doing">${esc(describe(s.current))}</span><span class="status-line" style="color:${st.color}"><span class="dot"></span>${statusLabel(s.status)}<span class="provider-name">${esc(m.name)}</span></span>`);
  });
  if (!list.length) html($("roster"), '<li class="list-empty">No matching sessions.<br>Try another filter or clear your search.</li>');
}
let detailKey = null;
let detailEvents = "";
function renderSide() {
  const el = $("detail");
  const s = state.visible.find((x) => x.key === state.selected);
  if (!s) { el.hidden = true; detailKey = null; return; }
  const changed = detailKey !== s.key;
  const scroll = changed ? 0 : el.scrollTop;
  detailKey = s.key;
  el.hidden = false;
  // Stable controls: only update the content slots, never the detail action buttons.
  if (!el.firstElementChild) el.innerHTML = '<header><img alt="" /><div><h2></h2><span class="pill"></span></div><button class="btn close" id="close-detail" aria-label="Close session details" title="Close (Esc)">✕</button></header><p class="attention-note" hidden></p><dl class="facts"></dl><div class="detail-actions"><button class="btn" id="focus-agent">⌖ Locate on map</button><button class="btn" id="copy-path">Copy project path</button></div><p id="copy-status" class="muted" role="status"></p><div class="stats"></div><h3>Recent activity</h3><ol class="quest"></ol>';
  el.querySelector("header img").src = portrait(s.provider,s.status);
  el.querySelector("h2").textContent = s.title;
  const pill = el.querySelector(".pill"); pill.style.color = STATUS[s.status].color; pill.textContent = statusLabel(s.status);
  const note = el.querySelector(".attention-note"); note.hidden = !needsAttention(s); note.className = `attention-note ${s.status}`;
  note.textContent = s.status === "blocked" ? `Permission requested. Review it in ${providerMeta(s.provider).name}.` : `Turn finished. Continue the conversation in ${providerMeta(s.provider).name}.`;
  const facts = [["Agent", `${providerMeta(s.provider).name}${s.client ? ` · ${s.client}` : ""}`], ["Project", s.cwd || s.project], s.branch && ["Branch",s.branch], s.model && ["Model",s.model], s.parent && ["Role", "Sub-agent"], ["Started", s.started ? exactTime(s.started) : "Unknown"], ["Last seen",exactTime(s.lastTs)], ["Coverage", ["antigravity","opencode"].includes(s.provider) ? "File activity only" : "Parsed local logs"]].filter(Boolean);
  html(el.querySelector(".facts"), facts.map(([k,v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join(""));
  html(el.querySelector(".stats"), `<span><b>${compact(s.toolCalls)}</b> tool calls</span><span><b>${compact(s.tokensIn)}</b> tokens in</span><span><b>${compact(s.tokensOut)}</b> tokens out</span>`);
  const events = [...s.events].reverse();
  const signature = JSON.stringify(events);
  if (changed || detailEvents !== signature) {
    html(el.querySelector(".quest"), events.length ? events.map((e) => `<li class="k-${esc(e.kind)}"><span>${KIND_ICON[e.kind] || "·"}</span><span class="tx">${esc(describe(e))}</span>${time(e.ts)}</li>`).join("") : '<li class="list-empty">No detailed events available.</li>');
    detailEvents = signature;
  }
  $("copy-path").disabled = !s.cwd;
  if (changed) $("copy-status").textContent = "";
  el.scrollTop = scroll;
}
function renderLog() {
  const rows = state.visible.flatMap((s) => {
    const occurrences = new Map();
    return s.events.map((e) => {
      const identity = JSON.stringify([s.key, e.ts, e.kind, e.tool]);
      const occurrence = occurrences.get(identity) || 0;
      occurrences.set(identity, occurrence + 1);
      return { key: `${identity}/${occurrence}`, s, e };
    });
  })
    .filter(({e}) => e.kind !== "system" && !(e.kind === "think" && !e.text)).sort((a,b) => b.e.ts-a.e.ts).slice(0,40);
  reconcile($("world-log"), rows, (b,{s,e}) => {
    b.dataset.key = s.key;
    b.title = `${s.title}: ${describe(e)}`;
    html(b, `${time(e.ts)}<span class="who" style="color:${providerMeta(s.provider).body}">${esc(s.project)}</span><span class="what">${e.kind === "tool" ? STATIONS[e.station]?.icon || "⚙" : KIND_ICON[e.kind] || "·"} ${esc(describe(e))}</span>`);
  });
  if (!rows.length) html($("world-log"), '<li class="list-empty">Activity will appear here as your agents work.</li>');
}
function renderFilters() {
  for (const b of document.querySelectorAll("[data-status]")) { b.classList.toggle("on", b.dataset.status === state.status); b.setAttribute("aria-pressed", b.dataset.status === state.status); }
  for (const b of $("window-filter").children) { b.classList.toggle("on", b.dataset.w === state.window); b.setAttribute("aria-pressed", b.dataset.w === state.window); }
  $("reset-filters").hidden = !hasFilters();
  $("world-count").textContent = `${new Set(state.visible.map(projectKey)).size} projects`;
}
function hasFilters() { return !!(state.query || state.project || state.hidden.size || state.status !== "all" || state.window !== "6h"); }
function renderEmpty() {
  $("empty").hidden = state.visible.length > 0;
  const filtered = hasFilters();
  $("empty-title").textContent = filtered ? "No matching agents" : "All quiet here";
  $("empty-message").textContent = filtered ? "Try a wider time window, another project, or reset your filters." : "Start a session in Claude Code, Codex, Copilot or Gemini. Your agents will appear here automatically.";
  $("empty-reset").hidden = !filtered;
}
function filterRefresh() { refresh(); world.recenter(); }
function resetFilters() {
  state.query = ""; state.project = ""; state.status = "all"; state.hidden.clear(); state.window = "6h";
  $("search").value = ""; save("tally.hidden", []); save("tally.window", state.window); filterRefresh();
}
function choose(key) { world.select(key); world.focus(key); }
for (const id of ["roster", "world-log"]) $(id).addEventListener("click", (e) => { const key = e.target.closest("button")?.dataset.key; if (key) choose(key); });
for (const id of ["counters", "status-filter"]) $(id).addEventListener("click", (e) => { const value = e.target.closest("button")?.dataset.status; if (value) { state.status = value; filterRefresh(); } });
$("window-filter").addEventListener("click", (e) => { const w = e.target.closest("button")?.dataset.w; if (w) { state.window = w; save("tally.window",w); filterRefresh(); } });
$("legend").addEventListener("click", (e) => { const chip = e.target.closest("button"); if (!chip || chip.disabled) return; const p = chip.dataset.p; state.hidden.has(p) ? state.hidden.delete(p) : state.hidden.add(p); save("tally.hidden",[...state.hidden]); filterRefresh(); });
$("search").addEventListener("input", (e) => { state.query = e.target.value; filterRefresh(); });
$("project-filter").addEventListener("change", (e) => { state.project = e.target.value; filterRefresh(); });
$("sort").value = state.sort;
$("sort").addEventListener("change", (e) => { state.sort = e.target.value; save("tally.sort",state.sort); renderRoster(); });
$("reset-filters").onclick = resetFilters; $("empty-reset").onclick = resetFilters;
$("recenter").onclick = () => world.recenter();
$("zoom-in").onclick = () => world.zoom(1); $("zoom-out").onclick = () => world.zoom(-1);
function setMotion(paused) {
  state.paused = paused; world.setPaused(paused); document.body.classList.toggle("motion-paused",paused);
  $("motion").setAttribute("aria-pressed",paused); $("motion").innerHTML = paused ? '▶ <span>Motion</span>' : 'Ⅱ <span>Motion</span>';
  $("motion").title = paused ? "Resume animation; live data is still updating" : "Pause animation; live data keeps updating";
  $("motion").setAttribute("aria-label", paused ? "Resume animation" : "Pause animation");
}
$("motion").onclick = () => { setMotion(!state.paused); save("tally.paused",state.paused); };
motionPreference.addEventListener("change", (e) => { if (e.matches) setMotion(true); });
$("detail").addEventListener("click", async (e) => {
  const id = e.target.closest("button")?.id;
  if (id === "close-detail") { const key = state.selected; world.select(null); [...$("roster").querySelectorAll("button")].find((b) => b.dataset.key === key)?.focus({preventScroll:true}); }
  if (id === "focus-agent") world.focus(state.selected);
  if (id === "copy-path") {
    const session = state.visible.find((s) => s.key === state.selected);
    if (!session?.cwd) return;
    try { await navigator.clipboard.writeText(session.cwd); if (state.selected === session.key) $("copy-status").textContent = "Project path copied."; }
    catch { if (state.selected === session.key) $("copy-status").textContent = "Clipboard unavailable. Select and copy the project path above."; }
  }
});
$("help-button").onclick = () => $("help").showModal(); $("close-help").onclick = () => $("help").close();
addEventListener("keydown", (e) => {
  if ($("help").open || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = e.target.closest("input, textarea, select, [contenteditable=true]");
  if (e.key === "Escape") { if (typing) { e.target.blur(); return; } $("close-detail")?.click(); }
  if (typing) return;
  if (e.key === "/") { e.preventDefault(); $("search").focus(); }
  if (e.key.toLowerCase() === "f") world.recenter();
  if (e.key === "?") $("help").showModal();
});
setInterval(() => {
  renderConnection();
  if (state.snap) {
    // Filtering uses elapsed time, not the timestamp of a stale snapshot.
    refresh();
    document.querySelectorAll("time[data-ts]").forEach((el) => { el.textContent = ago(now() - Number(el.dataset.ts)); });
  }
}, 5000);
$("logo-bot").getContext("2d").drawImage(robotSprite({provider:"claude",legs:"stand",arms:false,eyes:"open",chest:"#a0e4b5"}),0,0);
// Canvas text never triggers @font-face loading; request the pixel font explicitly and redraw once it arrives.
document.fonts.load('10px "Press Start 2P"').then(() => { world.dirty = true; }).catch(() => {});
setMotion(state.paused); renderFilters(); start();
