// Freight Yard (prototype): the same data as the hex world, drawn as a 16-bit logistics hub.
// Every project is a depot on a street grid, every session is a truck, sub-agents are forklifts.
// Camera, pan/zoom, selection and the frame loop are inherited from World.

import { World } from "./world.js";
import { px, drawTree, drawBubble } from "./sprites.js";
import { providerMeta, STATUS } from "./meta.js";
import {
  OUT, CRATE, STATION_ORDER, obox, pixelText, textWidth, truckSprite, forkliftSprite, blit,
  drawShip, drawBuilding, drawGate, drawCrates, drawHonk,
} from "./yard-sprites.js";

// Depot geometry, in depot-local pixels.
const DW = 360, DH = 148, STREET = 24;
const LANE_TOP = 62, LANE_BOT = 92, UP = 75, DOWN = 90;
const TOP = { library: 112, hub: 184, forge: 256 }, TOP_BASE = 60;
const BOTTOM = { terminal: 106, tasks: 178, radar: 244 }, BOTTOM_BASE = 146;
const GATE_X = 22;
const GATE_QUEUE = [[58, UP], [58, DOWN], [84, DOWN], [84, UP], [32, DOWN]];
const PARK_X = 288, AISLE = 298, BAY_X = 332;
const BAYS = [22, 41, 60, 79, 98, 117, 136];
const SLOT = [0, -26, 26, -52, 52];
const HARBOR = 84;
const SPEED = 42, LIFT_SPEED = 70;
// Inventory piles beside buildings: [station, x offset from the building centre].
const PILES = { library: 30, forge: -42, terminal: -42, radar: 33 };

