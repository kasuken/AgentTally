// Pixel interiors for the Agent Office prototype: light tiled floors, thick white walls,
// wooden doors and softly outlined furniture. Original art drawn with rectangles.
// Positions are ground points (where things touch the floor) so the renderer can depth-sort
// furniture together with the robots.

import { px } from "./sprites.js";
import { line, pixelText, textWidth } from "./yard-sprites.js";

export const LINE = "#3b3d4c";
export const OUT = LINE;
export { pixelText, textWidth };

/** Box with the soft office outline. */
export function obox(g, x, y, w, h, fill, outline = LINE) {
  px(g, x, y, w, h, outline);
  px(g, x + 1, y + 1, w - 2, h - 2, fill);
}

const WOOD = "#d9b27e", WOOD_HI = "#ecca98", WOOD_LO = "#b98e5c";
const CHAIR = "#4a4e5e", CHAIR_HI = "#666b7e";
const METAL = "#a3a9b6", METAL_HI = "#c7ccd6";

// ---------------------------------------------------------------- floors and walls

export const FLOORS = {
  tile:    { a: "#c9ccd3", b: "#c3c6ce", line: "#b6bac3", hi: "#d4d7dd", size: 16 },
  lobby:   { a: "#d3d5db", b: "#cdd0d6", line: "#bec2ca", hi: "#dfe1e6", size: 24 },
  wood:    { a: "#c99a63", b: "#c29360", line: "#a97f50", hi: "#d6a96f", size: 8, planks: true },
  kitchen: { a: "#e2dccf", b: "#d9d2c2", line: "#c9c0ad", hi: "#ebe6db", size: 12 },
  bath:    { a: "#e9ecf2", b: "#e2e6ee", line: "#d0d5df", hi: "#f3f5f8", size: 8 },
  server:  { a: "#8a91a1", b: "#848b9b", line: "#737a8a", hi: "#98a0b0", size: 12 },
  dark:    { a: "#7d8292", b: "#777c8c", line: "#6a6f80", hi: "#8a90a0", size: 16 },
};

export function drawFloor(g, x, y, w, h, kind) {
  const f = FLOORS[kind] || FLOORS.tile;
  px(g, x, y, w, h, f.a);
  if (f.planks) {
    for (let yy = 0; yy < h; yy += f.size) {
      px(g, x, y + yy, w, 1, f.line);
      const off = (yy / f.size) % 2 ? 0 : 19;
      for (let xx = off; xx < w; xx += 38) px(g, x + xx, y + yy, 1, f.size, f.line);
      px(g, x, y + yy + 1, w, 1, f.hi);
    }
    return;
  }
  for (let yy = 0; yy < h; yy += f.size) {
    for (let xx = 0; xx < w; xx += f.size) {
      const tw = Math.min(f.size, w - xx), th = Math.min(f.size, h - yy);
      if (((xx + yy) / f.size) % 2) px(g, x + xx, y + yy, tw, th, f.b);
      px(g, x + xx, y + yy, tw, 1, f.line);
      px(g, x + xx, y + yy, 1, th, f.line);
      px(g, x + xx + 1, y + yy + 1, Math.max(0, tw - 2), 1, f.hi);
    }
  }
}

export function drawRug(g, x, y, w, h, color, border) {
  px(g, x, y, w, h, border);
  px(g, x + 2, y + 2, w - 4, h - 4, color);
  for (let xx = x + 4; xx < x + w - 4; xx += 4) { px(g, xx, y - 1, 1, 1, border); px(g, xx, y + h, 1, 1, border); }
}

