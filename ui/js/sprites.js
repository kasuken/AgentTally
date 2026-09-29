// Pixel art. Everything is drawn at 1 art pixel = 1 canvas pixel on a
// low-resolution buffer that is scaled up with nearest-neighbour filtering.

import { providerMeta } from "./meta.js";

export const HEX = { w: 34, h: 36, cap: 9, side: 6 };
HEX.row = HEX.h - HEX.cap; // vertical distance between hex rows

const OUTLINE = "#161827";

// ---------------------------------------------------------------- robots

// 13 x 16. Rows 0-2: antenna, 3-8: head, 9-13: body, 14-15: legs.
const ANTENNA = {
  star:    ["....a.a.a....", ".....aaa.....", "......k......"],
  visor:   ["......a......", "......k......", "......k......"],
  goggles: [".............", "..a.......a..", "..k.......k.."],
  sparkle: ["......a......", ".....aaa.....", "......a......"],
};
const FACE = {
  star:    [".khhhhhhhhbk.", ".khvvvvvvvbk.", ".kbvevvvevbk.", ".kbvvvvvvvBk."],
  visor:   [".khhhhhhhhbk.", ".kbvvvvvvvbk.", ".kbveeeeevbk.", ".kbvvvvvvvBk."],
  goggles: [".khhhhhhhhbk.", ".kkkkbbbkkkk.", ".kkevkbkevkk.", ".kbkkBBBkkBk."],
  sparkle: [".khhhhhhhhbk.", ".khvvvvvvvbk.", ".kbvevvvevbk.", ".kbvvvevvvBk."],
};
const BODY = [
  "..kkkkkkkkk..",
  ".kmkbhhhbkmk.",
  ".kmkbhchbkmk.",
  ".kMkbbbbbkMk.",
  "..k.kBBBk.k..",
];
const LEGS = {
  stand: ["....kMkMk....", "...kkk.kkk..."],
  step:  ["...kMk..kMk..", "...kk....kk.."],
  hover: [".....kMMk....", "......ff....."],
  hover2:[".....kMMk....", ".....f..f...."],
};
const BODY_UP = [ // arms raised (working)
  "mkkkkkkkkkkkm",
  "kk.kbhhhbk.kk",
  "...kbhchbk...",
  "...kbbbbbk...",
  "....kBBBk....",
];

function robotRows(head, frame) {
  const top = [...ANTENNA[head], "..kkkkkkkkk..", ...FACE[head], "..kkkkkkkkk.."];
  const body = frame.arms ? BODY_UP : BODY;
  return [...top, ...body, ...LEGS[frame.legs]];
}

const spriteCache = new Map();

/**
 * Returns an offscreen canvas with the robot drawn.
 * opts: { provider, legs: stand|step|hover|hover2, arms, eyes: open|closed|off, chest, gray }
 */
export function robotSprite(opts) {
  const key = JSON.stringify(opts);
  let c = spriteCache.get(key);
  if (c) return c;
  const m = providerMeta(opts.provider);
  const rows = robotRows(m.head, opts);
  const gray = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const v = Math.round(((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) * 0.6);
    return `rgb(${v},${v},${v + 8})`;
  };
  const col = (x) => (opts.gray ? gray(x) : x);
  const eye = opts.eyes === "open" ? m.eye : opts.eyes === "closed" ? "#2a3050" : "#262a3a";
  const pal = {
    k: OUTLINE, b: col(m.body), B: col(m.shade), h: col(m.light), v: "#1d2342",
    e: opts.gray ? "#262a3a" : eye, a: col(m.accent), m: col("#b9c0d3"), M: col("#6d7489"),
    c: opts.chest || "#46e07a", f: "#ffb347",
  };
  c = document.createElement("canvas");
  c.width = 13;
  c.height = rows.length;
  const g = c.getContext("2d");
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === "." || !pal[ch]) continue;
      g.fillStyle = pal[ch];
      g.fillRect(x, y, 1, 1);
    }
  });
  spriteCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- tiles

