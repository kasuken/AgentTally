// Desktop buddy: AgentTally's own robot, reporting on every agent at once. Its thought cloud lists
// what each busy agent is doing and the robot acts out the overall picture. Lives in a
// transparent, borderless, always-on-top window shown while the main window is minimized.
// Transparent pixels let the mouse through to whatever is underneath.
import { robotSprite, drawToolFx, drawBubble, drawLeisure, px } from "./sprites.js";
import { providerMeta, STATUS, describe, ago } from "./meta.js";
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

const ME = "tally";
const RANK = { blocked: 0, waiting: 1, working: 2, idle: 3, sleeping: 4, offline: 5 };
const BUSY = new Set(["blocked", "waiting", "working"]);
const LINES = 4; // agents listed in the cloud; the rest are counted
const LEISURE_DELAY = 30e3; // everyone idle this long before the buddy takes up a pastime
const LEISURE = ["read", "beach"]; // fishing needs water, which the desktop lacks
const loadHidden = () => { try { return new Set(JSON.parse(localStorage.getItem("tally.hidden")) || []); } catch { return new Set(); } };

const state = {
  snap: null, skew: 0,
  shown: !tauri, // the browser preview is always "shown"
  lines: new Map(), // session key → text last shown, to flash lines that change
  summary: "", station: null, walkUntil: 0, face: 1,
};
const now = () => Date.now() - state.skew;

/** Main sessions in view, most urgent first. Sub-agents are part of their parent's work. */
function sessions() {
  if (!state.snap) return [];
  const hidden = loadHidden();
  return state.snap.sessions
    .filter((s) => !s.parent && !hidden.has(s.provider) && inWindow(s, "6h", now()))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || b.lastTs - a.lastTs);
}

function applySnapshot(snap) {
  if (!snap || !Array.isArray(snap.sessions)) return;
  state.snap = snap;
  state.skew = Date.now() - snap.now;
  renderCloud();
}

function lineText(s) {
  if (s.status === "blocked") return `needs your OK${s.current?.kind === "tool" ? ` · ${describe(s.current)}` : ""}`;
  if (s.status === "waiting") {
    const reply = [...s.events].reverse().find((e) => e.kind === "reply" && e.text);
    return reply ? `your turn · ${reply.text}` : "your turn";
  }
  return describe(s.current);
}

function renderCloud() {
  const all = sessions();
  const busy = all.filter((s) => BUSY.has(s.status));
  const count = (st) => all.filter((s) => s.status === st).length;
  const parts = [["blocked", "needs OK"], ["waiting", "your turn"], ["working", "working"], ["idle", "idle"]]
    .map(([st, label]) => [st, count(st), label]).filter(([, n]) => n);
  const summary = !all.length ? "No agents around"
    : parts.length ? parts.map(([st, n, label]) => `<b style="--c:${STATUS[st].color}">${n} ${label}</b>`).join("")
    : `${all.length} asleep`;
  const top = all[0];
  const cloud = $("cloud");
  cloud.style.setProperty("--accent", top ? STATUS[top.status].color : "#7c7fa8");
  $("summary").innerHTML = summary;
  if (summary !== state.summary) {
    state.summary = summary;
    cloud.classList.remove("pop"); void cloud.offsetWidth; cloud.classList.add("pop");
  }

  // Nobody busy: the most recent agent is listed so the cloud still says something useful.
  const rows = busy.length ? busy.slice(0, LINES) : all.slice(0, 1);
  const feed = $("feed");
  const old = new Map([...feed.children].map((li) => [li.dataset.key, li]));
  const seen = new Map();
  rows.forEach((s, i) => {
    const text = BUSY.has(s.status) ? lineText(s) : `${s.status} for ${ago(now() - s.lastTs)} · ${s.title}`;
    let li = old.get(s.key);
    if (!li) { li = document.createElement("li"); li.dataset.key = s.key; li.append(document.createElement("i"), document.createElement("b"), document.createElement("span")); }
    old.delete(s.key);
    const [dot, who, what] = li.children;
    li.style.setProperty("--c", providerMeta(s.provider).body);
    li.style.setProperty("--s", STATUS[s.status].color === STATUS.waiting.color ? "#a07800" : STATUS[s.status].color);
    li.className = s.status === "blocked" || s.status === "waiting" ? "needs" : "";
    li.title = `${providerMeta(s.provider).name} · ${s.title}`;
    who.textContent = s.project;
    what.textContent = text;
    // Flash a line when its agent moves on to something new.
    if (state.lines.has(s.key) && state.lines.get(s.key) !== text) { void li.offsetWidth; li.classList.add("fresh"); }
    seen.set(s.key, text);
    if (feed.children[i] !== li) feed.insertBefore(li, feed.children[i] || null);
  });
  for (const li of old.values()) li.remove();
  state.lines = seen;
  const rest = busy.length - rows.length;
  $("more").hidden = rest <= 0;
  $("more").textContent = `+${rest} more busy`;
}