/** The thick top of a wall running left to right. */
export function wallCapH(g, x, y, w) {
  px(g, x, y, w, 5, LINE);
  px(g, x, y + 1, w, 3, "#f6f6f8");
  px(g, x, y + 3, w, 1, "#dcdde3");
}
/** The thick top of a wall running up and down. */
export function wallCapV(g, x, y, h) {
  px(g, x, y, 6, h, LINE);
  px(g, x + 1, y, 4, h, "#f6f6f8");
  px(g, x + 4, y, 1, h, "#dcdde3");
}
/** The visible front of a wall: warm white with a darker band and a baseboard. */
export function wallFace(g, x, y, w, h) {
  px(g, x, y, w, h, "#e9e6e0");
  px(g, x, y, w, 1, "#d8d4cc");
  px(g, x, y + h - 3, w, 2, "#c9c4ba");
  px(g, x, y + h - 1, w, 1, "#9e988c");
}
/** An open wooden door set into a wall face. `y` is the top of the face, `h` its height. */
export function doorway(g, cx, y, h) {
  const x = cx - 8;
  px(g, x - 1, y - 1, 18, h + 1, "#7a3f1c");
  px(g, x, y, 16, h, "#5a4a44");
  px(g, x, y + h - 1, 16, 1, "#c9ccd3");
  // The door leaf, swung open against the frame.
  px(g, x + 13, y, 3, h, "#c8662e"); px(g, x + 13, y, 1, h, "#e08a4c");
}
export function signPlate(g, text, x, y) {
  const w = textWidth(text) + 4;
  obox(g, x, y, w, 8, "#4a5068");
  pixelText(g, text, x + 2, y + 2, "#f6f6f8");
}

/** Sky colour through the windows, from the local hour. */
export function skyAt(hour) {
  if (hour >= 7 && hour < 17) return { sky: "#a9d4f0", hi: "#d8eefc", night: false };
  if ((hour >= 17 && hour < 20) || (hour >= 5 && hour < 7)) return { sky: "#f2b27a", hi: "#ffd9ab", night: false };
  return { sky: "#24305a", hi: "#34447a", night: true };
}
export function drawWindow(g, x, y, w, h, t, hour) {
  const s = skyAt(hour);
  obox(g, x, y, w, h, "#f6f6f8");
  px(g, x + 2, y + 2, w - 4, h - 4, s.sky);
  px(g, x + 2, y + 2, w - 4, 1, s.hi);
  if (s.night) { if (Math.floor(t + x) % 3) px(g, x + 4 + (x % (w - 8)), y + 4, 1, 1, "#ffffff"); }
  else { const cx = x + 3 + Math.floor((t * 1.5 + x) % (w - 9)); px(g, cx, y + 4, 4, 1, "#ffffff"); }
  px(g, x + Math.floor(w / 2), y + 1, 1, h - 2, "#f6f6f8");
  px(g, x + 1, y + h - 2, w - 2, 1, "#c9c4ba");
}
export function drawClock(g, x, y) {
  const now = new Date();
  obox(g, x - 4, y - 4, 9, 9, "#ffffff");
  const hand = (len, a, c) => line(g, x, y, x + Math.round(Math.sin(a) * len), y - Math.round(Math.cos(a) * len), c);
  hand(3, (now.getMinutes() / 60) * Math.PI * 2, LINE);
  hand(2, ((now.getHours() % 12) / 12 + now.getMinutes() / 720) * Math.PI * 2, "#c8462e");
}
export function drawAC(g, x, y) {
  obox(g, x, y, 22, 7, "#f6f6f8");
  px(g, x + 2, y + 4, 18, 1, "#c9ccd3"); px(g, x + 17, y + 2, 2, 1, "#46e07a");
}
export function drawPoster(g, x, y, kind) {
  obox(g, x, y, 10, 12, "#ffffff");
  const c = ["#5aa8e8", "#f2b27a", "#7cc576"][kind % 3];
  px(g, x + 2, y + 2, 6, 5, c);
  px(g, x + 2, y + 8, 6, 1, "#c9ccd3"); px(g, x + 2, y + 10, 4, 1, "#c9ccd3");
}
export function drawBoard(g, x, y, w, h, t, busy) {
  // A whiteboard on a wall face, scribbled on during meetings.
  obox(g, x, y, w, h, "#ffffff");
  px(g, x + 1, y + h - 2, w - 2, 1, "#c9ccd3");
  const n = busy ? 3 + (Math.floor(t * 1.5) % 3) : 2;
  for (let i = 0; i < n; i++) px(g, x + 3, y + 2 + i * 2, 4 + ((i * 7 + 3) % (w - 10)), 1, ["#5a8ee0", "#e0604a", "#3fa060"][i % 3]);
  if (busy) { for (let i = 0; i < 4; i++) px(g, x + w - 12 + i * 2, y + h - 4 - ((i * 3) % 5), 1, 1 + ((i * 3) % 5), "#5a8ee0"); }
}

