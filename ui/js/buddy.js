// Desktop buddy: one robot acting out what one agent is doing, with a thought cloud above its
// head. Lives in a transparent, borderless, always-on-top window shown while the main window is
// minimized. Transparent pixels let the mouse through to whatever is underneath.
import { robotSprite, drawToolFx, drawBubble, drawLeisure, px } from "./sprites.js";
import { providerMeta, STATUS, STATUS_TEXT, describe, ago } from "./meta.js";
import { createDemo } from "./demo.js";
import { inWindow } from "./selectors.js";

const $ = (id) => document.getElementById(id);
const tauri = window.__TAURI__;
const win = tauri?.window.getCurrentWindow();

// Art buffer, scaled up 4x with nearest-neighbour by CSS. The robot's feet stand at (FX, FY).
const W = 52, H = 30, SCALE = 4, FX = 26, FY = 27;
const canvas = $("bot");
canvas.width = W; canvas.height = H;
canvas.style.width = `${W * SCALE}px`; canvas.style.height = `${H * SCALE}px`;
const g = canvas.getContext("2d", { willReadFrequently: true });

const RANK = { blocked: 0, waiting: 1, working: 2, idle: 3, sleeping: 4, offline: 5 };
const LEISURE_DELAY = 30e3; // idle this long before taking up a pastime
const LEISURE = ["read", "beach"]; // fishing needs water, which the desktop lacks
const loadHidden = () => { try { return new Set(JSON.parse(localStorage.getItem("tally.hidden")) || []); } catch { return new Set(); } };

const state = {
  snap: null, skew: 0,
  key: null, // session shown
  pin: null, // session picked by clicking the cloud; null follows whoever needs you most
  start: null, // robot shown when cycling began; reaching it again returns to AUTO
  shown: !tauri, // the browser preview is always "shown"
  station: null, walkUntil: 0, face: 1, cloudText: "",
};
const now = () => Date.now() - state.skew;

/** Main sessions worth showing, most urgent first. Sub-agents stay with their parent. */
function candidates() {
  if (!state.snap) return [];
  const hidden = loadHidden();
  return state.snap.sessions
    .filter((s) => !s.parent && !hidden.has(s.provider) && inWindow(s, "6h", now()))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || b.lastTs - a.lastTs);
}

/** Keeps the current robot unless another one needs you more, so the buddy doesn't flicker. */
function pick(list) {
  if (state.pin && list.some((s) => s.key === state.pin)) return list.find((s) => s.key === state.pin);
  state.pin = state.start = null;
  const best = list[0];
  const cur = list.find((s) => s.key === state.key);
  if (!best) return null;
  if (!cur || RANK[best.status] < RANK[cur.status] || RANK[cur.status] > RANK.working) return best;
  return cur;
}

function applySnapshot(snap) {
  if (!snap || !Array.isArray(snap.sessions)) return;
  state.snap = snap;
  state.skew = Date.now() - snap.now;
  const s = pick(candidates());
  if (s?.key !== state.key) { state.key = s?.key ?? null; state.station = null; }
  renderCloud();
}

const session = () => state.snap?.sessions.find((s) => s.key === state.key) || null;

function cloudLine(s) {
  const cur = s.current;
  switch (s.status) {
    case "blocked": return `Needs your OK${cur?.kind === "tool" ? ` · ${describe(cur)}` : ""}`;
    case "waiting": {
      const reply = [...s.events].reverse().find((e) => e.kind === "reply" && e.text);
      return reply ? `Your turn · ${reply.text}` : "Your turn";
    }
    case "working": return describe(cur);
    case "idle": return `Idle for ${ago(now() - s.lastTs)} · ${s.title}`;
    case "sleeping": return "Zzz…";
    default: return "Offline";
  }
}

