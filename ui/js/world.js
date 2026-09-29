// The hex world: one hex "flower" per project, robots walking between stations.

import {
  HEX, TERRAIN, tileSprite, robotSprite, drawBuilding, drawTree, drawRock, drawFlowers,
  drawToolFx, drawBubble, px,
} from "./sprites.js";
import { providerMeta, stationFor, STATUS } from "./meta.js";

// Axial neighbour directions (pointy-top) and the station on each side of the core.
const RING = [
  { dir: [1, 0], station: "terminal" },
  { dir: [1, -1], station: "radar" },
  { dir: [0, -1], station: "library" },
  { dir: [-1, 0], station: "tasks" },
  { dir: [-1, 1], station: "dock" },
  { dir: [0, 1], station: "forge" },
];

// Where robots stand, relative to a station hex centre (feet position).
const SLOTS = {
  default: [[0, 10], [-11, 7], [11, 7], [-6, 14], [6, 14], [-15, 12], [15, 12], [0, 17]],
  hub: [[-12, 7], [12, 7], [0, 12], [-15, 0], [15, 0], [-7, 15], [7, 15], [0, 18]],
  dock: [[-9, -2], [9, -2], [0, 6], [-15, 8], [15, 8], [-7, 13], [7, 13], [0, 15]],
};

const SPEED = 30; // world px per second
const hexDist = (a, b) => {
  const dq = a[0] - b[0], dr = a[1] - b[1];
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};
const toPx = ([q, r]) => [HEX.w * (q + r / 2), HEX.row * r];
const cellKey = (c) => c[0] + "," + c[1];