// ---------------------------------------------------------------- cubicles

/** Office chair seen from the front: the robot sits on it, so it is drawn before the robot. */
export function drawChair(g, x, y) {
  obox(g, x - 5, y - 13, 11, 9, CHAIR);
  px(g, x - 4, y - 12, 9, 2, CHAIR_HI);
  obox(g, x - 6, y - 5, 13, 4, CHAIR);
  px(g, x - 1, y - 1, 3, 2, "#2e3140");
  px(g, x - 4, y + 1, 9, 1, "#2e3140");
}

/** Low cubicle partition behind a row of seats, its fabric in the team colour. */
export function drawPartition(g, x, y, w, color) {
  obox(g, x, y - 12, w, 12, METAL);
  px(g, x + 2, y - 10, w - 4, 7, color);
  px(g, x + 2, y - 10, w - 4, 1, "rgba(255,255,255,0.3)");
  px(g, x + 1, y - 11, w - 2, 1, METAL_HI);
  for (let k = 36; k < w - 4; k += 34) px(g, x + k, y - 11, 1, 10, METAL);
}

/** A desk in front of the seat at (x, y). mode: off | code | done | sleep */
export function drawDesk(g, x, y, t, mode, seed) {
  // Monitor beside the seat, angled towards us.
  obox(g, x - 18, y - 16, 12, 10, "#2e3140");
  const sx = x - 17, sy = y - 15;
  if (mode === "code") {
    px(g, sx, sy, 10, 8, "#1d3a5c");
    for (let r = 0; r < 3; r++) {
      const w = 2 + ((Math.floor(t * 5) + r * 3 + seed) % 6);
      px(g, sx + 1 + (r % 2), sy + 1 + r * 2, w, 1, r === 1 ? "#ffd08a" : "#8fe0a8");
    }
  } else if (mode === "done") {
    px(g, sx, sy, 10, 8, "#3a6aa8");
    px(g, sx + 2, sy + 4, 1, 1, "#ffffff"); px(g, sx + 3, sy + 5, 1, 1, "#ffffff");
    px(g, sx + 4, sy + 4, 1, 1, "#ffffff"); px(g, sx + 5, sy + 3, 1, 1, "#ffffff"); px(g, sx + 6, sy + 2, 1, 1, "#ffffff");
  } else if (mode === "sleep") {
    px(g, sx, sy, 10, 8, "#5aa8e8");
    px(g, sx, sy, 10, 2, "#7cc0f2");
    const k = Math.floor(t * 0.7 + seed) % 6;
    px(g, sx + 1 + k, sy + 3 + (k % 3), 2, 2, "#d8eefc");
  } else px(g, sx, sy, 10, 8, "#3b4256");
  px(g, x - 13, y - 6, 3, 2, "#2e3140");
  // Desk top and front.
  obox(g, x - 20, y - 5, 34, 7, WOOD);
  px(g, x - 19, y - 4, 32, 1, WOOD_HI);
  obox(g, x - 20, y + 1, 34, 5, WOOD_LO);
  px(g, x - 19, y + 6, 2, 3, METAL); px(g, x + 11, y + 6, 2, 3, METAL);
  // Keyboard, papers, and a mug or a plant on some desks.
  px(g, x - 4, y - 4, 9, 2, "#e8eaef"); px(g, x - 4, y - 3, 9, 1, "#c9ccd3");
  if (seed % 3 === 0) { obox(g, x + 7, y - 8, 4, 4, "#ffffff"); px(g, x + 8, y - 7, 2, 1, "#c88a5a"); }
  else if (seed % 3 === 1) { obox(g, x + 6, y - 6, 5, 4, "#c96b3c"); px(g, x + 6, y - 10, 5, 4, "#5aa84f"); px(g, x + 7, y - 11, 2, 2, "#7cc576"); }
  else { px(g, x + 6, y - 4, 6, 3, "#ffffff"); px(g, x + 7, y - 3, 4, 1, "#c9ccd3"); }
}

// ---------------------------------------------------------------- rooms