export const TERRAIN = {
  grass:  { top: "#5fa844", hi: "#7cc255", lo: "#468a33", side: "#6b4a2b", side2: "#4b321d" },
  meadow: { top: "#6db34a", hi: "#94d162", lo: "#529639", side: "#6b4a2b", side2: "#4b321d" },
  sand:   { top: "#dcc47e", hi: "#efdca0", lo: "#bfa663", side: "#8d6e3f", side2: "#5e4826" },
  stone:  { top: "#8d93a6", hi: "#a9afc0", lo: "#6f7588", side: "#4e5366", side2: "#363a4a" },
  floor:  { top: "#5d6480", hi: "#7a82a0", lo: "#474d66", side: "#3a3f55", side2: "#262a3a" },
  core:   { top: "#6c5a9e", hi: "#8b78c2", lo: "#54457d", side: "#3a3f55", side2: "#262a3a" },
  water:  { top: "#2e6db4", hi: "#5596dc", lo: "#255a96", side: "#1d467a", side2: "#16365f" },
};

/** Half-width of the hex at row y (pointy-top). */
function hexHalf(y) {
  const { w, h, cap } = HEX;
  if (y < cap) return Math.round((w / 2) * ((y + 1) / cap));
  if (y >= h - cap) return Math.round((w / 2) * ((h - y) / cap));
  return w / 2;
}

function hash(x, y, s = 0) {
  let n = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

const tileCache = new Map();

/** A hex tile with a textured top and a cliff edge underneath. */
export function tileSprite(kind, seed = 0) {
  const key = kind + ":" + (seed % 4);
  let c = tileCache.get(key);
  if (c) return c;
  const t = TERRAIN[kind];
  const { w, h, side } = HEX;
  c = document.createElement("canvas");
  c.width = w;
  c.height = h + side;
  const g = c.getContext("2d");
  const flat = kind === "water";
  // cliff
  if (!flat) {
    for (let y = HEX.h - HEX.cap; y < h; y++) {
      const half = hexHalf(y);
      g.fillStyle = t.side2;
      g.fillRect(w / 2 - half, y + side, half * 2, 1);
      g.fillStyle = t.side;
      g.fillRect(w / 2 - half, y + 1, half * 2, side - 1);
    }
  }
  // top
  for (let y = 0; y < h; y++) {
    const half = hexHalf(y);
    g.fillStyle = t.top;
    g.fillRect(w / 2 - half, y, half * 2, 1);
  }
  // texture: dithered highlights/lowlights, brighter towards the top-left
  for (let y = 1; y < h - 1; y++) {
    const half = hexHalf(y) - 1;
    for (let x = w / 2 - half; x < w / 2 + half; x++) {
      const r = hash(x, y, seed % 4 + kind.length);
      if (kind === "floor" || kind === "core") {
        if ((x + y) % 8 === 0 && y % 4 === 0) { g.fillStyle = t.hi; g.fillRect(x, y, 1, 1); }
        if (y % 9 === 4) { g.fillStyle = t.lo; g.fillRect(x, y, 1, 1); }
      } else if (r < 0.07) {
        g.fillStyle = t.hi; g.fillRect(x, y, 1, 1);
      } else if (r > 0.92) {
        g.fillStyle = t.lo; g.fillRect(x, y, 1, 1);
      }
    }
  }
  // rim light on the upper edges, shadow on the lower ones
  for (let y = 0; y < h; y++) {
    const half = hexHalf(y);
    g.fillStyle = y < h / 2 ? t.hi : t.lo;
    g.fillRect(w / 2 - half, y, 1, 1);
    g.fillRect(w / 2 + half - 1, y, 1, 1);
  }
  tileCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- drawing helpers

export function px(g, x, y, w, h, color) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), w, h);
}

function box(g, x, y, w, h, fill, outline = OUTLINE) {
  px(g, x, y, w, h, outline);
  px(g, x + 1, y + 1, w - 2, h - 2, fill);
}

// ---------------------------------------------------------------- decorations

export function drawTree(g, x, y, v) {
  const dark = v > 0.5 ? "#2f6b2f" : "#2c5f3a";
  const mid = v > 0.5 ? "#3f8f3a" : "#3b7d4b";
  const lit = v > 0.5 ? "#63b54b" : "#5aa66a";
  px(g, x - 1, y - 4, 3, 5, "#5a3a20");
  px(g, x - 5, y - 12, 11, 8, OUTLINE);
  px(g, x - 4, y - 15, 9, 12, OUTLINE);
  px(g, x - 4, y - 12, 9, 7, dark);
  px(g, x - 3, y - 14, 7, 10, mid);
  px(g, x - 2, y - 13, 3, 3, lit);
  px(g, x + 1, y - 10, 2, 2, lit);
}

