// Pixel art. Everything is drawn at 1 art pixel = 1 canvas pixel on a
// low-resolution buffer that is scaled up with nearest-neighbour filtering.

import { providerMeta } from "./meta.js";

export const HEX = { w: 40, h: 44, cap: 11, side: 6 };
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
  sit:   ["..kMMk.kMMk..", "............."], // feet towards the viewer; drawn 2px lower
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

// 11 x 9 sub-agent drone: rotor, body in the agent's colours, two eyes, status light, skids.
const DRONE = {
  rotorA: "mmmm.k.mmmm",
  rotorB: "...mmkmm...",
  body: [
    ".....k.....",
    "..kkkkkkk..",
    ".kbhhhhhbk.",
    ".kbvevevbk.",
    ".kBbbcbbBk.",
    "..kkkkkkk..",
    "..k.....k..",
    ".kk.....kk.",
  ],
};

/**
 * Offscreen canvas with a sub-agent drone. opts: { provider, rotor: 0|1, eyes, chest, gray }.
 * With `portrait: true` it is centred on a 13 x 16 canvas, the size of a robot portrait.
 */
export function droneSprite(opts) {
  const key = "drone" + JSON.stringify(opts);
  let c = spriteCache.get(key);
  if (c) return c;
  const m = providerMeta(opts.provider);
  const shade = (hex) => {
    if (!opts.gray) return hex;
    const n = parseInt(hex.slice(1), 16);
    const v = Math.round(((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) * 0.6);
    return `rgb(${v},${v},${v + 8})`;
  };
  const pal = {
    k: OUTLINE, b: shade(m.body), B: shade(m.shade), h: shade(m.light), v: "#1d2342",
    e: opts.gray || opts.eyes === "off" ? "#262a3a" : opts.eyes === "closed" ? "#2a3050" : m.eye,
    m: shade("#b9c0d3"), c: opts.chest || "#46e07a",
  };
  const rows = [opts.rotor ? DRONE.rotorB : DRONE.rotorA, ...DRONE.body];
  c = document.createElement("canvas");
  c.width = opts.portrait ? 13 : 11;
  c.height = opts.portrait ? 16 : rows.length;
  const ox = opts.portrait ? 1 : 0, oy = opts.portrait ? 4 : 0;
  const g = c.getContext("2d");
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === "." || !pal[ch]) continue;
      g.fillStyle = pal[ch];
      g.fillRect(x + ox, y + oy, 1, 1);
    }
  });
  spriteCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- tiles