export function drawMeetingTable(g, cx, y, w, t, busy) {
  const x = Math.round(cx - w / 2);
  obox(g, x, y - 16, w, 13, WOOD);
  px(g, x + 1, y - 15, w - 2, 1, WOOD_HI);
  obox(g, x, y - 4, w, 4, WOOD_LO);
  for (let i = 0; i < 4; i++) px(g, x + 8 + i * Math.floor((w - 16) / 4), y - 12 + (i % 2) * 3, 6, 4, "#ffffff");
  obox(g, Math.round(cx) - 5, y - 11, 10, 5, "#2e3140");
  if (busy && Math.floor(t * 3) % 2) px(g, Math.round(cx) - 1, y - 10, 3, 1, "#46e07a");
  px(g, x + 3, y, 2, 2, METAL); px(g, x + w - 5, y, 2, 2, METAL);
}

export function drawShelf(g, x, y, w, seed) {
  obox(g, x, y - 30, w, 30, "#b98e5c");
  px(g, x + 1, y - 29, w - 2, 1, "#d6a96f");
  const colors = ["#c8462e", "#5a8ee0", "#f2c14e", "#3fa060", "#9b6df2", "#ffffff", "#f2b27a"];
  for (let row = 0; row < 3; row++) {
    px(g, x + 2, y - 20 + row * 9, w - 4, 1, "#8a6440");
    let bx = x + 2;
    while (bx < x + w - 3) {
      const bw = 2 + ((bx * 7 + row * 3 + seed) % 2);
      const bh = 5 + ((bx + row + seed) % 3);
      px(g, bx, y - 20 + row * 9 - bh, bw, bh, colors[(bx * 3 + row + seed) % colors.length]);
      bx += bw + ((bx + seed) % 6 === 0 ? 3 : 0);
    }
  }
}
export function drawStorage(g, x, y, w, seed) {
  // Metal shelving with cardboard boxes.
  obox(g, x, y - 26, w, 26, METAL_HI);
  for (let row = 0; row < 3; row++) {
    px(g, x + 1, y - 18 + row * 8, w - 2, 1, METAL);
    for (let bx = x + 2; bx < x + w - 7; bx += 8) {
      if ((bx + row + seed) % 3 === 0) continue;
      obox(g, bx, y - 24 + row * 8, 7, 6, "#d6ab72");
      px(g, bx + 3, y - 23 + row * 8, 1, 4, "#b98e5c");
    }
  }
}
export function drawBoxes(g, x, y) {
  obox(g, x, y - 7, 9, 7, "#d6ab72"); px(g, x + 4, y - 6, 1, 5, "#b98e5c");
  obox(g, x + 2, y - 13, 8, 7, "#e0b97e"); px(g, x + 5, y - 12, 1, 5, "#b98e5c");
}
export function drawArmchair(g, x, y, color = "#e8e8ee") {
  obox(g, x - 7, y - 14, 15, 8, color);
  px(g, x - 6, y - 13, 13, 1, "#ffffff");
  obox(g, x - 8, y - 7, 17, 7, color);
  obox(g, x - 9, y - 10, 4, 10, color); obox(g, x + 6, y - 10, 4, 10, color);
}
export function drawSideTable(g, x, y) {
  obox(g, x - 6, y - 8, 12, 5, WOOD);
  px(g, x - 1, y - 3, 2, 3, WOOD_LO);
  obox(g, x - 2, y - 11, 4, 4, "#ffffff");
}

export function drawRack(g, x, y, t, busy, seed) {
  obox(g, x, y - 34, 18, 34, "#3b3f4e");
  for (let u = 0; u < 7; u++) {
    px(g, x + 2, y - 31 + u * 4, 14, 3, "#4f5466");
    for (let l = 0; l < 3; l++) {
      const on = busy ? (Math.floor(t * 8) + u * 3 + l * 5 + seed) % 4 !== 0 : (u + l + seed) % 3 === 0;
      px(g, x + 10 + l * 2, y - 30 + u * 4, 1, 1, on ? (l === 2 ? "#ffb347" : "#46e07a") : "#2e3140");
    }
  }
}
export function drawConsole(g, x, y, t, busy) {
  obox(g, x - 14, y - 7, 28, 7, "#e8eaef");
  obox(g, x - 9, y - 18, 18, 12, "#2e3140");
  px(g, x - 8, y - 17, 16, 10, "#10202a");
  if (busy) for (let r = 0; r < 4; r++) px(g, x - 7, y - 16 + r * 2, ((Math.floor(t * 6) + r * 5) % 11) + 3, 1, "#46e07a");
  else px(g, x - 7, y - 16, 2, 1, Math.floor(t * 2) % 2 ? "#46e07a" : "#10202a");
}