export function drawRock(g, x, y) {
  px(g, x - 3, y - 3, 7, 4, OUTLINE);
  px(g, x - 2, y - 4, 5, 1, OUTLINE);
  px(g, x - 2, y - 3, 5, 3, "#8d93a6");
  px(g, x - 1, y - 3, 2, 1, "#b9bfd0");
}

export function drawFlowers(g, x, y, v) {
  const c = v > 0.66 ? "#ff7ab8" : v > 0.33 ? "#ffe066" : "#ffffff";
  for (const [dx, dy] of [[-3, 0], [2, -2], [0, 2]]) {
    px(g, x + dx, y + dy, 1, 1, c);
    px(g, x + dx, y + dy + 1, 1, 1, "#3f8f3a");
  }
}

// ---------------------------------------------------------------- buildings
// (x, y) is the centre of the hex top. `t` is time in seconds, `on` = in use.

export function drawBuilding(g, station, x, y, t, on, accent) {
  switch (station) {
    case "hub": return drawCore(g, x, y, t, on, accent);
    case "library": return drawLibrary(g, x, y, t, on);
    case "forge": return drawForge(g, x, y, t, on);
    case "terminal": return drawTerminal(g, x, y, t, on);
    case "radar": return drawRadar(g, x, y, t, on);
    case "tasks": return drawTasks(g, x, y, t, on);
    case "dock": return drawDock(g, x, y, t, on);
  }
}

function drawCore(g, x, y, t, on, accent = "#59f3ff") {
  const pulse = on ? (Math.sin(t * 4) + 1) / 2 : 0.2;
  // plinth
  px(g, x - 10, y - 3, 21, 5, OUTLINE);
  px(g, x - 9, y - 2, 19, 3, "#8b78c2");
  px(g, x - 9, y, 19, 1, "#54457d");
  // pillar
  box(g, x - 5, y - 17, 11, 15, "#b8b0dc");
  px(g, x - 3, y - 15, 2, 11, "#dcd6f5");
  px(g, x + 2, y - 15, 2, 11, "#8b78c2");
  // glowing window
  px(g, x - 1, y - 12, 3, 6, pulse > 0.5 ? accent : "#3d4a7a");
  // crystal
  const cy = y - 24 - Math.round(Math.sin(t * 2) * 1.5);
  const cc = on ? accent : "#7f8cc0";
  px(g, x, cy - 4, 1, 1, OUTLINE);
  px(g, x - 1, cy - 3, 3, 1, OUTLINE);
  px(g, x - 2, cy - 2, 5, 4, OUTLINE);
  px(g, x - 1, cy + 2, 3, 1, OUTLINE);
  px(g, x, cy + 3, 1, 1, OUTLINE);
  px(g, x, cy - 3, 1, 1, cc);
  px(g, x - 1, cy - 2, 3, 4, cc);
  px(g, x, cy + 2, 1, 1, cc);
  px(g, x - 1, cy - 2, 1, 2, "#ffffff");
  if (on) {
    // light rays
    const r = 5 + Math.round(pulse * 3);
    px(g, x - r - 2, cy, 2, 1, accent);
    px(g, x + r + 1, cy, 2, 1, accent);
    px(g, x, cy - r - 3, 1, 2, accent);
  }
}