export const TERRAIN = {
  grass:  { top: "#629b62", hi: "#88b879", lo: "#558757", side: "#947251", side2: "#594635" },
  meadow: { top: "#70a66a", hi: "#9bc780", lo: "#63955e", side: "#947251", side2: "#594635" },
  sand:   { top: "#dcc47e", hi: "#efdca0", lo: "#bfa663", side: "#8d6e3f", side2: "#5e4826" },
  stone:  { top: "#8d93a6", hi: "#a9afc0", lo: "#6f7588", side: "#4e5366", side2: "#363a4a" },
  floor:  { top: "#768591", hi: "#98a6ac", lo: "#687985", side: "#475865", side2: "#304553" },
  core:   { top: "#837caa", hi: "#a79bc9", lo: "#706995", side: "#50516c", side2: "#353b53" },
  water:  { top: "#193e56", hi: "#26576c", lo: "#193e56", side: "#193e56", side2: "#193e56" },
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
        if (y % 12 === 4 || (x + (Math.floor(y / 12) % 2) * 10) % 20 === 0) {
          g.fillStyle = t.lo; g.fillRect(x, y, 1, 1);
        }
      } else if (kind === "water") {
        if (y % 13 === 0 && x > 12 && x < 19) { g.fillStyle = t.hi; g.fillRect(x, y, 1, 1); }
      } else if (r < 0.014) {
        g.fillStyle = t.hi; g.fillRect(x, y, 1, 1);
      } else if (r > 0.986) {
        g.fillStyle = t.lo; g.fillRect(x, y, 1, 1);
      }
    }
  }
  // rim light on the upper edges, shadow on the lower ones
  for (let y = 0; !flat && y < h; y++) {
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
  px(g, x - 6, y, 14, 3, "rgba(22,40,36,0.18)");
  box(g, x - 2, y - 7, 5, 9, "#946448");
  px(g, x - 1, y - 5, 1, 5, "#c49262");
  px(g, x - 7, y - 16, 15, 9, OUTLINE);
  px(g, x - 5, y - 20, 11, 16, OUTLINE);
  px(g, x - 8, y - 13, 17, 6, OUTLINE);
  px(g, x - 6, y - 16, 13, 9, dark);
  px(g, x - 4, y - 19, 9, 13, mid);
  px(g, x - 7, y - 12, 7, 5, mid);
  px(g, x - 3, y - 18, 5, 3, lit);
  px(g, x - 5, y - 14, 4, 3, lit);
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
  // A shared contact shadow anchors each object to the paving.
  px(g, x - 13, y + 1, 27, 3, "rgba(22,24,39,0.22)");
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
  px(g, x - 12, y + 2, 25, 2, "#cec2ec");
  px(g, x - 10, y + 4, 21, 1, "#66588b");
  // pillar
  box(g, x - 5, y - 17, 11, 15, "#b8b0dc");
  px(g, x - 3, y - 15, 2, 11, "#dcd6f5");
  px(g, x + 2, y - 15, 2, 11, "#8b78c2");
  // glowing window
  px(g, x - 1, y - 12, 3, 6, pulse > 0.5 ? accent : "#3d4a7a");
  // crystal
  const cy = y - 24 - Math.round(Math.sin(t * 2) * 1.5);
  const cc = on ? accent : "#7f8cc0";
  for (let row = -5; row <= 5; row++) {
    const half = Math.min(3, 5 - Math.abs(row));
    px(g, x - half, cy + row, half * 2 + 1, 1, OUTLINE);
    if (half) {
      px(g, x - half + 1, cy + row, half, 1, cc);
      if (half > 1) px(g, x + 1, cy + row, half - 1, 1, "#4593af");
    }
  }
  px(g, x - 1, cy - 2, 1, 4, "#eaffff");
  if (on) {
    // light rays
    const r = 5 + Math.round(pulse * 3);
    px(g, x - r - 2, cy, 2, 1, accent);
    px(g, x + r + 1, cy, 2, 1, accent);
    px(g, x, cy - r - 3, 1, 2, accent);
  }
}

function drawLibrary(g, x, y, t, on) {
  // Blue gabled roof, warm walls, and a broad two-tier bookshelf.
  box(g, x - 13, y - 17, 27, 19, "#eadbb5");
  px(g, x + 10, y - 16, 3, 17, "#b8a47e");
  for (let i = 0; i < 6; i++) {
    px(g, x - 15 + i * 2, y - 18 - i * 2, 31 - i * 4, 2, OUTLINE);
    px(g, x - 14 + i * 2, y - 18 - i * 2, 29 - i * 4, 1, "#739ddb");
    px(g, x - 13 + i * 2, y - 17 - i * 2, 27 - i * 4, 1, "#4166a5");
  }
  box(g, x - 11, y - 15, 14, 14, "#56402f");
  const spines = ["#ed8667", "#87c6d6", "#f6d883", "#b3bc80"];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 4; i++) {
      px(g, x - 10 + i * 3, y - 14 + row * 6, 2, 4, spines[(i + row) % 4]);
      px(g, x - 10 + i * 3, y - 13 + row * 6, 1, 1, "#fff0cc");
    }
    px(g, x - 10, y - 10 + row * 6, 12, 1, "#b88852");
  }
  box(g, x + 5, y - 12, 6, 14, "#775335");
  px(g, x + 8, y - 5, 1, 1, "#ffe1a0");
  // Open-book emblem, readable even while the station is inactive.
  box(g, x - 4, y - 23, 9, 5, "#fff4d6");
  px(g, x, y - 22, 1, 3, "#ab875a");
  px(g, x + 4, y + 1, 9, 2, "#c7b994");
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
  box(g, x + 5, y - 28, 7, 15, "#aa7360");
  box(g, x + 4, y - 29, 9, 3, "#ddad83");
  // furnace body with bricks
  box(g, x - 9, y - 18, 23, 20, "#b67d62");
  px(g, x - 8, y - 17, 21, 2, "#e2ac7c");
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      px(g, x - 8 + c * 5 + (r % 2 ? 2 : 0), y - 13 + r * 4, 1, 3, "#885b4e");
    }
    px(g, x - 8, y - 11 + r * 4, 21, 1, "#885b4e");
  }
  // mouth
  const flick = on ? Math.floor(t * 10) % 3 : 0;
  box(g, x - 4, y - 11, 13, 12, "#4b3030");
  px(g, x - 2, y - 13, 9, 2, OUTLINE);
  px(g, x - 3, y - 8, 11, 8, on ? ["#ff7a1a", "#ff9a2a", "#ffb347"][flick] : "#75413a");
  px(g, x - 2, y - 2, 9, 2, on ? "#ffe7a3" : "#b86d4e");
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
  px(g, x - 18, y - 7, 13, 3, OUTLINE);
  px(g, x - 17, y - 7, 11, 1, "#e0e5e6");
  px(g, x - 15, y - 6, 8, 2, "#8195a7");
  px(g, x - 13, y - 4, 4, 4, OUTLINE);
  px(g, x - 16, y, 10, 2, "#526574");
}

