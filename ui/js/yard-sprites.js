// Pixel art for the Freight Yard prototype: trucks, forklifts, depot buildings, ships.
// Everything is drawn with filled rectangles, like sprites.js, so it stays crisp at any integer scale.

import { px } from "./sprites.js";
import { providerMeta } from "./meta.js";

export const OUT = "#161827";

/** Crate colour per station (Session.stations order: hub, library, forge, terminal, radar, tasks). */
export const CRATE = {
  library: "#4f9bff",
  forge: "#ff8a3d",
  terminal: "#46e07a",
  radar: "#b18cff",
  tasks: "#ffd23f",
  hub: "#e8e8f0",
};
export const STATION_ORDER = ["hub", "library", "forge", "terminal", "radar", "tasks"];

export function obox(g, x, y, w, h, fill, outline = OUT) {
  px(g, x, y, w, h, outline);
  px(g, x + 1, y + 1, w - 2, h - 2, fill);
}

export function line(g, x0, y0, x1, y1, color) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) px(g, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 1, 1, color);
}

// ---------------------------------------------------------------- 3x5 pixel font for signs

const GLYPHS = {
  A: [".#.", "#.#", "###", "#.#", "#.#"], B: ["##.", "#.#", "##.", "#.#", "##."], C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."], E: ["###", "#..", "##.", "#..", "###"], F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"], H: ["#.#", "#.#", "###", "#.#", "#.#"], I: ["###", ".#.", ".#.", ".#.", "###"],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"], L: ["#..", "#..", "#..", "#..", "###"], M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"], O: [".#.", "#.#", "#.#", "#.#", ".#."], P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"], R: ["##.", "#.#", "##.", "#.#", "#.#"], S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."], U: ["#.#", "#.#", "#.#", "#.#", "###"], V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"], Y: ["#.#", "#.#", ".#.", ".#.", ".#."], X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  0: ["###", "#.#", "#.#", "#.#", "###"], 1: [".#.", "##.", ".#.", ".#.", "###"], 2: ["##.", "..#", ".#.", "#..", "###"],
  3: ["##.", "..#", ".#.", "..#", "##."], 4: ["#.#", "#.#", "###", "..#", "..#"], 5: ["###", "#..", "##.", "..#", "##."],
  6: [".##", "#..", "###", "#.#", "###"], 7: ["###", "..#", ".#.", ".#.", ".#."], 8: ["###", "#.#", "###", "#.#", "###"],
  9: ["###", "#.#", "###", "..#", "##."], ":": ["...", ".#.", "...", ".#.", "..."], "-": ["...", "...", "###", "...", "..."],
};
export const textWidth = (s) => s.length * 4 - 1;
/** Draws `s` with its top-left at x,y. */
export function pixelText(g, s, x, y, color) {
  [...s.toUpperCase()].forEach((ch, i) => {
    const rows = GLYPHS[ch];
    if (!rows) return;
    rows.forEach((row, ry) => { for (let rx = 0; rx < 3; rx++) if (row[rx] === "#") px(g, x + i * 4 + rx, y + ry, 1, 1, color); });
  });
}
function sign(g, text, cx, y, on, lit = "#9ae6ff", dim = "#5f7290") {
  const w = textWidth(text) + 6;
  obox(g, cx - Math.ceil(w / 2), y, w, 9, "#1f2236");
  pixelText(g, text, cx - Math.ceil(w / 2) + 3, y + 2, on ? lit : dim);
}

// ---------------------------------------------------------------- vehicles