function drawLibrary(g, x, y, t, on) {
  // walls
  box(g, x - 11, y - 13, 22, 14, "#e2d2a8");
  px(g, x - 10, y - 1, 20, 1, "#b9a57a");
  // roof (stepped)
  for (let i = 0; i < 6; i++) {
    px(g, x - 13 + i * 2, y - 14 - i * 2, 26 - i * 4, 2, OUTLINE);
    px(g, x - 12 + i * 2, y - 14 - i * 2, 24 - i * 4, 1, i % 2 ? "#3b5bb0" : "#4d70cc");
  }
  // shelf window with book spines
  box(g, x - 9, y - 11, 10, 8, "#5a3a20");
  const spines = ["#e94f4f", "#4fb3e9", "#f2c14e", "#6fcf6f", "#b07cf0", "#e98a4f", "#4fe9c5", "#ffffff"];
  for (let i = 0; i < 8; i++) {
    const hgt = 3 + ((i * 7) % 3);
    px(g, x - 8 + i, y - 4 - hgt, 1, hgt, spines[i]);
  }
  // door
  box(g, x + 3, y - 9, 6, 10, "#8a5a2b");
  px(g, x + 7, y - 5, 1, 1, "#ffd166");
  if (on) {
    // floating page
    const k = (t * 1.5) % 1;
    const py = y - 18 - Math.round(k * 10);
    px(g, x + 8, py, 4, 3, OUTLINE);
    px(g, x + 9, py + 1, 2, 1, "#ffffff");
  }
}

function drawForge(g, x, y, t, on) {
  // chimney
  box(g, x + 4, y - 24, 6, 12, "#6f6f80");
  // furnace body with bricks
  box(g, x - 10, y - 15, 20, 16, "#8c8c9c");
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      px(g, x - 9 + c * 5 + (r % 2 ? 2 : 0), y - 13 + r * 4, 1, 3, "#6f6f80");
    }
    px(g, x - 9, y - 11 + r * 4, 18, 1, "#6f6f80");
  }
  // mouth
  const flick = on ? Math.floor(t * 10) % 3 : 0;
  box(g, x - 6, y - 9, 10, 9, OUTLINE);
  px(g, x - 5, y - 8, 8, 8, on ? ["#ff7a1a", "#ff9a2a", "#ffb347"][flick] : "#3a2a2a");
  if (on) {
    px(g, x - 3, y - 6, 4, 5, "#ffe066");
    // smoke
    for (let i = 0; i < 3; i++) {
      const k = ((t * 0.6 + i / 3) % 1);
      const sx = x + 7 + Math.round(Math.sin((t + i) * 3) * 2);
      const sy = y - 26 - Math.round(k * 14);
      px(g, sx - 1, sy, 3, 2, k > 0.6 ? "#9aa0b0" : "#c9cdd8");
    }
    // sparks
    for (let i = 0; i < 4; i++) {
      const k = (t * 2 + i * 0.25) % 1;
      px(g, x - 12 - i * 2 + Math.round(k * 4), y - 2 - Math.round(Math.sin(k * Math.PI) * 8), 1, 1, i % 2 ? "#ffe066" : "#ffffff");
    }
  }
  // anvil
  px(g, x - 15, y - 3, 7, 2, OUTLINE);
  px(g, x - 14, y - 3, 5, 1, "#b9c0d3");
  px(g, x - 13, y - 1, 3, 2, OUTLINE);
}

function drawTerminal(g, x, y, t, on) {
  // desk
  px(g, x - 12, y - 5, 24, 3, OUTLINE);
  px(g, x - 11, y - 5, 22, 1, "#a8743f");
  px(g, x - 11, y - 2, 2, 3, OUTLINE);
  px(g, x + 9, y - 2, 2, 3, OUTLINE);
  // monitor
  box(g, x - 9, y - 21, 18, 15, "#d6cfb8");
  px(g, x - 7, y - 19, 14, 10, "#0b2413");
  px(g, x - 2, y - 6, 4, 1, "#9e977f");
  if (on) {
    const scroll = Math.floor(t * 6);
    for (let i = 0; i < 4; i++) {
      const w = 3 + ((scroll + i * 5) % 9);
      px(g, x - 6, y - 18 + i * 2, w, 1, i === 3 ? "#b6ffcf" : "#3cff7a");
    }
    if (Math.floor(t * 3) % 2) px(g, x - 6 + 1 + ((scroll + 15) % 9), y - 12, 2, 1, "#b6ffcf");
  } else {
    px(g, x - 6, y - 18, 2, 1, "#1f5a33");
  }
  // keyboard
  px(g, x - 6, y - 7, 12, 2, OUTLINE);
  px(g, x - 5, y - 7, 10, 1, "#9e977f");
  // server tower
  box(g, x + 11, y - 13, 6, 12, "#4a5068");
  px(g, x + 13, y - 11, 2, 1, on && Math.floor(t * 8) % 2 ? "#46e07a" : "#2a6040");
  px(g, x + 13, y - 8, 2, 1, on && Math.floor(t * 5) % 2 ? "#ffd23f" : "#6a5a2a");
}