const where = (station) => (station in TOP ? "top" : station in BOTTOM ? "bottom" : null);
function hash(a, b, s = 1) {
  let n = (a * 73856093) ^ (b * 19349663) ^ (s * 83492791);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

export class Yard extends World {
  constructor(canvas, opts) {
    super(canvas, opts);
    this.ships = [];
    this.flights = [];
    this.puffs = [];
    this.lamps = [];
    this.delivered = 0;
  }

  // ------------------------------------------------------------ layout

  layout() {
    const n = Math.max(1, this.projectOrder.length);
    const aspect = Math.max(0.5, Math.min(4, (this.cw || 1200) / (this.ch || 700)));
    // Depots are wide and the harbor adds height: lean towards more columns.
    const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt((n * aspect * (DH + STREET)) / (DW + STREET)))));
    const rows = Math.ceil(n / cols);
    this.grid = { cols, rows, W: STREET + cols * (DW + STREET), HY: STREET + rows * (DH + STREET) };
    this.projects.clear();
    this.projectOrder.forEach((name, i) => {
      const x0 = STREET + (i % cols) * (DW + STREET), y0 = STREET + Math.floor(i / cols) * (DH + STREET);
      const stations = { dock: [x0 + BAY_X, y0 + BAYS[0]] };
      for (const [k, x] of Object.entries(TOP)) stations[k] = [x0 + x, y0 + UP];
      for (const [k, x] of Object.entries(BOTTOM)) stations[k] = [x0 + x, y0 + DOWN];
      this.projects.set(name, { name, index: i, x0, y0, stations, shore: [] });
    });
    // Moving depots around would send trucks across the map: snap them instead (not on first load,
    // when the trucks drive in through the gates).
    this.snapNext = !!this.laidOut;
    this.laidOut = true;
    this.renderTerrain();
    if (!this.userPan) this.fit();
  }

  renderTerrain() {
    const { W, HY, cols, rows } = this.grid;
    const pad = 60, H = HY + HARBOR;
    const c = document.createElement("canvas");
    c.width = W + pad * 2; c.height = H + pad * 2;
    const g = c.getContext("2d");
    g.translate(pad, pad);
    // Grass with a little texture.
    px(g, -pad, -pad, c.width, c.height, "#5f9a5c");
    for (let y = -pad; y < H + pad; y += 4) for (let x = -pad; x < W + pad; x += 4) {
      const v = hash(x, y, 2);
      if (v < 0.06) px(g, x, y, 2, 1, "#73ae69"); else if (v < 0.1) px(g, x, y, 1, 1, "#4f8a50");
    }
    // Streets.
    const asphalt = (x, y, w, h) => {
      px(g, x, y, w, h, "#3b3f4e");
      for (let k = 0; k < (w * h) / 40; k++) px(g, x + hash(k, x, 3) * w, y + hash(k, y, 4) * h, 1, 1, "#474b5c");
    };
    for (let r = 0; r <= rows; r++) asphalt(0, r * (DH + STREET), W, STREET);
    for (let k = 0; k <= cols; k++) asphalt(k * (DW + STREET), 0, STREET, HY);
    for (let r = 0; r <= rows; r++) for (let x = 0; x < W; x += 10) {
      if (x % (DW + STREET) < STREET + 2) continue;
      px(g, x, r * (DH + STREET) + 11, 6, 2, "#e8d36a");
    }
    for (let k = 0; k <= cols; k++) for (let y = 0; y < HY; y += 10) {
      if (y % (DH + STREET) < STREET + 2) continue;
      px(g, k * (DW + STREET) + 11, y, 2, 6, "#e8d36a");
    }
    // Street lamps on every corner.
    this.lamps = [];
    for (let r = 0; r <= rows; r++) for (let k = 0; k <= cols; k++) {
      const lx = k * (DW + STREET) + STREET + 2, ly = r * (DH + STREET) - 1;
      if (ly < 0) continue;
      px(g, lx, ly - 12, 1, 12, "#2b2d3a"); px(g, lx, ly - 13, 4, 2, "#2b2d3a"); px(g, lx + 2, ly - 11, 2, 1, "#ffe9a0");
      this.lamps.push([lx + 3, ly - 10]);
    }
    // Depots.
    for (const d of this.projects.values()) {
      const { x0, y0 } = d;
      px(g, x0, y0, DW, DH, "#8f919b");
      for (let x = 0; x < DW; x += 24) px(g, x0 + x, y0, 1, DH, "#858792");
      for (let y = 0; y < DH; y += 24) px(g, x0, y0 + y, DW, 1, "#858792");
      // Fence along the top and bottom edges.
      for (let x = 0; x < DW; x += 6) { px(g, x0 + x, y0, 1, 3, "#5c6070"); px(g, x0 + x, y0 + DH - 3, 1, 3, "#5c6070"); }
      px(g, x0, y0 + 1, DW, 1, "#7a7f92"); px(g, x0, y0 + DH - 2, DW, 1, "#7a7f92");
      // The yard lane, joined to the street on the left.
      asphalt(x0, y0 + LANE_TOP, PARK_X, LANE_BOT - LANE_TOP);
      px(g, x0, y0 + LANE_TOP, PARK_X, 1, "#d8dae0"); px(g, x0, y0 + LANE_BOT - 1, PARK_X, 1, "#d8dae0");
      for (let x = 44; x < PARK_X - 6; x += 10) px(g, x0 + x, y0 + (LANE_TOP + LANE_BOT) / 2 - 1, 6, 1, "#e8d36a");
      // Parking lot: bays with chargers.
      asphalt(x0 + PARK_X, y0 + 4, DW - PARK_X, DH - 8);
      for (const by of BAYS) {
        px(g, x0 + 314, y0 + by - 15, 42, 1, "#d8dae0");
        obox(g, x0 + DW - 6, y0 + by - 11, 4, 9, "#2b2d3a"); px(g, x0 + DW - 5, y0 + by - 10, 2, 2, "#46e07a");
      }
      px(g, x0 + 314, y0 + BAYS[BAYS.length - 1] + 4, 42, 1, "#d8dae0");
      obox(g, x0 + PARK_X + 2, y0 + 6, 9, 9, "#2f6fd0"); pixelText(g, "P", x0 + PARK_X + 5, y0 + 8, "#ffffff");
    }
    // Empty plots in the last row: room to grow.
    for (let i = this.projects.size; i < cols * rows; i++) {
      const x0 = STREET + (i % cols) * (DW + STREET), y0 = STREET + Math.floor(i / cols) * (DH + STREET);
      for (let k = 0; k < 6; k++) drawTree(g, x0 + 30 + hash(i, k, 12) * (DW - 60), y0 + 30 + hash(k, i, 13) * (DH - 40), hash(i, k, 14));
      const sx = x0 + DW / 2 - 22, sy = y0 + DH / 2 - 10;
      px(g, sx + 8, sy + 12, 2, 10, "#5c4630"); px(g, sx + 34, sy + 12, 2, 10, "#5c4630");
      obox(g, sx, sy, 44, 14, "#f2ead6");
      pixelText(g, "FOR LEASE", sx + 5, sy + 5, "#b8433a");
    }
    // Trees along the outer edges.
    for (let x = 10; x < W; x += 34) { if (hash(x, 1, 7) < 0.7) drawTree(g, x, -6, hash(x, 2, 7)); }
    for (let y = 30; y < HY; y += 36) {
      if (hash(y, 3, 7) < 0.7) drawTree(g, -12, y, hash(y, 4, 7));
      if (hash(y, 5, 7) < 0.7) drawTree(g, W + 12, y, hash(y, 6, 7));
    }
    // Harbor: a quay with bollards, then the sea.
    px(g, -pad, HY, W + pad * 2, 14, "#9a9ca6");
    px(g, -pad, HY + 12, W + pad * 2, 2, "#6a6c76");
    for (let x = 8; x < W; x += 30) obox(g, x, HY + 7, 4, 4, "#3b3f4e");
    px(g, -pad, HY + 14, W + pad * 2, HARBOR + pad, "#1e4a66");
    for (let y = HY + 20; y < H + pad; y += 6) for (let x = -pad; x < W + pad; x += 18) {
      if (hash(x, y, 8) < 0.4) px(g, x + ((y / 6) % 2) * 9, y, 5, 1, "#265a78");
    }
    this.terrain = { canvas: c, ox: -pad, oy: -pad, land: { minX: 0, minY: 0, maxX: W, maxY: HY + HARBOR - 30 } };
  }

  // ------------------------------------------------------------ data

  stopFor(d, place, i) {
    const { x0, y0 } = d;
    if (place === "gate") {
      const [x, y] = GATE_QUEUE[i % GATE_QUEUE.length];
      return { key: `gate${i}`, x: x0 + x, y: y0 + y, lane: y, park: false, face: -1 };
    }
    if (place === "dock") {
      const by = BAYS[i % BAYS.length];
      return { key: `dock${i}`, x: x0 + BAY_X - Math.floor(i / BAYS.length) * 5, y: y0 + by, lane: by < 77 ? UP : DOWN, park: true };
    }
    const top = place in TOP;
    const cx = top ? TOP[place] : BOTTOM[place];
    const lane = top ? UP : DOWN;
    return { key: `${place}${i}`, x: x0 + cx + SLOT[i % SLOT.length] + Math.floor(i / SLOT.length) * 8, y: y0 + lane, lane, park: false };
  }

  assignSlots() {
    const groups = new Map();
    const trucks = [...this.robots.values()].filter((r) => !r.drone).sort((a, b) => a.key.localeCompare(b.key));
    for (const r of trucks) {
      const d = this.projects.get(r.project);
      if (!d) continue;
      const s = r.session;
      // Approvals queue at customs; "your turn" honks at the HQ loading dock; idle trucks park.
      const place = s.status === "blocked" ? "gate" : where(r.station) || r.station === "dock" ? r.station : "hub";
      const g = r.project + "/" + place;
      const i = groups.get(g) || 0;
      groups.set(g, i + 1);
      r.stop = this.stopFor(d, place, i);
      r.depot = d;
      r.crates = s.events.filter((e) => e.kind === "tool").slice(-6).map((e) => CRATE[e.station] || CRATE.tasks);
      if (!r.init) {
        // New sessions drive in from the street through the gate.
        r.init = true;
        r.x = d.x0 - 12; r.y = d.y0 + UP; r.face = 1; r.routeKey = null;
        r.load = Math.random();
      }
      if (this.snapNext) { r.x = r.stop.x; r.y = r.stop.y; r.route = []; r.routeKey = r.stop.key; }
      if (r.prevStatus === "working" && s.status === "waiting") this.launchShip(r);
      r.prevStatus = s.status;
      r.tx = r.stop.x; r.ty = r.stop.y;
    }
    for (const r of this.robots.values()) {
      if (!r.drone || r.init) continue;
      r.init = true; r.face = 1;
      const parent = this.robots.get(r.session.parent);
      const d = this.projects.get(r.project);
      if (parent) { r.x = parent.x - 20; r.y = parent.y; } else if (d) { r.x = d.x0 + 70; r.y = d.y0 + DOWN; }
    }
    if (this.firstShip !== true && trucks.length) {
      // One ship already at sea, so the harbor is never empty on start.
      this.firstShip = true;
      this.ships.push({ x: this.grid.W * 0.3, lane: 0, colors: trucks.slice(0, 8).map((r) => providerMeta(r.session.provider).body) });
    }
    this.delivered = trucks.reduce((n, r) => n + r.session.events.filter((e) => e.kind === "done").length, 0);
    this.snapNext = false;
  }

  launchShip(r) {
    if (this.paused || this.ships.length > 4) return;
    const colors = [providerMeta(r.session.provider).body, ...(r.crates || [])].slice(0, 8);
    this.ships.push({ x: -60, lane: this.ships.length % 2, colors });
  }

  /** L-shaped legs along the yard lane, through the parking aisle when needed. */
  route(r) {
    const d = r.depot, tgt = r.stop;
    let x = r.x - d.x0, y = r.y - d.y0;
    const pts = [];
    if (x > PARK_X - 2) { pts.push([AISLE, y]); x = AISLE; }
    const lane = tgt.lane;
    pts.push([x, lane]);
    if (tgt.park) pts.push([AISLE, lane], [AISLE, tgt.y - d.y0], [tgt.x - d.x0, tgt.y - d.y0]);
    else pts.push([tgt.x - d.x0, lane]);
    return pts.map(([px_, py_]) => [px_ + d.x0, py_ + d.y0]);
  }

  // ------------------------------------------------------------ simulation

  setPaused(paused) {
    super.setPaused(paused);
    this.flights = []; this.puffs = [];
  }

  update(dt) {
    if (this.cameraTarget) {
      const blend = this.paused ? 1 : 1 - Math.exp(-9 * dt);
      this.cam.x += (this.cameraTarget.x - this.cam.x) * blend;
      this.cam.y += (this.cameraTarget.y - this.cam.y) * blend;
      if (Math.hypot(this.cameraTarget.x - this.cam.x, this.cameraTarget.y - this.cam.y) < 0.1) this.cameraTarget = null;
    }
    const lifts = [...this.robots.values()].filter((r) => r.drone).sort((a, b) => a.key.localeCompare(b.key));
    for (const r of this.robots.values()) {
      if (r.drone) { this.liftTarget(r, lifts); this.moveStraight(r, dt); continue; }
      if (!r.stop) continue;
      if (this.paused) { r.x = r.stop.x; r.y = r.stop.y; r.route = []; r.routeKey = r.stop.key; r.walking = false; continue; }
      if (r.routeKey !== r.stop.key + r.stop.x + r.stop.y) { r.route = this.route(r); r.routeKey = r.stop.key + r.stop.x + r.stop.y; }
      let budget = SPEED * dt;
      while (budget > 0 && r.route.length) {
        const [wx, wy] = r.route[0];
        const dx = wx - r.x, dy = wy - r.y, d = Math.hypot(dx, dy);
        if (Math.abs(dx) > 0.5) r.face = Math.sign(dx);
        if (d <= budget) { r.x = wx; r.y = wy; budget -= d; r.route.shift(); }
        else { r.x += (dx / d) * budget; r.y += (dy / d) * budget; budget = 0; }
      }
      r.walking = r.route.length > 0;
      // Trucks held at customs turn to face the barrier.
      if (!r.walking && r.stop.face) r.face = r.stop.face;
      this.truckEffects(r, dt);
    }
    if (!this.paused) {
      for (const s of this.ships) s.x += 15 * dt;
      this.ships = this.ships.filter((s) => s.x < this.grid.W + 80);
      this.flights = this.flights.filter((f) => (f.k += dt / 0.7) < 1);
      this.puffs = this.puffs.filter((p) => { p.life -= dt; p.y -= 9 * dt; p.x -= p.face * 4 * dt; return p.life > 0; });
    }
    this.fx = this.fx.filter((f) => { f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 30 * dt; return f.life > 0; });
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    this.night = h >= 20 || h < 6 ? 1 : h >= 18 ? (h - 18) / 2 : h < 8 ? (8 - h) / 2 : 0;
  }

  truckEffects(r, dt) {
    if (this.paused) return;
    const s = r.session;
    const working = s.status === "working";
    // Exhaust: heavier token use, thicker smoke.
    const heavy = (s.tokensIn + s.tokensOut) > 400000 ? 0.5 : 1;
    r.smoke = (r.smoke || 0) - dt;
    if ((r.walking || working) && r.smoke <= 0 && !providerMeta(s.provider).hover) {
      this.puffs.push({ x: r.x + r.face * 5, y: r.y - 20, life: 1.1, face: r.face });
      r.smoke = (r.walking ? 0.22 : 0.7) * heavy;
    }
    // Loading: a crate hops from the building onto the bed while a tool runs there.
    const station = r.station;
    if (working && !r.walking && where(station) && station !== "hub") {
      r.load = (r.load || 0) - dt;
      if (r.load <= 0) {
        const top = where(station) === "top";
        const bx = r.depot.x0 + (top ? TOP[station] : BOTTOM[station]);
        this.flights.push({ x0: bx, y0: r.depot.y0 + (top ? TOP_BASE - 6 : BOTTOM_BASE - 46), x1: r.x - r.face * 7, y1: r.y - 12, k: 0, color: CRATE[station] });
        r.load = 1.1 + Math.random() * 0.6;
      }
    }
  }

  liftTarget(r, lifts) {
    const s = r.session;
    const d = this.projects.get(r.project);
    if (!d) return;
    if (s.status === "working" && where(r.station) && r.station !== "hub") {
      const peers = lifts.filter((o) => o.project === r.project && o.station === r.station && o.session.status === "working");
      const k = peers.indexOf(r);
      const top = where(r.station) === "top";
      const cx = top ? TOP[r.station] : BOTTOM[r.station];
      r.tx = d.x0 + cx + (k % 2 ? -1 : 1) * (38 + Math.floor(k / 2) * 12);
      r.ty = d.y0 + (top ? 68 : 95);
      return;
    }
    const parent = this.robots.get(s.parent);
    const kids = lifts.filter((o) => o.session.parent === s.parent && !(o.session.status === "working" && where(o.station) && o.station !== "hub"));
    const k = Math.max(0, kids.indexOf(r));
    if (parent) { r.tx = parent.x - (parent.face || 1) * (25 + k * 15); r.ty = parent.y + 1; }
    else { r.tx = d.x0 + 70 + k * 15; r.ty = d.y0 + DOWN; }
  }

  moveStraight(r, dt) {
    const dx = r.tx - r.x, dy = r.ty - r.y, d = Math.hypot(dx, dy);
    if (this.paused) { r.x = r.tx; r.y = r.ty; r.walking = false; return; }
    if (d > 0.5) {
      const k = Math.min(1, (LIFT_SPEED * dt) / d);
      r.x += dx * k; r.y += dy * k;
      if (Math.abs(dx) > 0.5) r.face = Math.sign(dx);
      r.walking = d > 1.5;
    } else r.walking = false;
  }

  // ------------------------------------------------------------ rendering

  hit(e) {
    const rect = this.canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left) / this.scale - this.offX;
    const wy = (e.clientY - rect.top) / this.scale - this.offY;
    let best = null, bestD = 1e9;
    for (const r of this.robots.values()) {
      const dx = wx - r.x, dy = wy - r.y;
      const [hw, hh] = r.drone ? [9, 16] : [15, 21];
      if (Math.abs(dx) <= hw && dy <= 2 && dy >= -hh) {
        const dist = dx * dx + (dy + hh / 2) ** 2;
        if (dist < bestD) { best = r.key; bestD = dist; }
      }
    }
    return best;
  }

  draw() {
    const g = this.bctx;
    const W = this.buf.width, H = this.buf.height;
    const t = this.t;
    this.offX = Math.round(W / 2 - this.cam.x);
    this.offY = Math.round(H / 2 - this.cam.y);
    const ox = this.offX, oy = this.offY;
    g.fillStyle = "#5f9a5c";
    g.fillRect(0, 0, W, H);
    if (this.terrain) g.drawImage(this.terrain.canvas, this.terrain.ox + ox, this.terrain.oy + oy);
    if (!this.grid) return this.blit();
    const { HY } = this.grid;

    // Harbor: glints, ships and the delivery board.
    for (let i = 0; i < 40; i++) {
      const v = hash(i, 3, 9), k = (t * 0.5 + v) % 1;
      if (k < 0.3) px(g, ox + v * this.grid.W, oy + HY + 22 + hash(i, 5, 9) * (HARBOR - 30), k < 0.15 ? 3 : 2, 1, "#8cc4f5");
    }
    for (const s of this.ships) drawShip(g, s.x + ox, HY + oy + 40 + s.lane * 24, s.colors, t + s.lane);
    const label = `TURNS DELIVERED ${this.delivered}`;
    obox(g, ox + 10, oy + HY + 1, textWidth(label) + 8, 10, "#1f2236");
    pixelText(g, label, ox + 14, oy + HY + 3, "#ffd23f");

    // Depth-sorted buildings, vehicles and props.
    const drawables = [];
    const busy = new Set();
    for (const r of this.robots.values()) {
      if (r.session.status === "working" && !r.walking) busy.add(r.project + "/" + r.station);
    }
    for (const d of this.projects.values()) {
      const { x0, y0 } = d;
      const held = [...this.robots.values()].some((r) => !r.drone && r.project === d.name && r.session.status === "blocked");
      const anyWorking = [...this.robots.values()].some((r) => r.project === d.name && r.session.status === "working");
      for (const [st, x] of Object.entries(TOP)) {
        const on = busy.has(d.name + "/" + st) || (st === "hub" && anyWorking);
        drawables.push({ y: y0 + TOP_BASE, draw: () => drawBuilding(g, st, x0 + x + ox, y0 + TOP_BASE + oy, t, on, this.night) });
      }
      for (const [st, x] of Object.entries(BOTTOM)) {
        drawables.push({ y: y0 + BOTTOM_BASE, draw: () => drawBuilding(g, st, x0 + x + ox, y0 + BOTTOM_BASE + oy, t, busy.has(d.name + "/" + st), this.night) });
      }
      drawables.push({ y: y0 + LANE_TOP, draw: () => drawGate(g, x0 + GATE_X + ox, y0 + LANE_TOP + oy, y0 + LANE_BOT + oy, t, held) });
      // Stock piles: how much work went through each building, on a log scale.
      const totals = new Array(6).fill(0);
      for (const r of this.robots.values()) if (r.project === d.name) r.session.stations?.forEach((n, i) => { totals[i] += n; });
      for (const [st, dx] of Object.entries(PILES)) {
        const n = Math.min(8, Math.round(Math.log2(1 + totals[STATION_ORDER.indexOf(st)]) * 1.4));
        const top = st in TOP;
        const base = y0 + (top ? TOP_BASE : BOTTOM_BASE);
        const cx = x0 + (top ? TOP[st] : BOTTOM[st]) + dx;
        drawables.push({ y: base, draw: () => drawCrates(g, cx + ox, base + oy - 1, n, CRATE[st]) });
      }
    }
    for (const r of this.robots.values()) {
      drawables.push({ y: r.y + (r.drone ? 0.5 : 0), draw: () => (r.drone ? this.drawLift(g, r, ox, oy) : this.drawTruck(g, r, ox, oy)) });
    }
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();

    // Crates in flight, exhaust and sparkles.
    for (const f of this.flights) {
      const x = f.x0 + (f.x1 - f.x0) * f.k, y = f.y0 + (f.y1 - f.y0) * f.k - Math.sin(f.k * Math.PI) * 14;
      obox(g, Math.round(x + ox) - 2, Math.round(y + oy) - 2, 5, 5, f.color);
    }
    for (const p of this.puffs) {
      g.globalAlpha = Math.max(0, p.life) * 0.7;
      const s = p.life > 0.6 ? 2 : 3;
      px(g, p.x + ox, p.y + oy, s, s, "#d0d2da");
    }
    g.globalAlpha = 1;
    for (const f of this.fx) px(g, f.x + ox, f.y + oy, 1, 1, f.color);

    // Cloud shadows drifting over the yard.
    g.fillStyle = "rgba(10,12,30,0.12)";
    for (let i = 0; i < 3; i++) {
      const cx = ((t * (4 + i) + i * 260) % (W + 200)) - 100;
      const cy = (H * (0.2 + i * 0.3)) | 0;
      g.fillRect(cx | 0, cy, 44, 8); g.fillRect((cx + 8) | 0, cy - 5, 26, 5); g.fillRect((cx - 6) | 0, cy + 3, 58, 4);
    }
    if (this.night > 0) {
      g.fillStyle = `rgba(12,10,60,${0.28 * this.night})`;
      g.fillRect(0, 0, W, H);
      // Street lamps pool light on the asphalt.
      for (const [lx, ly] of this.lamps) {
        for (let k = 3; k >= 1; k--) {
          g.fillStyle = `rgba(255,233,160,${0.07 * this.night})`;
          g.fillRect(lx + ox - k * 5, ly + oy + 4 - k * 2, k * 10, k * 5 + 4);
        }
      }
    }
    this.blit();
  }

  blit() {
    const ctx = this.ctx;
    const s = this.scale * this.dpr;
    ctx.imageSmoothingEnabled = s < 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.buf, 0, 0, this.buf.width * s, this.buf.height * s);
    this.drawLabels(ctx, s, this.offX, this.offY);
  }

  drawTruck(g, r, ox, oy) {
    const s = r.session, st = s.status, t = this.t + r.phase;
    const m = providerMeta(s.provider);
    const x = Math.round(r.x + ox), y = Math.round(r.y + oy);
    const working = st === "working", arrived = !r.walking;
    const hover = !!m.hover;
    const lift = hover ? 3 + Math.round(Math.sin(t * 3)) : 0;
    const bob = !hover && (r.walking || working) && Math.floor(t * 10) % 2 ? -1 : 0;
    const flash = Math.floor(t * 4) % 2;
    const sprite = truckSprite({
      provider: s.provider, crates: r.crates || [], wheel: r.walking ? Math.floor(t * 8) % 2 : 0,
      light: STATUS[st]?.color || "#46e07a", gray: st === "offline", hover,
      beacon: st === "blocked" ? (flash ? "#ff3a4a" : "#7a1a22") : null,
    });
    px(g, x - 14, y - 1, 28, 2, "rgba(0,0,0,0.3)");
    if (this.selected === r.key) {
      const c = Math.floor(this.t * 4) % 2 ? "#ffffff" : "#ffd23f";
      px(g, x - 17, y - 1, 3, 1, c); px(g, x + 15, y - 1, 3, 1, c);
      const ay = y - 34 - lift + Math.round(Math.sin(this.t * 6) * 1.5);
      px(g, x - 2, ay, 5, 1, c); px(g, x - 1, ay + 1, 3, 1, c); px(g, x, ay + 2, 1, 1, c);
    }
    blit(g, sprite, x, y + bob - lift, r.face);
    // Bubbles over the cab.
    const cabX = x + r.face * 9, by = y - 22 - lift;
    const cur = s.current, fresh = cur && Date.now() - cur.ts < 20000;
    if (st === "blocked") drawBubble(g, "block", cabX, by, t);
    else if (st === "waiting") { drawBubble(g, "wait", cabX, by, t); if (arrived) drawHonk(g, x + r.face * 16, y - 9, r.face, t); }
    else if (st === "sleeping") drawBubble(g, "sleep", cabX - 2, y - 18, t);
    else if (working && fresh && cur.kind === "error") drawBubble(g, "error", cabX, by, t);
    else if (working && fresh && cur.kind === "user") drawBubble(g, "user", cabX, by, t);
    else if (working && arrived && r.station === "hub") drawBubble(g, "think", cabX, by, t, m.body);
  }

  drawLift(g, r, ox, oy) {
    const s = r.session, st = s.status, t = this.t + r.phase;
    const x = Math.round(r.x + ox), y = Math.round(r.y + oy);
    const busyAt = st === "working" && where(r.station) && r.station !== "hub";
    const sprite = forkliftSprite({
      provider: s.provider, crate: busyAt ? CRATE[r.station] : null,
      fork: busyAt ? (Math.floor(t * 2) % 2 ? 4 : 0) : 0,
      light: STATUS[st]?.color || "#46e07a", gray: st === "offline",
    });
    px(g, x - 7, y - 1, 15, 2, "rgba(0,0,0,0.28)");
    if (this.selected === r.key) {
      const c = Math.floor(this.t * 4) % 2 ? "#ffffff" : "#ffd23f";
      const ay = y - 24 + Math.round(Math.sin(this.t * 6) * 1.5);
      px(g, x - 2, ay, 5, 1, c); px(g, x - 1, ay + 1, 3, 1, c); px(g, x, ay + 2, 1, 1, c);
    }
    blit(g, sprite, x, y + (r.walking && Math.floor(t * 10) % 2 ? -1 : 0), r.face);
    const cur = s.current;
    if (cur?.kind === "error" && Date.now() - cur.ts < 20000) drawBubble(g, "error", x, y - 16, t);
    else if (st === "working" && !busyAt) drawBubble(g, "think", x, y - 16, t, providerMeta(s.provider).body);
  }

  drawLabels(ctx, s, ox, oy) {
    const fontPx = Math.min(13 * this.dpr, Math.max(7 * this.dpr, Math.round(3.6 * s)));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fontPx}px "Press Start 2P", monospace`;
    // Green highway signs with the project name, in the corner by each depot's gate.
    for (const d of this.projects.values()) {
      const sx = (d.x0 + 40 + ox) * s, sy = (d.y0 + 122 + oy) * s;
      const maxW = 74 * s;
      const full = (d.label || d.name).toUpperCase();
      let label = full.slice(0, 24);
      while (label.length > 3 && ctx.measureText(label).width + fontPx * 1.4 > maxW) label = label.slice(0, -1);
      if (label.length < full.length) label = label.slice(0, -1) + "…";
      const w = ctx.measureText(label).width + fontPx * 1.4, h = fontPx * 2.4;
      // Posts, then the sign itself.
      ctx.fillStyle = OUT;
      ctx.fillRect(Math.round(sx - w / 4), Math.round(sy), Math.round(2 * s), Math.round(14 * s));
      ctx.fillRect(Math.round(sx + w / 4), Math.round(sy), Math.round(2 * s), Math.round(14 * s));
      ctx.fillRect(Math.round(sx - w / 2 - s), Math.round(sy - h / 2 - s), Math.round(w + 2 * s), Math.round(h + 2 * s));
      ctx.fillStyle = "#1f7a4f";
      ctx.fillRect(Math.round(sx - w / 2), Math.round(sy - h / 2), Math.round(w), Math.round(h));
      ctx.strokeStyle = "#e8f5ec";
      ctx.lineWidth = Math.max(1, Math.round(s / 2));
      ctx.strokeRect(Math.round(sx - w / 2 + s), Math.round(sy - h / 2 + s), Math.round(w - 2 * s), Math.round(h - 2 * s));
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, sx, sy + 1);
    }
    const tagFont = Math.min(11, Math.max(8, Math.round(3.2 * s)));
    ctx.font = `${tagFont}px "Press Start 2P", monospace`;
    for (const key of new Set([this.hovered, this.selected])) {
      const r = key && this.robots.get(key);
      if (!r) continue;
      const m = providerMeta(r.session.provider);
      const sx = (r.x + ox) * s, sy = (r.y + oy - (r.drone ? 28 : 40)) * s - tagFont;
      const text = `${r.drone ? "FORKLIFT" : m.short} · ${r.session.title}`.slice(0, 42);
      const w = ctx.measureText(text).width + tagFont, h = tagFont * 1.9;
      ctx.fillStyle = OUT;
      ctx.fillRect(sx - w / 2 - 2, sy - h / 2 - 2, w + 4, h + 4);
      ctx.fillStyle = m.body;
      ctx.fillRect(sx - w / 2, sy - h / 2, w, h);
      ctx.fillStyle = OUT;
      ctx.fillText(text, sx, sy + 1);
    }
  }
}