const GRAY = { body: "#8a8d99", shade: "#5f626e", light: "#b3b6c0", accent: "#9a9da8" };
const desat = (c) => {
  const n = parseInt(c.slice(1), 16);
  const v = Math.round(((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) * 0.75);
  return `rgb(${v},${v},${v + 8})`;
};
const cache = new Map();
function cached(key, w, h, paint) {
  let c = cache.get(key);
  if (!c) {
    c = document.createElement("canvas");
    c.width = w; c.height = h;
    paint(c.getContext("2d"));
    if (cache.size > 600) cache.clear();
    cache.set(key, c);
  }
  return c;
}

function roofKit(g, head, x, y, c) {
  // Each agent keeps its signature from the robots, now as a roof light on the cab.
  if (head === "star") { px(g, x + 3, y, 1, 1, c); px(g, x + 2, y + 1, 3, 1, c); px(g, x + 3, y + 2, 1, 1, c); }
  else if (head === "visor") { obox(g, x, y, 7, 3, c); }
  else if (head === "goggles") { obox(g, x, y, 3, 3, c); obox(g, x + 4, y, 3, 3, c); }
  else if (head === "sparkle") { px(g, x + 3, y - 1, 1, 4, c); px(g, x + 2, y + 1, 3, 1, c); }
  else if (head === "crown") { px(g, x + 1, y + 1, 5, 2, c); px(g, x + 1, y, 1, 1, c); px(g, x + 3, y - 1, 1, 1, c); px(g, x + 5, y, 1, 1, c); }
}

export const TRUCK = { w: 30, h: 20 };
/**
 * A flatbed truck facing right. Ground line at y = 19, centre at x = 15.
 * crates: up to 6 colours, loaded bottom row first. light: status colour on the cab door.
 */
export function truckSprite({ provider, crates = [], wheel = 0, light = "#46e07a", gray = false, hover = false, beacon = null }) {
  const key = ["t", provider, crates.join(""), wheel, light, gray, hover, beacon].join("|");
  return cached(key, TRUCK.w, TRUCK.h, (g) => {
    const m = gray ? GRAY : providerMeta(provider);
    const y0 = 2; // leave two rows on top for the roof kit
    // Exhaust stack behind the cab.
    px(g, 19, y0, 1, 5, OUT); px(g, 20, y0 - 1, 1, 6, "#5c6070");
    // Chassis and bed.
    px(g, 2, y0 + 11, 26, 2, "#2b2d3a");
    obox(g, 0, y0 + 8, 21, 4, gray ? "#6a6058" : "#7a5534");
    px(g, 1, y0 + 9, 19, 1, gray ? "#857a70" : "#a2723f");
    // Crates: three columns, two rows.
    crates.slice(0, 6).forEach((c, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const cx = 2 + col * 6, cy = y0 + 4 - row * 4;
      const fill = gray ? desat(c) : c;
      obox(g, cx, cy, 6, 5, fill);
      px(g, cx + 1, cy + 1, 4, 1, "rgba(255,255,255,0.35)");
      px(g, cx + 2, cy + 2, 2, 1, "rgba(0,0,0,0.25)");
    });
    // Cab.
    obox(g, 20, y0 + 1, 10, 11, m.body);
    px(g, 21, y0 + 2, 8, 1, m.light);
    px(g, 21, y0 + 9, 8, 2, m.shade);
    obox(g, 24, y0 + 3, 5, 4, "#9fe0ff");
    px(g, 25, y0 + 4, 1, 1, "#ffffff");
    px(g, 23, y0 + 3, 1, 6, m.shade);
    px(g, 21, y0 + 5, 2, 2, light);
    px(g, 29, y0 + 8, 1, 2, "#fff3a0"); // headlight
    px(g, 0, y0 + 9, 1, 2, "#ff4a5a"); // tail light
    roofKit(g, m.head || providerMeta(provider).head, 21, y0 - 2, gray ? "#9a9da8" : providerMeta(provider).accent);
    if (beacon) { obox(g, 25, y0 - 2, 3, 3, beacon); }
    if (hover) {
      // Antigravity floats: thruster pads instead of wheels.
      px(g, 3, y0 + 13, 7, 2, OUT); px(g, 4, y0 + 13, 5, 1, m.accent || "#93f3f9");
      px(g, 19, y0 + 13, 7, 2, OUT); px(g, 20, y0 + 13, 5, 1, m.accent || "#93f3f9");
      return;
    }
    for (const wx of [3, 11, 21]) {
      obox(g, wx, y0 + 12, 5, 5, "#23252f");
      px(g, wx + 2, y0 + 13 + (wheel ? 2 : 0), 1, 1, "#a9afc2");
    }
  });
}

export const LIFT = { w: 18, h: 16 };
/** A forklift facing right (sub-agents). Ground line at y = 15, centre x = 9. */
export function forkliftSprite({ provider, crate = null, fork = 0, light = "#46e07a", gray = false }) {
  const key = ["f", provider, crate, fork, light, gray].join("|");
  return cached(key, LIFT.w, LIFT.h, (g) => {
    const m = gray ? GRAY : providerMeta(provider);
    // Mast and forks at the front.
    px(g, 13, 2, 2, 12, OUT); px(g, 13, 3, 1, 10, "#7a7f92");
    const fy = 12 - fork;
    px(g, 14, fy, 4, 1, "#c9ccd8");
    if (crate) obox(g, 13, fy - 5, 5, 5, gray ? desat(crate) : crate);
    // Cage.
    px(g, 3, 2, 9, 1, OUT); px(g, 3, 2, 1, 6, OUT); px(g, 10, 2, 1, 6, OUT);
    // A tiny robot driver.
    obox(g, 5, 4, 5, 4, m.light); px(g, 8, 5, 1, 1, m.accent || "#ffffff");
    // Body.
    obox(g, 1, 7, 13, 6, m.body);
    px(g, 2, 8, 11, 1, m.light);
    px(g, 1, 9, 3, 3, m.shade);
    px(g, 7, 2, 1, 1, light);
    px(g, 6, 1, 3, 1, light);
    obox(g, 2, 11, 5, 5, "#23252f"); px(g, 4, 13, 1, 1, "#a9afc2");
    obox(g, 9, 12, 4, 4, "#23252f");
  });
}

/** Draw a sprite with its ground centre at (x, y), mirrored when facing left. */
export function blit(g, sprite, x, y, face = 1) {
  const left = Math.round(x - sprite.width / 2), top = Math.round(y - sprite.height + 1);
  if (face >= 0) { g.drawImage(sprite, left, top); return; }
  g.save();
  g.scale(-1, 1);
  g.drawImage(sprite, -left - sprite.width, top);
  g.restore();
}

/** Container ship facing right; its waterline is at y. */
export function drawShip(g, x, y, colors, t) {
  x = Math.round(x); y = Math.round(y);
  const bob = Math.round(Math.sin(t * 1.6) * 0.6);
  y += bob;
  // Wake.
  for (let i = 0; i < 4; i++) px(g, x - 6 - i * 5 - ((t * 10) % 5), y + 1 + (i % 2), 3, 1, "rgba(255,255,255,0.55)");
  // Hull, narrowing towards the bow.
  for (let r = 0; r < 7; r++) {
    const w = 46 - Math.max(0, r - 2) * 2;
    px(g, x, y - 7 + r, w + (r < 2 ? 2 : 0), 1, r === 6 ? "#b8433a" : r === 0 ? OUT : "#2b2d3a");
  }
  px(g, x, y - 7, 1, 7, OUT);
  // Bridge at the stern.
  obox(g, x + 2, y - 17, 9, 10, "#e8e8f0");
  px(g, x + 3, y - 15, 7, 2, "#3a6f9e");
  px(g, x + 5, y - 21, 2, 4, "#b8433a");
  // Containers.
  colors.slice(0, 8).forEach((c, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    obox(g, x + 13 + col * 8, y - 13 - row * 5, 8, 6, c);
    px(g, x + 14 + col * 8, y - 12 - row * 5, 1, 4, "rgba(0,0,0,0.25)");
  });
}

// ---------------------------------------------------------------- buildings
// (x, y) is the centre of the building's ground line. `on` = a truck is working there.

export function drawCrates(g, x, y, n, color) {
  // A pallet stack: two columns, stacked upwards. Shows how much work went through this building.
  for (let i = 0; i < n; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    obox(g, x + col * 6, y - 5 - row * 5, 6, 5, color);
    px(g, x + col * 6 + 1, y - 4 - row * 5, 4, 1, "rgba(255,255,255,0.35)");
  }
  if (n) px(g, x - 1, y, 14, 1, "#7a5534");
}

function drawHQ(g, x, y, t, on, night) {
  obox(g, x - 28, y - 38, 56, 38, "#d9c8a2");
  px(g, x - 27, y - 7, 54, 6, "#bba67e");
  obox(g, x - 30, y - 44, 60, 8, "#7d4f3c");
  px(g, x - 29, y - 43, 58, 1, "#a06a52");
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 5; col++) {
      if (row === 1 && col === 2) continue;
      const wx = x - 24 + col * 10, wy = y - 33 + row * 12;
      const lit = night > 0.4 ? (col * 7 + row * 3) % 5 !== 0 : on && Math.floor(t * 2 + col + row) % 4 === 0;
      obox(g, wx, wy, 8, 7, lit ? "#ffe9a0" : "#7fb7e6");
      if (!lit) px(g, wx + 1, wy + 1, 2, 1, "#d7f0ff");
    }
  }
  // Door and the loading dock in front.
  obox(g, x - 6, y - 15, 12, 15, "#5a3b2b");
  px(g, x - 4, y - 13, 8, 5, "#9fe0ff");
  for (let i = 0; i < 26; i++) px(g, x - 26 + i * 2, y - 2, 1, 2, i % 2 ? "#ffd23f" : OUT);
  // Rooftop sign and antenna.
  sign(g, "HQ", x - 8, y - 54, on, "#59f3ff");
  px(g, x + 20, y - 58, 1, 14, "#5c6070");
  px(g, x + 19, y - 60, 3, 2, Math.floor(t * 2) % 2 ? "#ff4a5a" : "#6a2a30");
}