// ---------------------------------------------------------------- drawing

/** What the buddy acts out: the most urgent thing going on across all agents. */
function mood() {
  const all = sessions();
  if (all.some((s) => s.status === "blocked")) return { st: "blocked" };
  if (all.some((s) => s.status === "waiting")) return { st: "waiting" };
  // While anyone works, the buddy follows whoever did something last.
  const busy = all.filter((s) => s.status === "working").sort((a, b) => b.lastTs - a.lastTs)[0];
  if (busy) return { st: "working", station: busy.current?.kind === "tool" ? busy.current.station || "tasks" : "hub" };
  const idle = all.filter((s) => s.status === "idle").sort((a, b) => b.lastTs - a.lastTs)[0];
  if (idle) return { st: "idle", idleFor: now() - idle.lastTs };
  return { st: "sleeping" };
}

function draw(t) {
  g.clearRect(0, 0, W, H);
  const { st, station = "hub", idleFor = 0 } = mood();
  const working = st === "working";

  // A change of station is acted out as a few steps, as if walking to the next building.
  if (station !== state.station) {
    if (state.station !== null) { state.walkUntil = t + 0.6; state.face = -state.face; }
    state.station = station;
  }
  const walking = t < state.walkUntil;
  const onTool = working && !walking && station !== "hub";
  const needsYou = st === "blocked" || st === "waiting";
  const lz = st === "idle" && idleFor > LEISURE_DELAY
    ? { kind: LEISURE[Math.floor(idleFor / 60e3) % LEISURE.length], seed: 0.37 } : null;

  const stepFrame = Math.floor(t * 7) % 2;
  const legs = lz ? "sit" : walking && stepFrame ? "step" : "stand";
  const blink = t % 4 < 0.12;
  const basking = lz?.kind === "beach" && t % 9 > 6;
  const eyes = st === "sleeping" || blink || basking ? "closed" : "open";
  // Waving for attention when someone needs you; flapping while an agent uses a tool.
  const arms = onTool ? Math.floor(t * 4) % 2 === 0 : needsYou ? Math.floor(t * 2) % 2 === 0 : false;
  const sprite = robotSprite({ provider: ME, legs, arms, eyes, chest: STATUS[st].color });

  let bob = 0;
  if (walking) bob = stepFrame ? -1 : 0;
  else if (onTool) bob = Math.floor(t * 4) % 2 ? -1 : 0;
  else if (needsYou) bob = Math.floor(t * 2) % 2 ? -2 : 0; // little hops
  const lift = lz ? -2 : 0;
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
  const r0 = $("cloud").getBoundingClientRect();
  if (x >= r0.left && x < r0.right && y >= r0.top && y < r0.bottom) return true;
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

const openMain = () => tauri?.core.invoke("show_main");
$("cloud").addEventListener("click", openMain);
canvas.addEventListener("dblclick", openMain);

let press = null;
canvas.addEventListener("mousedown", (e) => { if (e.button === 0) press = { x: e.screenX, y: e.screenY }; });
window.addEventListener("mouseup", () => { press = null; });
canvas.addEventListener("mousemove", (e) => {
  if (!press || !win) return;
  if (Math.abs(e.screenX - press.x) + Math.abs(e.screenY - press.y) > 3) { press = null; win.startDragging(); }
});

// ---------------------------------------------------------------- loop

let last = 0;
function frame(ms) {
  // 12 fps is plenty for 16-bit animation and keeps the buddy light on the CPU.
  if (state.shown && ms - last > 80) { last = ms; draw(ms / 1000); }
  requestAnimationFrame(frame);
}

async function start() {
  requestAnimationFrame(frame);
  setInterval(renderCloud, 5000); // keeps "idle for …" fresh between snapshots
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