function drawRadar(g, x, y, t, on) {
  // tower
  for (let i = 0; i < 14; i++) {
    px(g, x - 6 + Math.round(i * 0.4), y - i, 1, 1, OUTLINE);
    px(g, x + 6 - Math.round(i * 0.4), y - i, 1, 1, OUTLINE);
    if (i % 4 === 2) px(g, x - 5 + Math.round(i * 0.4), y - i, 11 - Math.round(i * 0.8), 1, "#6d7489");
  }
  px(g, x - 1, y - 18, 3, 5, OUTLINE);
  // dish: 3 facings
  const phase = on ? Math.floor(t * 2) % 4 : 1;
  const face = [0, 1, 2, 1][phase];
  const dx = [-4, 0, 4][face];
  px(g, x - 8 + dx / 2, y - 25, 17 - Math.abs(dx), 7, OUTLINE);
  px(g, x - 7 + dx / 2, y - 24, 15 - Math.abs(dx), 5, "#dfe3ee");
  px(g, x - 7 + dx / 2, y - 21, 15 - Math.abs(dx), 2, "#aab1c4");
  px(g, x + dx / 2, y - 29, 1, 5, OUTLINE);
  px(g, x + dx / 2, y - 30, 1, 1, on && Math.floor(t * 4) % 2 ? "#ff5a6a" : "#7a2a33");
  if (on) {
    for (let i = 0; i < 3; i++) {
      const k = (t * 1.2 + i / 3) % 1;
      const r = 4 + Math.round(k * 12);
      const col = k < 0.5 ? "#9ae6ff" : "#4f93d6";
      px(g, x + dx / 2 + r, y - 31 - Math.round(r / 2), 1, 3, col);
      px(g, x + dx / 2 - r, y - 31 - Math.round(r / 2), 1, 3, col);
    }
  }
}

function drawTasks(g, x, y, t, on) {
  // posts
  px(g, x - 11, y - 18, 2, 19, OUTLINE);
  px(g, x + 9, y - 18, 2, 19, OUTLINE);
  // board
  box(g, x - 12, y - 20, 24, 14, "#9a6a35");
  px(g, x - 11, y - 19, 22, 1, "#b88448");
  const notes = ["#ffe066", "#ff9ec7", "#9ae6ff", "#b6ffcf", "#ffe066"];
  const pos = [[-9, -17], [-3, -16], [3, -17], [-6, -11], [1, -11]];
  pos.forEach(([nx, ny], i) => {
    const wob = on && i === Math.floor(t * 2) % 5 ? -1 : 0;
    px(g, x + nx, y + ny + wob, 5, 4, notes[i]);
    px(g, x + nx + 1, y + ny + 1 + wob, 3, 1, "#8a7a6a");
    px(g, x + nx + 2, y + ny + wob, 1, 1, "#e94f4f");
  });
  if (on && Math.floor(t * 2) % 2) {
    px(g, x + 12, y - 30, 3, 7, OUTLINE);
    px(g, x + 13, y - 29, 1, 4, "#ffd23f");
    px(g, x + 12, y - 22, 3, 3, OUTLINE);
    px(g, x + 13, y - 21, 1, 1, "#ffd23f");
  }
}

function drawDock(g, x, y, t, on) {
  const pads = [[-9, -3], [9, -3], [0, 5]];
  pads.forEach(([dx, dy], i) => {
    px(g, x + dx - 6, y + dy - 1, 12, 4, OUTLINE);
    px(g, x + dx - 5, y + dy - 1, 10, 2, "#4a5068");
    const glow = Math.floor(t * 2 + i) % 3 === 0;
    px(g, x + dx - 4, y + dy, 8, 1, glow ? "#6fb6ff" : "#35507a");
  });
  // charging pylon
  box(g, x - 2, y - 20, 5, 16, "#4a5068");
  const lvl = Math.floor(t * 1.5) % 4;
  for (let i = 0; i < 4; i++) px(g, x - 1, y - 7 - i * 3, 3, 2, i <= lvl ? "#46e07a" : "#244030");
  // bolt
  px(g, x, y - 25, 2, 2, "#ffd23f");
  px(g, x - 1, y - 23, 2, 2, "#ffd23f");
  px(g, x, y - 21, 1, 1, "#ffd23f");
}