function drawArchive(g, x, y, t, on) {
  obox(g, x - 28, y - 34, 56, 34, "#3f6fb4");
  for (let i = 0; i < 18; i++) px(g, x - 26 + i * 3, y - 33, 1, 32, "#355f9c");
  obox(g, x - 30, y - 40, 60, 7, "#c9ccd8");
  px(g, x - 29, y - 39, 58, 1, "#eef0f5");
  // Roll-up door: half open while someone is reading.
  obox(g, x - 13, y - 23, 26, 23, "#a7adbd");
  const open = on ? 12 : 0;
  if (open) {
    px(g, x - 12, y - 22 + open, 24, 22 - open, "#1e2030");
    for (let i = 0; i < 4; i++) obox(g, x - 10 + i * 6, y - 6, 5, 5, CRATE.library);
  }
  for (let r = 0; r < open; r += 2) px(g, x - 12, y - 22 + r, 24, 1, "#8e94a6");
  if (!open) for (let r = 0; r < 22; r += 2) px(g, x - 12, y - 22 + r, 24, 1, "#8e94a6");
  sign(g, "ARCHIVE", x, y - 33, on);
}

function drawFactory(g, x, y, t, on) {
  // Chimney with smoke.
  obox(g, x + 16, y - 58, 8, 26, "#7d3a30");
  px(g, x + 17, y - 54, 6, 2, "#e8e8f0");
  if (on) {
    for (let k = 0; k < 4; k++) {
      const p = (t * 0.6 + k / 4) % 1;
      g.globalAlpha = 1 - p;
      const s = 2 + Math.round(p * 3);
      px(g, x + 19 + Math.round(p * 10 + Math.sin(t * 2 + k) * 2), y - 61 - Math.round(p * 22), s, s, "#c9cbd3");
    }
    g.globalAlpha = 1;
  }
  obox(g, x - 28, y - 32, 56, 32, "#a4483a");
  for (let r = 0; r < 7; r++) {
    px(g, x - 27, y - 28 + r * 4, 54, 1, "#8a3a2e");
    for (let c = 0; c < 7; c++) px(g, x - 25 + c * 8 + (r % 2) * 4, y - 31 + r * 4, 1, 3, "#8a3a2e");
  }
  // Sawtooth roof with skylights.
  for (let k = 0; k < 4; k++) {
    const x0 = x - 28 + k * 14;
    for (let j = 0; j < 8; j++) px(g, x0 + Math.round(j * 1.5), y - 33 - j, 12 - Math.round(j * 1.5), 1, j === 7 ? "#7a7f92" : "#5b5f72");
    px(g, x0 + 12, y - 40, 2, 8, "#9fe0ff");
  }
  // Furnace windows glow while editing.
  for (let i = 0; i < 4; i++) {
    const flick = on && Math.floor(t * 8 + i * 3) % 3 !== 0;
    obox(g, x - 24 + i * 13, y - 22, 8, 9, on ? (flick ? "#ffb04a" : "#ff7a2a") : "#4a2a28");
  }
  obox(g, x - 6, y - 12, 12, 12, "#3a2a2a");
  sign(g, "FACTORY", x - 3, y - 51, on, "#ffb04a");
}