function drawTerminal(g, x, y, t, on) {
  // desk
  px(g, x - 12, y - 5, 24, 3, OUTLINE);
  px(g, x - 11, y - 5, 22, 1, "#a8743f");
  px(g, x - 11, y - 2, 2, 3, OUTLINE);
  px(g, x + 9, y - 2, 2, 3, OUTLINE);
  // monitor
  box(g, x - 11, y - 24, 22, 17, "#d6e0d9");
  px(g, x - 10, y - 23, 20, 1, "#f2f5df");
  px(g, x + 8, y - 22, 2, 14, "#8baba8");
  px(g, x - 9, y - 22, 16, 12, "#143c39");
  px(g, x - 2, y - 6, 4, 1, "#9e977f");
  if (on) {
    const scroll = Math.floor(t * 6);
    for (let i = 0; i < 4; i++) {
      const w = 3 + ((scroll + i * 5) % 9);
      px(g, x - 6, y - 18 + i * 2, w, 1, i === 3 ? "#b6ffcf" : "#3cff7a");
    }
    if (Math.floor(t * 3) % 2) px(g, x - 6 + 1 + ((scroll + 15) % 9), y - 12, 2, 1, "#b6ffcf");
  } else {
    // Keep a recognizable command prompt on the idle screen.
    px(g, x - 7, y - 19, 1, 1, "#a3e1c4");
    px(g, x - 6, y - 18, 1, 1, "#a3e1c4");
    px(g, x - 7, y - 17, 1, 1, "#a3e1c4");
    px(g, x - 3, y - 17, 4, 1, "#a3e1c4");
  }
  // keyboard
  px(g, x - 6, y - 7, 12, 2, OUTLINE);
  px(g, x - 5, y - 7, 10, 1, "#9e977f");
  for (let i = 0; i < 5; i++) px(g, x - 5 + i * 2, y - 7, 1, 1, "#edf0d7");
  // server tower
  box(g, x + 11, y - 13, 6, 12, "#4a5068");
  px(g, x + 13, y - 11, 2, 1, on && Math.floor(t * 8) % 2 ? "#46e07a" : "#2a6040");
  px(g, x + 13, y - 8, 2, 1, on && Math.floor(t * 5) % 2 ? "#ffd23f" : "#6a5a2a");
}