export function drawBooth(g, x, y, w, h, t, busy) {
  // Phone booth: white frame, felt back wall, a wall phone.
  obox(g, x, y, w, h, "#f6f6f8");
  px(g, x + 2, y + 2, w - 4, 10, "#7d93b0");
  px(g, x + 2, y + 12, w - 4, h - 14, "#d8dce4");
  obox(g, x + 5, y + 3, 5, 7, "#2e3140");
  px(g, x + 6, y + 4, 3, 1, busy ? "#46e07a" : "#6a7080");
  if (busy) for (let k = 0; k < 2; k++) {
    const p = (t * 1.2 + k / 2) % 1;
    g.globalAlpha = 1 - p;
    px(g, x + w - 9 + Math.round(p * 5), y + 4 - Math.round(p * 3), 1, 3, "#9b6df2");
    g.globalAlpha = 1;
  }
}
export function drawBoothFront(g, x, y, w) {
  g.globalAlpha = 0.25;
  px(g, x + 1, y - 10, w - 2, 10, "#d8eefc");
  g.globalAlpha = 1;
  px(g, x, y - 1, w, 1, LINE);
  px(g, x, y - 11, 2, 11, "#f6f6f8"); px(g, x + w - 2, y - 11, 2, 11, "#f6f6f8");
  px(g, x + 3, y - 9, 1, 6, "rgba(255,255,255,0.8)");
}

export function drawWhiteboard(g, x, y, w, t, busy) {
  // Kanban board on legs: three columns of sticky notes that move along while planning.
  obox(g, x, y - 40, w, 32, "#ffffff");
  px(g, x + 3, y - 8, 2, 8, METAL); px(g, x + w - 5, y - 8, 2, 8, METAL);
  const col = Math.floor((w - 4) / 3);
  for (let c = 1; c < 3; c++) px(g, x + 2 + c * col, y - 38, 1, 28, "#d8dce4");
  pixelText(g, "TODO", x + 3, y - 38, "#9aa0ad");
  const notes = ["#ffe066", "#ffa8d8", "#a8dcff", "#b8f0c0"];
  const shift = busy ? Math.floor(t / 2) % 3 : 0;
  for (let i = 0; i < 7; i++) {
    const c = (i + (i === 2 ? shift : 0)) % 3;
    const r = Math.floor(i / 3) + (i % 3 === 0 ? 0 : 1);
    px(g, x + 4 + c * col + (i % 2) * 6, y - 31 + r * 7, 5, 5, notes[i % 4]);
  }
}

export function drawBossDesk(g, x, y, t, waiting) {
  // An empty executive chair: the manager (you) is out, and the queue is waiting for you.
  obox(g, x - 7, y - 27, 15, 14, "#5a3b2b");
  px(g, x - 6, y - 26, 13, 2, "#7a5534");
  obox(g, x - 24, y - 13, 48, 13, "#8a5a36");
  px(g, x - 23, y - 12, 46, 1, "#a8743f");
  obox(g, x - 6, y - 18, 12, 6, "#2e3140");
  px(g, x - 5, y - 17, 10, 4, waiting && Math.floor(t * 2) % 2 ? "#ff6a78" : "#5aa8e8");
  obox(g, x + 9, y - 17, 14, 6, "#f2c14e");
  pixelText(g, "YOU", x + 11, y - 16, LINE);
}
export function drawDoorLight(g, x, y, t, waiting) {
  obox(g, x - 2, y - 3, 5, 4, waiting ? (Math.floor(t * 4) % 2 ? "#ff3a4a" : "#7a2a30") : "#46e07a");
}

// ---------------------------------------------------------------- kitchen, lounge, restroom, lobby