function drawCrane(g, x, y, t, on) {
  // Ground containers waiting to be moved.
  obox(g, x - 18, y - 8, 16, 8, "#2f8f5a"); obox(g, x - 2, y - 8, 16, 8, "#3a6f9e");
  // Gantry legs and beam.
  obox(g, x - 26, y - 44, 4, 44, "#e8b83a"); obox(g, x + 18, y - 44, 4, 44, "#e8b83a");
  obox(g, x - 28, y - 48, 52, 6, "#e8b83a");
  for (let i = 0; i < 12; i++) px(g, x - 26 + i * 4, y - 46, 2, 2, OUT);
  const tx = x - 4 + (on ? Math.round(Math.sin(t * 1.4) * 14) : 0);
  const cable = on ? 12 + Math.round(Math.sin(t * 2.1) * 5) : 8;
  obox(g, tx - 4, y - 44, 9, 4, "#5c6070");
  px(g, tx, y - 40, 1, cable, "#2b2d3a");
  obox(g, tx - 8, y - 40 + cable, 17, 7, CRATE.terminal);
  px(g, tx - 6, y - 38 + cable, 13, 1, "#a0f0b8");
  // Operator booth with a terminal screen.
  obox(g, x + 24, y - 20, 14, 20, "#d9dde8");
  obox(g, x + 26, y - 17, 10, 7, "#0f1a14");
  if (on) for (let r = 0; r < 3; r++) px(g, x + 27, y - 16 + r * 2, ((Math.floor(t * 6) + r * 3) % 7) + 2, 1, "#46e07a");
  else px(g, x + 27, y - 16, 2, 1, "#2a5a3a");
  sign(g, "CRANE", x + 31, y - 30, on, "#46e07a");
}