function drawRadar(g, x, y, t, on) {
  // A substantial mast and foot support a broad, front-facing satellite dish.
  box(g, x - 4, y - 17, 7, 17, "#8298aa");
  px(g, x - 3, y - 15, 2, 13, "#c4d5df");
  for (let i = 0; i < 8; i++) {
    px(g, x - 4 - Math.floor(i / 2), y - 8 + i, 2, 2, "#526a80");
    px(g, x + 2 + Math.floor(i / 2), y - 8 + i, 2, 2, "#526a80");
  }
  box(g, x - 10, y - 1, 21, 4, "#8197a5");
  px(g, x - 8, y, 17, 1, "#d0dce2");

  // A continuous oval rim and a shaded bowl remain legible at map scale.
  // Fixed orientation avoids the thin, ambiguous silhouette of an edge-on dish.
  const widths = [9, 15, 19, 21, 23, 25, 25, 25, 25, 25, 23, 23, 21, 19, 15, 11, 5];
  widths.forEach((w, row) => {
    const left = x - 2 - Math.floor(w / 2);
    px(g, left, y - 32 + row, w, 1, OUTLINE);
    if (row > 0 && row < widths.length - 1) {
      px(g, left + 1, y - 32 + row, w - 2, 1, row < 11 ? "#f0f4e9" : "#92abbc");
    }
  });
  const bowl = [7, 11, 15, 17, 17, 17, 15, 13, 9];
  bowl.forEach((w, row) => {
    px(g, x - 1 - Math.floor(w / 2), y - 28 + row, w, 1, row < 5 ? "#c3d8e0" : "#a3bece");
  });
  // Central receiver and a diagonal arm projecting beyond the rim.
  box(g, x - 5, y - 25, 6, 6, "#6e94ad");
  for (let i = 0; i < 11; i++) {
    px(g, x - 3 + i, y - 23 - i, 3, 3, OUTLINE);
    px(g, x - 2 + i, y - 23 - i, 1, 2, "#e2eced");
  }
  box(g, x + 6, y - 35, 5, 5, on ? "#ffe6a3" : "#e99767");
  // Radio-wave brackets also identify the station while it is idle.
  for (let i = 0; i < 2; i++) {
    const sx = x + 13 + i * 4, sy = y - 35 - i * 3;
    const lit = on && Math.floor(t * 3) % 2 === i;
    const color = lit ? "#bcf7ff" : on ? "#73bedb" : "#7ba6bc";
    px(g, sx, sy, 2, 2, color);
    px(g, sx + 2, sy + 2, 2, 3 + i, color);
    px(g, sx + 2, sy + 5 + i, 1, 2, color);
  }
}

function drawTasks(g, x, y, t, on) {
  // posts
  px(g, x - 11, y - 18, 2, 19, OUTLINE);
  px(g, x + 9, y - 18, 2, 19, OUTLINE);
  // board
  box(g, x - 14, y - 23, 29, 18, "#bd915a");
  px(g, x - 13, y - 22, 27, 2, "#f0c98b");
  px(g, x - 12, y - 19, 25, 12, "#654e42");
  // Three columns distinguish the planning board from a bookshelf.
  px(g, x - 4, y - 18, 1, 10, "#a9845d");
  px(g, x + 4, y - 18, 1, 10, "#a9845d");
  const notes = ["#ffe066", "#ff9ec7", "#9ae6ff", "#b6ffcf", "#ffe066"];
  const pos = [[-10, -17], [-2, -17], [6, -17], [-10, -11], [-2, -11]];
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
    const glow = on && Math.floor(t * 2 + i) % 3 === 0;
    px(g, x + dx - 4, y + dy, 8, 1, glow ? "#6fb6ff" : "#35507a");
  });
  // charging pylon
  box(g, x - 5, y - 22, 11, 18, "#9cbdcb");
  px(g, x - 3, y - 24, 6, 2, "#dcecf0");
  box(g, x - 3, y - 20, 7, 13, "#24463f");
  const lvl = on ? Math.floor(t * 1.5) % 4 : 2;
  for (let i = 0; i < 4; i++) px(g, x - 2, y - 10 - i * 3, 5, 2, i <= lvl ? "#95d9ac" : "#426454");
  px(g, x - 9, y - 12, 4, 2, OUTLINE);
  px(g, x - 10, y - 12, 2, 8, OUTLINE);
  px(g, x + 6, y - 12, 4, 2, OUTLINE);
  px(g, x + 9, y - 12, 2, 8, OUTLINE);
  // bolt
  px(g, x, y - 31, 3, 3, "#ffe39b");
  px(g, x - 2, y - 28, 4, 2, "#ffd23f");
  px(g, x - 1, y - 26, 2, 2, "#ffd23f");
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

// ---------------------------------------------------------------- leisure (idle robots)

function line(g, x0, y0, x1, y1, color) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) px(g, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, 1, 1, color);
}

/**
 * Props for an idle robot's pastime: "fish" | "beach" | "read". (x, y) are the robot's feet,
 * `f` the side it faces (1 right, -1 left), `seed` desynchronises robots. The "back" layer is
 * drawn before the robot sprite, the "front" layer after it.
 */