export function drawCounter(g, x, y, w) {
  obox(g, x, y - 14, w, 14, "#b3b9c6");
  obox(g, x, y - 14, w, 5, "#eef0f4");
  for (let i = 4; i < w - 4; i += 9) px(g, x + i, y - 13, 3, 1, "#d6dae2");
  for (let i = 14; i < w - 4; i += 16) { px(g, x + i, y - 8, 1, 7, "#9aa0ad"); px(g, x + i - 3, y - 6, 2, 1, "#7d8494"); }
}
export function drawSink(g, x, y) {
  obox(g, x - 5, y - 13, 10, 4, "#c9ced8");
  px(g, x - 1, y - 16, 2, 3, METAL);
}
export function drawMicrowave(g, x, y) {
  obox(g, x - 7, y - 21, 14, 9, "#e8eaef");
  px(g, x - 5, y - 19, 8, 5, "#3b4256"); px(g, x + 4, y - 19, 1, 1, "#46e07a");
}
export function drawCoffee(g, x, y, t, busy) {
  obox(g, x - 5, y - 24, 10, 12, "#3b3f4e");
  px(g, x - 4, y - 23, 8, 2, "#c8462e");
  px(g, x - 2, y - 17, 4, 3, "#ffffff");
  if (busy) for (let k = 0; k < 3; k++) {
    const p = (t * 0.8 + k / 3) % 1;
    g.globalAlpha = 1 - p;
    px(g, x - 1 + Math.round(Math.sin(t * 3 + k) * 1.5), y - 26 - Math.round(p * 10), 1, 2, "#ffffff");
  }
  g.globalAlpha = 1;
}
export function drawFridge(g, x, y) {
  obox(g, x - 8, y - 36, 16, 36, "#d6dbe4");
  px(g, x - 7, y - 35, 14, 1, "#eef0f4");
  px(g, x - 7, y - 22, 14, 1, "#9aa0ad");
  px(g, x + 4, y - 32, 1, 6, "#7d8494"); px(g, x + 4, y - 18, 1, 8, "#7d8494");
  px(g, x - 5, y - 32, 3, 3, "#f2c14e"); px(g, x - 1, y - 30, 3, 3, "#ffa8d8");
}
export function drawCooler(g, x, y, t) {
  obox(g, x - 5, y - 15, 10, 15, "#eef0f4");
  obox(g, x - 4, y - 26, 8, 12, "#8cc8f0");
  px(g, x - 3, y - 25, 2, 9, "#d8eefc");
  px(g, x - 3, y - 11, 2, 2, "#5aa8e8"); px(g, x + 1, y - 11, 2, 2, "#e0604a");
  if (Math.floor(t * 0.5) % 4 === 0) px(g, x - 1, y - 20 + Math.floor(t * 6) % 4, 1, 1, "#ffffff");
}
export function drawVending(g, x, y, t) {
  obox(g, x - 9, y - 34, 18, 34, "#3b3f4e");
  obox(g, x - 7, y - 31, 11, 22, "#d8eefc");
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) px(g, x - 6 + c * 3, y - 30 + r * 5, 2, 3, ["#f2c14e", "#3fa060", "#5a8ee0", "#e0604a"][(r + c) % 4]);
  px(g, x + 5, y - 28, 2, 4, Math.floor(t * 2) % 2 ? "#46e07a" : "#2a5a3a");
  px(g, x - 6, y - 6, 10, 3, "#2e3140");
}
export function drawCouch(g, x, y, w, color = "#8e9ab0") {
  obox(g, x, y - 16, w, 9, color);
  px(g, x + 1, y - 15, w - 2, 1, "rgba(255,255,255,0.3)");
  obox(g, x, y - 8, w, 8, color);
  for (let k = Math.floor(w / 3); k < w - 2; k += Math.floor(w / 3)) px(g, x + k, y - 7, 1, 6, "rgba(0,0,0,0.15)");
  obox(g, x - 3, y - 12, 5, 12, color); obox(g, x + w - 2, y - 12, 5, 12, color);
}
export function drawPingPong(g, x, y, w, t, rally) {
  const h = 22, x0 = Math.round(x - w / 2);
  obox(g, x0, y - h, w, h, "#3d8a6a");
  px(g, x0 + 1, y - h + Math.floor(h / 2), w - 2, 1, "#ffffff");
  px(g, x0 + 1, y - h + 1, w - 2, 1, "#5aa888");
  px(g, x0 + Math.floor(w / 2), y - h - 3, 1, h + 3, "#ffffff");
  px(g, x0 + 2, y, 2, 3, METAL); px(g, x0 + w - 4, y, 2, 3, METAL);
  if (!rally) return;
  const p = (Math.sin(t * 3.2) + 1) / 2;
  px(g, x0 - 4 + p * (w + 8), y - h / 2 - Math.abs(Math.sin(t * 6.4)) * 8, 2, 2, "#ffffff");
}
export function drawPlant(g, x, y, big) {
  obox(g, x - 4, y - 7, 9, 7, "#c96b3c");
  px(g, x - 3, y - 6, 7, 1, "#e08a5c");
  const h = big ? 16 : 10;
  px(g, x - 6, y - 6 - h, 13, h, LINE);
  px(g, x - 5, y - 5 - h, 11, h - 1, "#4f9a48");
  px(g, x - 3, y - 4 - h, 5, h - 5, "#72c060");
  px(g, x - 8, y - 9 - Math.floor(h / 2), 3, 4, "#4f9a48"); px(g, x + 6, y - 11 - Math.floor(h / 2), 3, 4, "#4f9a48");
  px(g, x - 1, y - 8 - h, 3, 3, "#72c060");
}
export function drawToilet(g, x, y) {
  obox(g, x - 5, y - 16, 10, 6, "#ffffff");
  obox(g, x - 4, y - 11, 8, 9, "#ffffff");
  px(g, x - 2, y - 9, 4, 4, "#d8dce4");
}
export function drawStall(g, x, y, w) {
  // Partition side walls of a restroom stall.
  px(g, x, y - 30, 3, 30, LINE); px(g, x + 1, y - 30, 1, 30, "#d6dae2");
  px(g, x + w, y - 30, 3, 30, LINE); px(g, x + w + 1, y - 30, 1, 30, "#d6dae2");
}
export function drawWashbasin(g, x, y) {
  obox(g, x - 6, y - 12, 12, 6, "#ffffff");
  px(g, x - 3, y - 10, 6, 2, "#d8dce4");
  px(g, x - 1, y - 14, 2, 2, METAL);
  obox(g, x - 5, y - 22, 10, 8, "#d8eefc");
}
/** Elevator set into the back wall; `y` is the floor line in front of it. */
export function drawElevator(g, x, y, t, open) {
  obox(g, x - 17, y - 32, 34, 32, "#b3b9c6");
  const gap = open ? 7 : 0;
  obox(g, x - 14 - gap, y - 28, 14, 28, "#d6dbe4"); obox(g, x + gap, y - 28, 14, 28, "#d6dbe4");
  if (gap) px(g, x - gap + 1, y - 27, gap * 2 - 2, 27, "#4a5068");
  obox(g, x - 7, y - 39, 14, 7, "#2e3140");
  pixelText(g, String(1 + (Math.floor(t / 4) % 9)), x - 1, y - 38, "#ffb347");
}
export function drawReception(g, x, y) {
  obox(g, x - 33, y - 14, 66, 14, "#f6f6f8");
  obox(g, x - 33, y - 14, 66, 4, WOOD);
  pixelText(g, "AGENTTALLY INC", x - 28, y - 8, "#5a6f9a");
  obox(g, x + 18, y - 21, 9, 7, "#2e3140"); px(g, x + 19, y - 20, 7, 4, "#5aa8e8");
}
export function drawPrinter(g, x, y, t, busy) {
  obox(g, x - 8, y - 14, 16, 14, "#e8eaef");
  obox(g, x - 7, y - 18, 14, 5, "#c9ced8");
  px(g, x - 4, y - 9, 8, 2, "#ffffff");
  px(g, x + 4, y - 12, 2, 1, busy && Math.floor(t * 4) % 2 ? "#46e07a" : "#9aa0ad");
}
export function drawRoomba(g, x, y, t) {
  px(g, x - 5, y - 3, 11, 4, LINE); px(g, x - 4, y - 4, 9, 1, LINE);
  px(g, x - 4, y - 3, 9, 3, "#e8eaef"); px(g, x - 2, y - 3, 5, 1, "#ffffff");
  px(g, x, y - 4, 1, 1, Math.floor(t * 3) % 2 ? "#46e07a" : "#2a5a3a");
}