function hash(a, b, s = 1) {
  let n = (a * 73856093) ^ (b * 19349663) ^ (s * 83492791);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

/** Leave one water hex between each island's two-hex land radius. */
function flowerCentres(n, aspect = 1.6) {
  const out = [[0, 0]];
  const cands = [];
  const R = 6 + Math.ceil(Math.sqrt(n)) * 6;
  for (let q = -R; q <= R; q++) {
    for (let r = -R; r <= R; r++) {
      const c = [q, r];
      const d = hexDist(c, [0, 0]);
      if (d === 0 || d > R) continue;
      const [x, y] = toPx(c);
      // Prefer spreading sideways: the window is wider than tall.
      cands.push({ c, score: Math.hypot(x / aspect, y) + Math.atan2(y, x) * 0.01 });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  for (const { c } of cands) {
    if (out.length >= n) break;
    if (out.every((o) => hexDist(o, c) >= 6)) out.push(c);
  }
  return out;
}

export class World {
  constructor(canvas, { onSelect, onHover } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.buf = document.createElement("canvas");
    this.bctx = this.buf.getContext("2d");
    this.onSelect = onSelect || (() => {});
    this.onHover = onHover || (() => {});
    this.projects = new Map(); // name -> { index, centre, cells }
    this.projectOrder = [];
    this.robots = new Map();
    this.fx = [];
    this.selected = null;
    this.hovered = null;
    this.scale = 3;
    this.userZoom = false;
    this.cam = { x: 0, y: 0 };
    this.userPan = false;
    this.terrain = null;
    this.t = 0;
    this.last = performance.now();
    this.night = 0;
    this.paused = false;
    this.dirty = true;
    this.cameraTarget = null;
    this.bindInput();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    requestAnimationFrame((ts) => this.frame(ts));
  }

  // ------------------------------------------------------------ data

  setSessions(sessions) {
    this.dirty = true;
    // Projects: keep existing positions stable, append new ones.
    const names = [];
    for (const s of sessions) if (!names.includes(s.cwd || s.project)) names.push(s.cwd || s.project);
    const gone = this.projectOrder.filter((p) => !names.includes(p));
    const fresh = names.filter((p) => !this.projectOrder.includes(p));
    if (gone.length || fresh.length) {
      // Rebuild order: surviving projects keep their relative order; newest activity first for new ones.
      this.projectOrder = [...this.projectOrder.filter((p) => names.includes(p)), ...fresh];
      this.layout();
    }

    const seen = new Set();
    const parentKeys = new Set(sessions.map((s) => s.key));
    for (const s of sessions) {
      seen.add(s.key);
      let r = this.robots.get(s.key);
      const project = s.cwd || s.project;
      const proj = this.projects.get(project);
      if (!proj) continue;
      proj.label = s.project;
      const station = stationFor(s);
      const drone = !!(s.parent && parentKeys.has(s.parent));
      if (!r) {
        const [sx, sy] = proj.stations[station === "dock" ? "dock" : "hub"];
        r = { key: s.key, x: sx, y: sy + 8, tx: sx, ty: sy, phase: Math.random() * 10, born: this.t };
        this.robots.set(s.key, r);
        this.spawnFx(r.x, r.y - 8, providerMeta(s.provider).accent);
      }
      r.session = s;
      r.project = project;
      r.station = station;
      r.drone = drone;
    }
    for (const [k, r] of this.robots) {
      if (!seen.has(k)) {
        this.spawnFx(r.x, r.y - 8, "#ffffff");
        this.robots.delete(k);
        if (this.selected === k) this.select(null);
      }
    }
    this.assignSlots();
  }

  assignSlots() {
    const groups = new Map();
    const sorted = [...this.robots.values()].filter((r) => !r.drone).sort((a, b) => a.key.localeCompare(b.key));
    for (const r of sorted) {
      const g = r.project + "/" + r.station;
      const i = groups.get(g) || 0;
      groups.set(g, i + 1);
      const proj = this.projects.get(r.project);
      if (!proj) continue;
      const [cx, cy] = proj.stations[r.station];
      const slots = SLOTS[r.station] || SLOTS.default;
      const [ox, oy] = slots[i % slots.length];
      const spill = Math.floor(i / slots.length);
      r.tx = cx + ox + spill * 4;
      r.ty = cy + oy + spill * 2;
    }
  }

  layout() {
    const centres = flowerCentres(Math.max(1, this.projectOrder.length), Math.max(1, Math.min(4, this.cw / this.ch)));
    this.projects.clear();
    const land = new Map();
    this.projectOrder.forEach((name, i) => {
      const c = centres[i];
      const stations = { hub: toPx(c) };
      const cells = [{ cell: c, station: "hub" }];
      for (const { dir, station } of RING) {
        const cell = [c[0] + dir[0], c[1] + dir[1]];
        stations[station] = toPx(cell);
        cells.push({ cell, station });
      }
      this.projects.set(name, { name, index: i, centre: c, stations, cells });
      for (const { cell, station } of cells) land.set(cellKey(cell), { cell, kind: station === "hub" ? "core" : "floor", station });
    });
    // A compact coast keeps projects distinct instead of merging into one continent.
    for (const p of this.projects.values()) {
      const c = p.centre;
      for (let dq = -2; dq <= 2; dq++) {
        for (let dr = -2; dr <= 2; dr++) {
          const cell = [c[0] + dq, c[1] + dr];
          const d = hexDist(cell, c);
          const k = cellKey(cell);
          if (d !== 2 || land.has(k)) continue;
          const v = hash(cell[0], cell[1]);
          land.set(k, { cell, kind: v > 0.78 ? "sand" : v > 0.4 ? "meadow" : "grass", decor: v });
        }
      }
    }
    // Water ring around land.
    const cells = [...land.values()];
    const water = new Map();
    for (const { cell } of cells) {
      for (const { dir } of RING) {
        for (let k = 1; k <= 2; k++) {
          const w = [cell[0] + dir[0] * k, cell[1] + dir[1] * k];
          const key = cellKey(w);
          if (!land.has(key)) water.set(key, { cell: w, kind: "water" });
        }
      }
    }
    this.cells = [...water.values(), ...cells];
    this.renderTerrain();
    if (!this.userPan) this.fit();
  }

  renderTerrain() {
    if (!this.cells.length) { this.terrain = null; return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const land = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const { cell, kind } of this.cells) {
      const [x, y] = toPx(cell);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (kind !== "water") {
        land.minX = Math.min(land.minX, x); land.minY = Math.min(land.minY, y);
        land.maxX = Math.max(land.maxX, x); land.maxY = Math.max(land.maxY, y);
      }
    }
    const pad = 40;
    const ox = Math.floor(minX - HEX.w / 2 - pad), oy = Math.floor(minY - HEX.h / 2 - pad);
    const c = document.createElement("canvas");
    c.width = Math.ceil(maxX - minX + HEX.w + pad * 2);
    c.height = Math.ceil(maxY - minY + HEX.h + HEX.side + pad * 2);
    const g = c.getContext("2d");
    // Draw row by row so lower tiles overlap the cliffs of upper ones.
    const sorted = [...this.cells].sort((a, b) => a.cell[1] - b.cell[1] || a.cell[0] - b.cell[0]);
    for (const t of sorted) {
      const [x, y] = toPx(t.cell);
      const seed = Math.floor(hash(t.cell[0], t.cell[1], 3) * 4);
      g.drawImage(tileSprite(t.kind, seed), Math.round(x - HEX.w / 2 - ox), Math.round(y - HEX.h / 2 - oy));
    }
    // Thin surf follows only exposed hex edges; inland tile joins stay quiet.
    const landKeys = new Set(this.cells.filter((c) => c.kind !== "water").map((c) => cellKey(c.cell)));
    const hw = HEX.w / 2, hh = HEX.h / 2;
    const coastEdges = [
      [[hw, -hh + HEX.cap], [hw, hh - HEX.cap]],
      [[0, -hh], [hw, -hh + HEX.cap]],
      [[-hw, -hh + HEX.cap], [0, -hh]],
      [[-hw, hh - HEX.cap], [-hw, -hh + HEX.cap]],
      [[0, hh], [-hw, hh - HEX.cap]],
      [[hw, hh - HEX.cap], [0, hh]],
    ];
    for (const { cell, kind } of sorted) {
      if (kind === "water") continue;
      const [x, y] = toPx(cell);
      RING.forEach(({ dir }, i) => {
        if (landKeys.has(cellKey([cell[0] + dir[0], cell[1] + dir[1]]))) return;
        const [a, b] = coastEdges[i];
        const surfX = [2, 1, -1, -2, -1, 1][i];
        const surfY = [3, -1, -1, 3, HEX.side + 1, HEX.side + 1][i];
        const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        for (let k = 0; k <= steps; k++) {
          if (k % 7 > 4) continue;
          px(g, x - ox + a[0] + (b[0] - a[0]) * k / steps + surfX,
            y - oy + a[1] + (b[1] - a[1]) * k / steps + surfY, 1, 1, "#548795");
        }
      });
    }
    // Static decoration.
    for (const t of sorted) {
      if (t.decor === undefined) continue;
      const [x, y] = toPx(t.cell);
      const lx = Math.round(x - ox), ly = Math.round(y - oy);
      const v = t.decor;
      const v2 = hash(t.cell[0], t.cell[1], 11);
      if (t.kind === "sand") {
        if (v2 < 0.3) drawRock(g, lx + 4, ly + 4);
      } else if (v2 < 0.28) {
        drawTree(g, lx - 5, ly + 2, v);
        if (v2 < 0.08) drawTree(g, lx + 7, ly + 7, 1 - v);
      } else if (v2 < 0.6) {
        drawFlowers(g, lx, ly + 2, v);
      } else if (v2 < 0.68) {
        drawRock(g, lx - 3, ly + 5);
      }
    }
    this.terrain = { canvas: c, ox, oy, minX, minY, maxX, maxY, land };
  }

  fit() {
    if (!this.terrain) return;
    // Fit the islands, not the surrounding water ring; the ocean background fills the rest.
    const { minX, minY, maxX, maxY } = this.terrain.land || this.terrain;
    // Keep island artwork clear of the source controls and the station guide.
    const topInset = this.cw < 600 ? 86 : 62;
    const bottomInset = 38;
    this.cam.x = (minX + maxX) / 2;
    this.cam.y = (minY + maxY) / 2 + HEX.side / 2;
    this.cameraTarget = null;
    this.dirty = true;
    if (!this.userZoom) {
      // Include the outer tile edges and cliffs; the inset above leaves room for controls.
      const w = maxX - minX + HEX.w * 1.25, h = maxY - minY + HEX.h + HEX.side;
      // Integer scales keep pixels crisp; allow half steps when the world is big.
      const fitted = Math.min(this.cw / w, Math.max(1, this.ch - topInset - bottomInset) / h);
      const s = fitted >= 2 ? Math.floor(fitted) : fitted;
      this.scale = Math.max(0.1, Math.min(5, s));
      this.sizeBuffer();
    }
    this.cam.y -= (topInset - bottomInset) / (2 * this.scale);
  }

  recenter() {
    this.userPan = false;
    this.userZoom = false;
    this.fit();
  }

  select(key) {
    this.selected = key;
    this.dirty = true;
    this.onSelect(key);
  }

  focus(key) {
    const r = this.robots.get(key);
    if (!r) return;
    if (this.scale < 2) {
      this.scale = 2;
      this.userZoom = true;
      this.sizeBuffer();
    }
    this.cameraTarget = { x: r.tx, y: r.ty - 10 };
    if (this.paused) { Object.assign(this.cam, this.cameraTarget); this.cameraTarget = null; }
    this.dirty = true;
    this.userPan = true;
  }

  setPaused(paused) {
    this.paused = paused;
    this.fx = [];
    this.dirty = true;
  }

  zoom(direction, anchor) {
    const old = this.scale;
    const next = Math.max(0.1, Math.min(7, old * (direction > 0 ? 1.25 : 0.8)));
    if (anchor) {
      this.cam.x += (anchor.x - this.cw / 2) * (1 / old - 1 / next);
      this.cam.y += (anchor.y - this.ch / 2) * (1 / old - 1 / next);
    }
    this.scale = next;
    this.cameraTarget = null;
    this.userZoom = true;
    this.userPan = true;
    this.dirty = true;
    this.sizeBuffer();
  }

  spawnFx(x, y, color) {
    if (this.paused) return;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.fx.push({ x, y, vx: Math.cos(a) * 18, vy: Math.sin(a) * 18 - 10, life: 0.7, color });
    }
  }

  // ------------------------------------------------------------ input

  bindInput() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.cameraTarget = null;
      drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) {
          this.cam.x = drag.cx - dx / this.scale;
          this.cam.y = drag.cy - dy / this.scale;
          this.userPan = true;
          this.dirty = true;
        }
      }
      const hit = this.hit(e);
      if (hit !== this.hovered) {
        this.hovered = hit;
        this.dirty = true;
        this.onHover(hit);
        c.style.cursor = hit ? "pointer" : "grab";
      }
    });
    c.addEventListener("pointerup", (e) => {
      if (drag && !drag.moved) this.select(this.hit(e));
      drag = null;
    });
    c.addEventListener("pointercancel", () => { drag = null; });
    c.addEventListener("lostpointercapture", () => { drag = null; });
    c.addEventListener("pointerleave", () => { this.hovered = null; this.onHover(null); this.dirty = true; });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      this.zoom(e.deltaY < 0 ? 1 : -1, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    }, { passive: false });
  }

  hit(e) {
    const rect = this.canvas.getBoundingClientRect();
    const bx = (e.clientX - rect.left) / this.scale;
    const by = (e.clientY - rect.top) / this.scale;
    const wx = bx - this.offX, wy = by - this.offY;
    let best = null, bestD = 1e9;
    for (const r of this.robots.values()) {
      const dx = wx - r.x, dy = wy - (r.y - 8);
      if (Math.abs(dx) < 9 && Math.abs(dy) < 11) {
        const d = dx * dx + dy * dy;
        if (d < bestD) { best = r.key; bestD = d; }
      }
    }
    return best;
  }

  resize() {
    const p = this.canvas.parentElement.getBoundingClientRect();
    this.cw = Math.max(1, Math.floor(p.width));
    this.ch = Math.max(1, Math.floor(p.height));
    this.dirty = true;
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    this.canvas.width = Math.floor(this.cw * dpr);
    this.canvas.height = Math.floor(this.ch * dpr);
    this.canvas.style.width = this.cw + "px";
    this.canvas.style.height = this.ch + "px";
    if (!this.userZoom) this.fit();
    this.sizeBuffer();
  }

  sizeBuffer() {
    this.buf.width = Math.ceil(this.cw / this.scale);
    this.buf.height = Math.ceil(this.ch / this.scale);
  }

  // ------------------------------------------------------------ simulation

  update(dt) {
    if (this.cameraTarget) {
      const blend = this.paused ? 1 : 1 - Math.exp(-9 * dt);
      this.cam.x += (this.cameraTarget.x - this.cam.x) * blend;
      this.cam.y += (this.cameraTarget.y - this.cam.y) * blend;
      if (Math.hypot(this.cameraTarget.x - this.cam.x, this.cameraTarget.y - this.cam.y) < 0.1) this.cameraTarget = null;
    }
    for (const r of this.robots.values()) {
      if (r.drone) {
        const parent = this.robots.get(r.session.parent);
        if (parent) {
          const kids = [...this.robots.values()].filter((d) => d.drone && d.session.parent === r.session.parent);
          const i = kids.indexOf(r);
          const a = this.t * 1.6 + (i / Math.max(1, kids.length)) * Math.PI * 2;
          r.tx = parent.x + Math.cos(a) * 12;
          r.ty = parent.y - 14 + Math.sin(a) * 5;
        }
      }
      const dx = r.tx - r.x, dy = r.ty - r.y;
      const d = Math.hypot(dx, dy);
      const sp = (r.drone ? SPEED * 2.5 : SPEED) * dt;
      if (this.paused) {
        r.x = r.tx; r.y = r.ty; r.walking = false;
      } else if (d > 0.5) {
        const k = Math.min(1, sp / d);
        r.x += dx * k;
        r.y += dy * k;
        r.walking = !r.drone && d > 1.5;
      } else {
        r.walking = false;
      }
    }
    this.fx = this.fx.filter((f) => {
      f.life -= dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy += 30 * dt;
      return f.life > 0;
    });
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    // 0 at noon, 1 deep night.
    this.night = h >= 20 || h < 6 ? 1 : h >= 18 ? (h - 18) / 2 : h < 8 ? (8 - h) / 2 : 0;
  }

  // ------------------------------------------------------------ rendering

  frame(ts) {
    requestAnimationFrame((n) => this.frame(n));
    // Skip work while the page is hidden or the canvas is not displayed (pro interface).
    if (document.hidden || !this.canvas.offsetParent) { this.last = ts; return; }
    if (ts - this.last < 1000 / 30) return;
    const dt = Math.min(0.1, (ts - this.last) / 1000);
    this.last = ts;
    if (this.paused && !this.dirty) return;
    if (!this.paused) this.t += dt;
    this.update(dt);
    this.draw();
    this.dirty = false;
  }

  draw() {
    const g = this.bctx;
    const W = this.buf.width, H = this.buf.height;
    const t = this.t;
    this.offX = Math.round(W / 2 - this.cam.x);
    this.offY = Math.round(H / 2 - this.cam.y);
    const ox = this.offX, oy = this.offY;

    // Ocean.
    g.fillStyle = TERRAIN.water.top;
    g.fillRect(0, 0, W, H);
    for (let y = ((oy % 12) + 12) % 12 - 12; y < H; y += 12) {
      for (let x = ((ox % 24) + 24) % 24 - 24; x < W; x += 24) {
        const wx = x - ox, wy = y - oy;
        const v = hash(Math.round(wx / 24), Math.round(wy / 12), 5);
        const shift = Math.round(Math.sin(t * 1.2 + v * 6) * 3);
        g.fillStyle = v > 0.5 ? "#265269" : "#20485f";
        g.fillRect(x + shift + (Math.round(wy / 12) % 2 ? 12 : 0), y, 5, 1);
      }
    }

    if (this.terrain) {
      g.drawImage(this.terrain.canvas, this.terrain.ox + ox, this.terrain.oy + oy);
      // Water glints.
      for (const c of this.cells) {
        if (c.kind !== "water") continue;
        const v = hash(c.cell[0], c.cell[1], 9);
        const k = (t * 0.5 + v) % 1;
        if (k < 0.35) {
          const [x, y] = toPx(c.cell);
          px(g, x + ox - 6 + Math.round(v * 12), y + oy - 3 + Math.round(v * 6), k < 0.2 ? 3 : 2, 1, "#8cc4f5");
        }
      }
    }

    // Depth-sorted buildings and robots.
    const drawables = [];
    const busy = new Set();
    for (const r of this.robots.values()) {
      if (r.session.status === "working" && !r.walking) busy.add(r.project + "/" + r.station);
    }
    for (const p of this.projects.values()) {
      const accent = "#59f3ff";
      for (const [station, [x, y]] of Object.entries(p.stations)) {
        const on = busy.has(p.name + "/" + station) || (station === "hub" && [...this.robots.values()].some((r) => r.project === p.name && r.session.status === "working"));
        drawables.push({ y: y + 1, draw: () => drawBuilding(g, station, x + ox, y + oy, t, on, accent) });
      }
    }
    for (const r of this.robots.values()) {
      drawables.push({ y: r.y + (r.drone ? 20 : 0), draw: () => this.drawRobot(g, r, ox, oy) });
    }
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();

    // Particles.
    for (const f of this.fx) px(g, f.x + ox, f.y + oy, 1, 1, f.color);

    // Cloud shadows.
    g.fillStyle = "rgba(10,12,30,0.13)";
    for (let i = 0; i < 3; i++) {
      const cx = ((t * (4 + i) + i * 260) % (W + 200)) - 100;
      const cy = (H * (0.2 + i * 0.3)) | 0;
      g.fillRect(cx | 0, cy, 44, 8);
      g.fillRect((cx + 8) | 0, cy - 5, 26, 5);
      g.fillRect((cx - 6) | 0, cy + 3, 58, 4);
    }

    if (this.night > 0) {
      g.fillStyle = `rgba(12,10,60,${0.1 * this.night})`;
      g.fillRect(0, 0, W, H);
    }

    // Blit.
    const ctx = this.ctx;
    const s = this.scale * this.dpr;
    // Nearest-neighbour keeps pixels crisp when enlarging but drops whole rows when shrinking.
    ctx.imageSmoothingEnabled = s < 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.buf, 0, 0, W * s, H * s);
    this.drawLabels(ctx, s, ox, oy);
  }

  drawRobot(g, r, ox, oy) {
    const s = r.session;
    const t = this.t + r.phase;
    const st = s.status;
    const m = providerMeta(s.provider);
    const x = Math.round(r.x + ox), y = Math.round(r.y + oy);

    if (r.drone) {
      // Small sub-agent drone.
      const bob = Math.round(Math.sin(t * 6) * 1);
      px(g, x - 3, y - 4 + bob, 7, 5, "#161827");
      px(g, x - 2, y - 3 + bob, 5, 3, st === "offline" ? "#666a80" : m.body);
      px(g, x, y - 2 + bob, 1, 1, m.eye);
      px(g, x - 4 + (Math.floor(t * 12) % 2) * 2, y - 6 + bob, 5, 1, "#b9c0d3");
      px(g, x - 1, y + 3 + bob, 3, 1, "rgba(0,0,0,0.25)");
      return;
    }

    const working = st === "working";
    const atStation = !r.walking;
    const onTool = working && atStation && r.station !== "hub" && r.station !== "dock";
    const hover = !!m.hover;
    const stepFrame = Math.floor(t * 7) % 2;
    let legs = hover ? (stepFrame ? "hover" : "hover2") : r.walking && stepFrame ? "step" : "stand";
    const blink = (t % 4) < 0.12;
    const eyes = st === "offline" ? "off" : st === "sleeping" || blink ? "closed" : "open";
    const arms = onTool && Math.floor(t * 4) % 2 === 0;
    const sprite = robotSprite({
      provider: s.provider, legs, arms, eyes,
      chest: STATUS[st]?.color || "#46e07a", gray: st === "offline",
    });
    let bob = 0;
    if (r.walking) bob = stepFrame ? -1 : 0;
    else if (onTool) bob = Math.floor(t * 4) % 2 ? -1 : 0;
    else if (hover) bob = Math.round(Math.sin(t * 3));
    const lift = hover ? 3 : 0;

    // Shadow.
    px(g, x - 5, y - 1, 11, 2, "rgba(0,0,0,0.28)");
    if (this.selected === r.key) {
      const c = Math.floor(this.t * 4) % 2 ? "#ffffff" : "#ffd23f";
      px(g, x - 8, y - 1, 3, 1, c); px(g, x + 6, y - 1, 3, 1, c);
      // bouncing cursor arrow
      const ay = y - 30 - lift + Math.round(Math.sin(this.t * 6) * 1.5);
      px(g, x - 2, ay, 5, 1, c); px(g, x - 1, ay + 1, 3, 1, c); px(g, x, ay + 2, 1, 1, c);
    }
    g.drawImage(sprite, x - 6, y - 16 + bob - lift);
    if (onTool) drawToolFx(g, r.station, x + 7, y - 8 + bob - lift, t);

    // Bubble.
    const cur = s.current;
    const bubbleY = y - 18 - lift;
    const fresh = cur && Date.now() - cur.ts < 20000;
    if (st === "blocked") drawBubble(g, "block", x + 3, bubbleY, t);
    else if (st === "waiting") drawBubble(g, "wait", x + 3, bubbleY, t);
    else if (st === "sleeping") drawBubble(g, "sleep", x + 2, y - 14, t);
    else if (working && fresh && cur.kind === "error") drawBubble(g, "error", x + 3, bubbleY, t);
    else if (working && fresh && cur.kind === "user") drawBubble(g, "user", x + 3, bubbleY, t);
    else if (working && atStation && r.station === "hub") drawBubble(g, "think", x + 3, bubbleY, t, m.body);
  }

  drawLabels(ctx, s, ox, oy) {
    const fontPx = Math.min(14 * this.dpr, Math.max(8 * this.dpr, Math.round(4 * s)));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Project signs. When zoomed out they can collide: projects with working robots
    // claim space first, and a sign that would overlap one already drawn is shortened or skipped.
    ctx.font = `${fontPx}px "Press Start 2P", monospace`;
    const busy = (p) => [...this.robots.values()].some((r) => r.project === p.name && r.session.status === "working");
    const placed = [];
    const overlaps = (b) => placed.some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
    const signs = [...this.projects.values()].sort((a, b) => busy(b) - busy(a) || a.index - b.index);
    for (const p of signs) {
      const [x, y] = p.stations.hub;
      const sx = (x + ox) * s, sy = (y + oy + HEX.row + 22) * s;
      const full = (p.label || p.name).toUpperCase();
      const h = fontPx * 2;
      // Never wider than the island itself (three hexes).
      const maxW = HEX.w * 3 * s;
      let label = full.slice(0, 22);
      while (label.length > 3 && ctx.measureText(label).width + fontPx * 1.5 > maxW) label = label.slice(0, -1);
      if (label.length < full.length) label = label.slice(0, -1) + "…";
      const w = ctx.measureText(label).width + fontPx * 1.5;
      const box = { x: sx - w / 2 - 3, y: sy - h / 2 - 3, w: w + 6, h: h + 6 };
      if (overlaps(box)) continue;
      placed.push(box);
      ctx.fillStyle = "#161827";
      ctx.fillRect(Math.round(sx - w / 2 - s), Math.round(sy - h / 2 - s), Math.round(w + 2 * s), Math.round(h + 2 * s));
      ctx.fillStyle = "#8a5a2b";
      ctx.fillRect(Math.round(sx - w / 2), Math.round(sy - h / 2), Math.round(w), Math.round(h));
      ctx.fillStyle = "#a8743f";
      ctx.fillRect(Math.round(sx - w / 2), Math.round(sy - h / 2), Math.round(w), Math.round(s));
      ctx.fillStyle = "#fff4d6";
      ctx.fillText(label, sx, sy + 1);
    }
    // Robot name tags for hovered and selected robots.
    const tagFont = Math.min(11, Math.max(8, Math.round(3.2 * s)));
    ctx.font = `${tagFont}px "Press Start 2P", monospace`;
    for (const key of new Set([this.hovered, this.selected])) {
      const r = key && this.robots.get(key);
      if (!r) continue;
      const m = providerMeta(r.session.provider);
      const sx = (r.x + ox) * s, sy = (r.y + oy - 34) * s - tagFont;
      const text = `${m.short} · ${r.session.title}`.slice(0, 42);
      const w = ctx.measureText(text).width + tagFont;
      const h = tagFont * 1.9;
      ctx.fillStyle = "#161827";
      ctx.fillRect(sx - w / 2 - 2, sy - h / 2 - 2, w + 4, h + 4);
      ctx.fillStyle = m.body;
      ctx.fillRect(sx - w / 2, sy - h / 2, w, h);
      ctx.fillStyle = "#161827";
      ctx.fillText(text, sx, sy + 1);
    }
  }
}