function drawDispatch(g, x, y, t, on) {
  obox(g, x - 24, y - 28, 44, 28, "#e2d6b8");
  obox(g, x - 26, y - 34, 48, 7, "#3f7a5a");
  px(g, x - 25, y - 33, 46, 1, "#5aa67a");
  obox(g, x - 20, y - 22, 9, 8, "#7fb7e6"); obox(g, x + 7, y - 22, 9, 8, "#7fb7e6");
  obox(g, x - 6, y - 14, 10, 14, "#5a3b2b");
  // The route board: lamps light up in sequence while planning.
  obox(g, x + 22, y - 26, 14, 14, "#2b2d3a");
  for (let i = 0; i < 9; i++) {
    const lit = on && (Math.floor(t * 4) + i * 2) % 5 < 2;
    px(g, x + 24 + (i % 3) * 4, y - 24 + Math.floor(i / 3) * 4, 2, 2, lit ? CRATE.tasks : "#4a4d5e");
  }
  px(g, x + 28, y - 12, 2, 12, "#5c6070");
  // Flag.
  px(g, x - 30, y - 44, 1, 44, "#c9ccd8");
  const wave = Math.floor(t * 4) % 2;
  px(g, x - 29, y - 44, 9, 3, CRATE.tasks); px(g, x - 29, y - 41, 9 - wave * 2, 2, CRATE.tasks);
  sign(g, "DISPATCH", x - 2, y - 44, on, CRATE.tasks);
}