function renderCloud() {
  const s = session();
  const list = candidates();
  $("cloud").hidden = $("trail").hidden = false;
  if (!s) {
    setCloud("No agents around", "AgentTally", "#7c7fa8", "");
    return;
  }
  const m = providerMeta(s.provider);
  const i = cycle(list).findIndex((x) => x.key === s.key);
  const pickLabel = list.length > 1 ? (state.pin ? `${i + 1}/${list.length}` : "AUTO") : "";
  setCloud(cloudLine(s), `${m.short} · ${s.project}`, STATUS[s.status]?.color || m.body, pickLabel, m.body,
    `${STATUS_TEXT[s.status]} · ${s.title}`);
}

function setCloud(text, who, accent, pickLabel, tag = accent, title = "") {
  const cloud = $("cloud");
  cloud.style.setProperty("--accent", accent);
  $("who-tag").style.background = tag;
  $("who").textContent = who;
  $("pick").textContent = pickLabel;
  $("what").textContent = text;
  cloud.title = `${title ? title + "\n" : ""}Click: next agent · Double-click the robot: open AgentTally`;
  if (text !== state.cloudText) {
    state.cloudText = text;
    cloud.classList.remove("pop"); void cloud.offsetWidth; cloud.classList.add("pop");
  }
}

// ---------------------------------------------------------------- drawing

function draw(t) {
  g.clearRect(0, 0, W, H);
  const s = session();
  const st = s?.status || "sleeping";
  const provider = s?.provider || "claude";
  const m = providerMeta(provider);
  const cur = s?.current;
  const working = st === "working";
  const station = working && cur?.kind === "tool" ? cur.station || "tasks" : "hub";

  // A change of station is acted out as a few steps, as if walking to the next building.
  if (station !== state.station) {
    if (state.station !== null) { state.walkUntil = t + 0.6; state.face = -state.face; }
    state.station = station;
  }
  const walking = t < state.walkUntil;
  const onTool = working && !walking && station !== "hub";
  const needsYou = st === "blocked" || st === "waiting";
  const hover = !!m.hover;
  const idleFor = s ? now() - s.lastTs : 0;
  const lz = st === "idle" && idleFor > LEISURE_DELAY
    ? { kind: LEISURE[Math.floor(idleFor / 60e3) % LEISURE.length], seed: 0.37 } : null;
  const seated = lz && !hover;

  const stepFrame = Math.floor(t * 7) % 2;
  const legs = hover ? (stepFrame ? "hover" : "hover2") : seated ? "sit" : walking && stepFrame ? "step" : "stand";
  const blink = t % 4 < 0.12;
  const basking = lz?.kind === "beach" && t % 9 > 6;
  const eyes = st === "offline" ? "off" : st === "sleeping" || blink || basking ? "closed" : "open";
  // Waving for attention when it's your move; flapping while using a tool.
  const arms = onTool ? Math.floor(t * 4) % 2 === 0 : needsYou ? Math.floor(t * 2) % 2 === 0 : false;
  const sprite = robotSprite({ provider, legs, arms, eyes, chest: STATUS[st]?.color || "#46e07a", gray: st === "offline" || !s });

  let bob = 0;
  if (walking) bob = stepFrame ? -1 : 0;
  else if (onTool) bob = Math.floor(t * 4) % 2 ? -1 : 0;
  else if (needsYou) bob = Math.floor(t * 2) % 2 ? -2 : 0; // little hops
  else if (hover) bob = Math.round(Math.sin(t * 3));
  const lift = hover ? 3 : seated ? -2 : 0;
  const x = FX, y = FY;

  px(g, x - 5, y - 1, 11, 2, "rgba(0,0,0,0.28)");
  if (lz) drawLeisure(g, lz.kind, "back", x, y, state.face, t, lz.seed);
  g.save();
  if (state.face < 0) { g.translate(2 * x + 1, 0); g.scale(-1, 1); }
  g.drawImage(sprite, x - 6, y - 16 + bob - lift);
  g.restore();
  if (lz) drawLeisure(g, lz.kind, "front", x, y + bob - lift, state.face, t, lz.seed);
  if (onTool) drawToolFx(g, station, x + 7 * state.face, y - 8 + bob - lift, t);
  if (st === "sleeping") drawBubble(g, "sleep", x + 2, y - 14, t);
}