// ---------------------------------------------------------------- held tools / bubbles

export function drawToolFx(g, station, x, y, t) {
  const swing = Math.floor(t * 6) % 2;
  switch (station) {
    case "forge": // hammer
      px(g, x, y - 2 - swing * 2, 1, 5, "#8a5a2b");
      px(g, x - 1, y - 4 - swing * 2, 3, 2, "#b9c0d3");
      break;
    case "library": // open book
      px(g, x - 2, y, 5, 3, OUTLINE);
      px(g, x - 1, y, 1, 2, "#ffffff");
      px(g, x + 1, y, 1, 2, swing ? "#ffffff" : "#dfe3ee");
      break;
    case "terminal": // typing sparks
      px(g, x - 1 + swing * 2, y + 1, 1, 1, "#3cff7a");
      break;
    case "radar": // antenna pulse
      if (swing) { px(g, x, y - 4, 1, 1, "#9ae6ff"); px(g, x + 2, y - 6, 1, 1, "#9ae6ff"); }
      break;
    case "tasks": // note
      px(g, x - 1, y - 1 - swing, 4, 3, "#ffe066");
      break;
  }
}

/** Speech/thought bubble with an icon: "think" | "wait" | "block" | "sleep" | "user". */
export function drawBubble(g, kind, x, y, t, color) {
  if (kind === "sleep") {
    const k = (t * 0.8) % 1;
    const zx = x + 4 + Math.round(k * 4);
    const zy = y - Math.round(k * 8);
    const c = k > 0.7 ? "#7c7fa8" : "#c9cbe8";
    px(g, zx, zy, 3, 1, c); px(g, zx + 1, zy + 1, 1, 1, c); px(g, zx, zy + 2, 3, 1, c);
    return;
  }
  const w = 11, h = 9;
  const bx = Math.round(x - w / 2), by = Math.round(y - h);
  px(g, bx + 1, by, w - 2, h, OUTLINE);
  px(g, bx, by + 1, w, h - 2, OUTLINE);
  px(g, bx + 1, by + 1, w - 2, h - 2, "#ffffff");
  px(g, bx + 4, by + h, 2, 1, OUTLINE);
  px(g, bx + 4, by + h + 1, 1, 1, OUTLINE);
  const cx = bx + 5, cy = by + 4;
  if (kind === "think") {
    const n = Math.floor(t * 3) % 4;
    for (let i = 0; i < 3; i++) px(g, cx - 3 + i * 3, cy, 2, 1, i < n ? color || "#3a3f55" : "#c9cdd8");
  } else if (kind === "wait") {
    const blink = Math.floor(t * 3) % 2;
    px(g, cx, cy - 3, 1, 4, blink ? "#e0a800" : "#ffb800");
    px(g, cx, cy + 2, 1, 1, blink ? "#e0a800" : "#ffb800");
  } else if (kind === "block") {
    px(g, cx - 1, cy - 3, 3, 1, "#ff3a4a"); px(g, cx + 1, cy - 2, 1, 2, "#ff3a4a");
    px(g, cx, cy, 1, 1, "#ff3a4a"); px(g, cx, cy + 2, 1, 1, "#ff3a4a");
  } else if (kind === "user") {
    px(g, cx - 3, cy - 1, 7, 1, "#3a8ff0"); px(g, cx - 3, cy + 1, 5, 1, "#3a8ff0");
  } else if (kind === "error") {
    px(g, cx - 2, cy - 2, 1, 1, "#ff3a4a"); px(g, cx + 2, cy - 2, 1, 1, "#ff3a4a");
    px(g, cx - 1, cy - 1, 3, 3, "#ff3a4a"); px(g, cx - 2, cy + 2, 1, 1, "#ff3a4a"); px(g, cx + 2, cy + 2, 1, 1, "#ff3a4a");
    px(g, cx, cy, 1, 1, "#ffffff");
  }
}