function drawRadio(g, x, y, t, on) {
  // Lattice mast.
  const top = y - 48;
  line(g, x - 9, y, x - 2, top, "#7a7f92");
  line(g, x + 9, y, x + 2, top, "#7a7f92");
  for (let k = 0; k < 6; k++) {
    const yy = y - k * 8, w = 9 - k * 1.2;
    line(g, x - w, yy, x + w - 1.2, yy - 8, "#5c6070");
  }
  px(g, x - 1, top - 3, 3, 3, Math.floor(t * 2) % 2 ? "#ff4a5a" : "#6a2a30");
  // Dish, turning while browsing.
  const f = on ? Math.floor(t * 3) % 3 : 1;
  const dx = x - 18, dy = y - 30;
  // An elliptical dish whose width changes as it turns, on a short arm from the mast.
  const half = [3, 5, 3][f];
  px(g, dx, dy + 3, 1, 8, "#5c6070");
  line(g, dx, dy + 4, x - 5, dy + 6, "#5c6070");
  for (let j = -6; j <= 6; j++) {
    const k = Math.sqrt(1 - (j / 6.6) ** 2);
    const hw = Math.round((half + 1) * k), hi = Math.round(half * k);
    px(g, dx - hw, dy + j, hw * 2 + 1, 1, OUT);
    if (Math.abs(j) < 6) px(g, dx - hi, dy + j, hi * 2 + 1, 1, j < -2 ? "#ffffff" : j > 2 ? "#b9bdcc" : "#e8e8f0");
  }
  px(g, dx - (f === 0 ? 4 : f === 2 ? -4 : 0), dy, 1, 1, "#5c6070");
  if (on) {
    for (let k = 0; k < 3; k++) {
      const p = (t * 0.9 + k / 3) % 1, r = 4 + Math.round(p * 14);
      g.globalAlpha = 1 - p;
      for (let a = -3; a <= 3; a++) px(g, dx - 4 - Math.round(Math.cos(a * 0.25) * r), dy - 1 + Math.round(Math.sin(a * 0.25) * r), 1, 1, CRATE.radar);
    }
    g.globalAlpha = 1;
  }
  // Equipment hut.
  obox(g, x + 12, y - 18, 20, 18, "#c9ccd8");
  px(g, x + 13, y - 17, 18, 2, "#9a9da8");
  obox(g, x + 18, y - 11, 8, 11, "#5a5f72");
  sign(g, "RADIO", x + 22, y - 29, on, CRATE.radar);
}

export function drawBuilding(g, station, x, y, t, on, night) {
  if (station === "hub") return drawHQ(g, x, y, t, on, night);
  if (station === "library") return drawArchive(g, x, y, t, on);
  if (station === "forge") return drawFactory(g, x, y, t, on);
  if (station === "terminal") return drawCrane(g, x, y, t, on);
  if (station === "tasks") return drawDispatch(g, x, y, t, on);
  if (station === "radar") return drawRadio(g, x, y, t, on);
}

/** Customs booth above the lane plus the barrier across it. Closed (and flashing) when a truck needs clearance. */
export function drawGate(g, x, laneTop, laneBottom, t, held) {
  obox(g, x - 9, laneTop - 22, 18, 20, "#e8e8f0");
  px(g, x - 8, laneTop - 21, 16, 3, "#b8433a");
  obox(g, x - 6, laneTop - 15, 12, 6, "#9fe0ff");
  const flash = Math.floor(t * 4) % 2;
  obox(g, x - 2, laneTop - 27, 5, 5, held ? (flash ? "#ff3a4a" : "#6a1a20") : "#46e07a");
  sign(g, "CUSTOMS", x + 2, laneTop - 37, held, "#ff8a8a", "#8a8da0");
  // Barrier post at the bottom edge of the lane.
  const bx = x + 16;
  obox(g, bx - 1, laneBottom - 6, 4, 9, "#5c6070");
  if (held) {
    for (let yy = laneTop + 2; yy < laneBottom - 4; yy++) px(g, bx, yy, 2, 1, Math.floor((yy - laneTop) / 3) % 2 ? "#ffffff" : "#e8313f");
    px(g, bx - 1, laneTop + 1, 4, 1, OUT);
  } else {
    // Raised: a short stub pointing up-right.
    for (let k = 0; k < 8; k++) px(g, bx + 1 + k, laneBottom - 6 - k, 2, 1, Math.floor(k / 3) % 2 ? "#ffffff" : "#e8313f");
  }
}

/** Little "honk" sound lines in front of a cab. */
export function drawHonk(g, x, y, face, t) {
  if (Math.floor(t * 3) % 3 === 2) return;
  const d = face >= 0 ? 1 : -1;
  px(g, x + d * 2, y - 2, 2, 1, "#ffd23f");
  px(g, x + d * 3, y, 3, 1, "#ffd23f");
  px(g, x + d * 2, y + 2, 2, 1, "#ffd23f");
}