// ---------------------------------------------------------------- mouse

/** True when (x, y), in CSS pixels of this window, is over the cloud or a drawn robot pixel. */
function hit(x, y) {
  const inside = (el) => { const r = el.getBoundingClientRect(); return x >= r.left && x < r.right && y >= r.top && y < r.bottom; };
  if (!$("cloud").hidden && inside($("cloud"))) return true;
  const r = canvas.getBoundingClientRect();
  const bx = Math.floor((x - r.left) / SCALE), by = Math.floor((y - r.top) / SCALE);
  if (bx < -1 || by < -1 || bx > W || by > H) return false;
  // One art pixel of slack around the robot makes it easier to grab.
  const data = g.getImageData(bx - 1, by - 1, 3, 3).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
  return false;
}

/** Lets clicks through the transparent parts of the window by polling the cursor position. */
function startClickThrough() {
  let ignoring = null;
  let busy = false;
  setInterval(async () => {
    if (!state.shown || busy) return;
    busy = true;
    try {
      const [c, pos, scale] = await Promise.all([tauri.window.cursorPosition(), win.outerPosition(), win.scaleFactor()]);
      const over = hit((c.x - pos.x) / scale, (c.y - pos.y) / scale);
      if (ignoring !== !over) { ignoring = !over; await win.setIgnoreCursorEvents(ignoring); }
    } catch { /* The window may be closing. */ }
    busy = false;
  }, 60);
}

/** Click order of the cloud; stable while statuses change, unlike the urgency order. */
const cycle = (list) => [...list].sort((a, b) => a.project.localeCompare(b.project) || a.key.localeCompare(b.key));

$("cloud").addEventListener("click", () => {
  const list = candidates();
  if (list.length < 2) return;
  // AUTO → the next robot after the one shown → … → back to AUTO after a full round.
  const order = cycle(list);
  const at = order.findIndex((s) => s.key === state.key);
  const next = order[(at + 1) % order.length];
  state.pin = state.pin && next.key === state.start ? null : next.key;
  if (!state.pin) state.start = null;
  else if (!state.start) state.start = state.key;
  state.key = (state.pin ? list.find((s) => s.key === state.pin) : pick(list))?.key ?? null;
  state.station = null;
  renderCloud();
});

let press = null;
canvas.addEventListener("mousedown", (e) => { if (e.button === 0) press = { x: e.screenX, y: e.screenY }; });
window.addEventListener("mouseup", () => { press = null; });
canvas.addEventListener("mousemove", (e) => {
  if (!press || !win) return;
  if (Math.abs(e.screenX - press.x) + Math.abs(e.screenY - press.y) > 3) { press = null; win.startDragging(); }
});
canvas.addEventListener("dblclick", () => tauri?.core.invoke("show_main"));

// ---------------------------------------------------------------- loop

let last = 0;
function frame(ms) {
  // 12 fps is plenty for 16-bit animation and keeps the buddy light on the CPU.
  if (state.shown && ms - last > 80) { last = ms; draw(ms / 1000); }
  requestAnimationFrame(frame);
}

async function start() {
  requestAnimationFrame(frame);
  setInterval(renderCloud, 5000); // keeps "Idle for …" fresh between snapshots
  if (!tauri) {
    const sim = createDemo();
    applySnapshot(sim.tick());
    setInterval(() => applySnapshot(sim.tick()), 1200);
    return;
  }
  await tauri.event.listen("tally", (e) => applySnapshot(e.payload));
  await tauri.event.listen("buddy-visible", (e) => { state.shown = !!e.payload; if (state.shown) renderCloud(); });
  applySnapshot(await tauri.core.invoke("snapshot"));
  startClickThrough();
}
start();