export function drawLeisure(g, kind, layer, x, y, f, t, seed) {
  if (kind === "beach") {
    if (layer === "back") {
      // Umbrella behind, towel under the robot.
      const ux = x - f * 8;
      px(g, ux, y - 21, 1, 21, "#e8e2d0");
      [[5, 23], [9, 22], [13, 21]].forEach(([w, dy], row) => {
        for (let i = 0; i < w; i++) px(g, ux - (w >> 1) + i, y - dy, 1, 1, row === 0 && (i === 0 || i === w - 1) ? OUTLINE : ((i + row) >> 1) % 2 ? "#ffffff" : "#ff5a6a");
      });
      px(g, ux - 6, y - 20, 13, 1, OUTLINE);
      px(g, x - 7, y - 1, 14, 3, "#235fa6");
      for (let i = 0; i < 14; i += 3) px(g, x - 7 + i, y - 1, 1, 3, "#9ae6ff");
      return;
    }
    // A cold drink, sipped now and then.
    const sip = (t + seed * 6) % 6 < 1;
    const gx = x + f * (sip ? 3 : 6) - 1, gy = y - (sip ? 10 : 6);
    px(g, gx, gy, 3, 4, OUTLINE);
    px(g, gx + 1, gy + 1, 1, 2, "#ffb347");
    px(g, gx + 1, gy, 1, 1, "#fff1c2");
    px(g, gx + 2, gy - 2, 1, 2, "#ff8ad8");
    return;
  }
  if (layer === "back") return;
  if (kind === "read") {
    const flip = (t + seed * 5) % 5;
    const cover = ["#3a8ff0", "#e07a4f", "#46e07a", "#9b6df2"][Math.floor(seed * 4) % 4];
    px(g, x - 5, y - 8, 11, 6, OUTLINE);
    px(g, x - 4, y - 3, 9, 1, cover);
    px(g, x - 4, y - 7, 4, 4, "#fff4d6");
    px(g, x + 1, y - 7, 4, 4, "#fff4d6");
    for (let i = 0; i < 3; i++) { px(g, x - 3, y - 6 + i, 2, 1, "#b9c0d3"); px(g, x + 2, y - 6 + i, 2, 1, "#b9c0d3"); }
    // Turning a page.
    if (flip < 0.5) px(g, x + 4 - Math.floor(flip * 16), y - 7, 1, 4, "#ffffff");
    return;
  }
  // Fishing: rod from the hand, line to a bobber in the water, the odd fish jumping out.
  const hx = x + f * 6, hy = y - 6;
  const tx = x + f * 15, ty = y - 17;
  line(g, hx, hy, tx, ty, "#8a5a2b");
  const k = (t + seed * 10) % 10;
  const bx = x + f * 22;
  const dip = k >= 7 && k < 7.8;
  const by = y + 3 + (dip ? 1 : Math.round(Math.sin(t * 2.5 + seed * 6) * 0.6));
  g.globalAlpha = 0.7;
  line(g, tx, ty, bx, by - 1, "#dfe3ee");
  g.globalAlpha = 1;
  if (k < 7.8 || k >= 9.2) {
    px(g, bx, by - 1, 2, 1, "#ff5a6a");
    px(g, bx, by, 2, 1, "#ffffff");
  }
  if (dip || (k % 3) < 0.6) { px(g, bx - 3, by + 1, 2, 1, "#8cc4f5"); px(g, bx + 3, by + 1, 2, 1, "#8cc4f5"); }
  if (k >= 7.8 && k < 9.2) {
    // The catch arcs out of the water and splashes back.
    const u = (k - 7.8) / 1.4;
    const fx = bx + f * Math.round(u * 8), fy = by - Math.round(Math.sin(u * Math.PI) * 11);
    px(g, fx - 1, fy, 4, 2, "#b9e3ff");
    px(g, fx + (f > 0 ? 3 : -2), fy - 1, 1, 4, "#86c1ff");
    px(g, fx + (f > 0 ? 0 : 2), fy, 1, 1, OUTLINE);
    if (u < 0.15 || u > 0.85) { px(g, bx - 2, by - 2, 1, 1, "#ffffff"); px(g, bx + 3, by - 2, 1, 1, "#ffffff"); }
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
