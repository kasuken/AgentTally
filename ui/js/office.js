// Agent Office (prototype): one big open-plan office. Every project is a team pod of desks,
// every session is a robot employee. Thinking agents meet in the meeting room, readers go to the
// library, runners to the server room, web/MCP calls happen in the phone booths, planning at the
// kanban board. Approvals queue at the manager's door (you), idle agents take a break.
// Camera, pan/zoom, selection and the frame loop are inherited from World.

import { World } from "./world.js";
import { px, robotSprite, droneSprite, drawBubble, drawToolFx } from "./sprites.js";
import { providerMeta, STATUS } from "./meta.js";
import * as F from "./office-sprites.js";

const { OUT, obox, pixelText } = F;
const LEFTW = 104, AISLE = 24, POD_W = 112, POD_H = 66, ROWGAP = 24, TOPH = 100, BOTH = 112, MIN_FW = 700;
const SEAT_X = [22, 56, 90], SEAT_Y = [26, 58];
const TEAM_SOFT = ["#a596d0", "#86bfc9", "#d6aa86", "#93c493", "#d4c47a", "#c495b8", "#93a8dc", "#d69494"];
const TEAM = ["#6a4f93", "#2f6f7f", "#8a553e", "#3f6f42", "#7a6a2e", "#6a3f5c", "#33508a", "#7f4040"];
const SPEED = 34, DRONE_SPEED = 60;
const ROOM_STATIONS = new Set(["library", "terminal", "radar", "tasks"]);
const SOFT = ["couch0", "couch1", "couch2", "bean0", "bean1"];
// Idle pastimes rotate every 45 s, so the break room keeps changing.
const PASTIMES = [
  ["pp0", "pp1", "coffee", "fridge", "cooler0", "cooler1"],
  ["cooler0", "cooler1", "coffee", "couch0", "fridge", "pp0"],
  ["coffee", "couch1", "bean0", "pp0", "pp1", "cooler0"],
];

const hashKey = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const same = (a, b) => Math.abs(a - b) < 0.6;

export class Office extends World {
  constructor(canvas, opts) {
    super(canvas, opts);
    this.roomba = { x: 0, dir: 1 };
  }

  // ------------------------------------------------------------ floor plan

  layout() {
    const n = Math.max(1, this.projectOrder.length);
    const aspect = Math.max(0.5, Math.min(3, (this.cw || 1200) / (this.ch || 700)));
    const cols = Math.max(1, Math.min(n, Math.ceil(Math.sqrt((n * aspect * 1.4 * (POD_H + ROWGAP)) / (POD_W + AISLE)))));
    const rows = Math.ceil(n / cols);
    const Lc = LEFTW + AISLE / 2;
    const vlines = Array.from({ length: cols + 1 }, (_, c) => Lc + c * (POD_W + AISLE));
    const FW = Math.max(MIN_FW, vlines[cols] + AISLE / 2 + 8);
    const Ct = TOPH + 12;
    const podY = (r) => Ct + 18 + r * (POD_H + ROWGAP);
    const wbY = TOPH + 16 + 3 * 34 + 8;
    const Cb = Math.max(podY(rows - 1) + POD_H + 14, wbY + 74);
    const by = Cb + 26, FH = by + BOTH;
    const mw = Math.round(FW * 0.36), lw = Math.round(FW * 0.22), sw = Math.round(FW * 0.17);
    const rooms = {
      meeting: { x: 0, w: mw, door: mw - 26 },
      library: { x: mw, w: lw, door: mw + Math.round(lw / 2) + 14 },
      server: { x: mw + lw, w: sw, door: mw + lw + Math.round(sw / 2) },
      boss: { x: mw + lw + sw, w: FW - (mw + lw + sw), door: mw + lw + sw + 26 },
    };
    const brW = Math.round(FW * 0.5), bathW = Math.round(FW * 0.13);
    const meetW = Math.min(120, mw - 90);
    this.plan = {
      cols, rows, Lc, vlines, FW, FH, Ct, Cb, by, wbY, rooms, brW, bathW,
      breakDoor: brW - 40, bathDoor: brW + bathW - 16, lobbyDoor: brW + bathW + 24,
      meet: { cx: Math.round((mw - 40) / 2) + 4, w: meetW },
    };
    this.projects.clear();
    this.projectOrder.forEach((name, i) => {
      const pod = { x: LEFTW + AISLE + (i % cols) * (POD_W + AISLE), y: podY(Math.floor(i / cols)), aisle: vlines[i % cols] };
      const spawn = [FW - 40, by + 28];
      this.projects.set(name, { name, index: i, pod, color: TEAM[i % TEAM.length], soft: TEAM_SOFT[i % TEAM_SOFT.length], stations: { hub: spawn, dock: spawn }, shore: [] });
    });
    this.snapNext = !!this.laidOut;
    this.laidOut = true;
    this.renderTerrain();
    if (!this.userPan) this.fit();
  }

  /** A place a robot can be: its spot, how it stands there, and how to reach it from the corridors. */
  spot(key, room, x, y, E, via = [], extra = {}) {
    return { key, room, x, y, E, via, pose: "stand", ...extra };
  }

  place(kind, i) {
    const P = this.plan, R = P.rooms;
    const topVia = (room) => [[room.door, TOPH - 8]];
    const topE = (room) => [room.door, P.Ct];
    if (kind === "meeting") {
      const m = R.meeting, { cx, w } = P.meet;
      const E = topE(m);
      if (i < 4) {
        const x = Math.round(cx + (i - 1.5) * (w / 4));
        return this.spot(`meet${i}`, "meeting", x, 58, E, [...topVia(m), [m.door, 40], [x, 40]], { pose: "sit" });
      }
      if (i === 4) return this.spot("meet4", "meeting", Math.round(cx - w / 2 - 10), 74, E, [...topVia(m), [m.door, 40], [Math.round(cx - w / 2 - 10), 40]], { pose: "sit" });
      if (i === 5) return this.spot("meet5", "meeting", Math.round(cx + w / 2 + 10), 74, E, topVia(m), { pose: "sit" });
      return this.spot(`meet${i}`, "meeting", Math.round(cx - w / 2) + ((i - 6) % 8) * 14, 84, E, topVia(m));
    }
    if (kind === "library") {
      const r = R.library, per = Math.max(1, Math.floor((r.w - 24) / 20));
      return this.spot(`lib${i}`, "library", r.x + 18 + (i % per) * 20 + Math.floor(i / per) * 5, 64 + Math.floor(i / per) * 4, topE(r), topVia(r), { pose: "work" });
    }
    if (kind === "terminal") {
      const r = R.server, per = Math.max(1, Math.floor((r.w - 12) / 22));
      return this.spot(`srv${i}`, "server", r.x + 15 + (i % per) * 22, 68 + Math.floor(i / per) * 6, topE(r), topVia(r), { pose: "work" });
    }
    if (kind === "queue") {
      const x = Math.max(P.Lc + 10, R.boss.door - 16 - i * 15);
      return this.spot(`queue${i}`, "queue", x, TOPH + 9, [x, P.Ct], [], { pose: "paper" });
    }
    if (kind === "radar") {
      const k = i % 3, y0 = TOPH + 16 + k * 34;
      return this.spot(`booth${i}`, "booths", 36 + Math.floor(i / 3) * 18, y0 + 26, [P.Lc, y0 + 26], [[LEFTW - 6, y0 + 26]], { pose: "phone" });
    }
    if (kind === "tasks") {
      return this.spot(`plan${i}`, "planning", 16 + (i % 5) * 16, P.wbY + 58 + Math.floor(i / 5) * 6, [P.Lc, P.wbY + 58], [[LEFTW - 6, P.wbY + 58]], { pose: "board" });
    }
    if (kind === "lobby") {
      return this.spot(`lobby${i}`, "lobby", P.FW - 26 - (i % 8) * 14, P.by + 92 + Math.floor(i / 8) * 6, [P.lobbyDoor, P.Cb], [[P.lobbyDoor, P.by + 10]], { pose: "gone" });
    }
    if (kind === "spawn") return this.spot("spawn", "lobby", P.FW - 40, P.by + 28, [P.lobbyDoor, P.Cb], [[P.lobbyDoor, P.by + 10]]);
    return null;
  }

  breakSpot(key, sleeping) {
    const P = this.plan, by = P.by, E = [P.breakDoor, P.Cb], via = [[P.breakDoor, by + 10]];
    const ppx = P.brW - 100;
    const spots = {
      coffee: [44, by + 30, "coffee"], fridge: [14, by + 34, "stand"], cooler0: [134, by + 34, "stand"], cooler1: [150, by + 38, "stand"],
      pp0: [ppx - 36, by + 64, "stand"], pp1: [ppx + 36, by + 64, "stand"],
      couch0: [28, by + 92, "sit"], couch1: [46, by + 92, "sit"], couch2: [64, by + 92, "sit"],
      bean0: [96, by + 93, "sit"], bean1: [116, by + 93, "sit"],
    };
    const [x, y, pose] = spots[key] || [150 + (hashKey(key) % 5) * 12, by + 50, "stand"];
    return this.spot(`break-${key}`, "break", x, y, E, via, { pose: sleeping ? "sleep" : pose, over: pose === "sit" });
  }

  seat(r, i, pose) {
    const d = this.projects.get(r.project);
    const row = Math.floor(i / 3) % 2, col = i % 3, extra = Math.floor(i / 6) * 5;
    const x = d.pod.x + SEAT_X[col] + extra, y = d.pod.y + SEAT_Y[row];
    return this.spot(`seat:${r.project}:${i}`, `pod:${r.project}`, x, y, [d.pod.aisle, y], [], { pose, desk: true });
  }

  renderTerrain() {
    const P = this.plan, { FW, FH, by, rooms: R, brW, bathW, wbY } = P;
    const pad = 40;
    const c = document.createElement("canvas");
    c.width = FW + pad * 2; c.height = FH + pad * 2;
    const g = c.getContext("2d");
    g.translate(pad, pad);
    px(g, -pad, -pad, c.width, c.height, "#1e2130");
    // Floors: light tiles everywhere, then each room's own floor.
    F.drawFloor(g, 0, 0, FW, FH, "tile");
    const roomFloor = { meeting: "wood", library: "wood", server: "server", boss: "wood" };
    for (const [k, r] of Object.entries(R)) F.drawFloor(g, r.x, 20, r.w, TOPH - 34, roomFloor[k]);
    F.drawRug(g, R.library.x + R.library.w - 58, 64, 50, 22, "#5a7ab0", "#3f5a88");
    F.drawRug(g, R.boss.x + 14, 40, R.boss.w - 28, 40, "#a85a5a", "#844040");
    F.drawFloor(g, 0, TOPH, LEFTW - 6, wbY - TOPH - 6, "dark");
    F.drawFloor(g, 0, by, brW, FH - by, "kitchen");
    F.drawRug(g, 8, by + 62, 120, 40, "#7c8fb0", "#5f7090");
    F.drawFloor(g, brW, by, bathW, FH - by, "bath");
    F.drawFloor(g, brW + bathW, by, FW - brW - bathW, FH - by, "lobby");
    F.drawRug(g, FW - 58, by + 22, 36, 10, "#a85a5a", "#844040");
    // Back wall of the building, with its face showing.
    F.wallFace(g, 0, 0, FW, 20);
    F.wallCapH(g, -6, -5, FW + 12);
    // Walls between the top rooms, and their front along the corridor with doors.
    for (const r of Object.values(R)) if (r.x > 0) F.wallCapV(g, r.x - 3, -5, TOPH - 4);
    F.wallFace(g, 0, TOPH - 9, FW, 9);
    F.wallCapH(g, 0, TOPH - 14, FW);
    const plates = { meeting: "MEETING", library: "LIBRARY", server: "SERVERS", boss: "MANAGER" };
    for (const [k, r] of Object.entries(R)) {
      F.doorway(g, r.door, TOPH - 9, 9);
      F.signPlate(g, plates[k], k === "boss" ? r.door + 12 : r.door - 12 - F.textWidth(plates[k]) - 4, TOPH - 9);
    }
    // Left column: phone booths behind a wall with an opening for each, then the planning corner.
    const gaps = [0, 1, 2].map((k) => TOPH + 16 + k * 34 + 18);
    let y = TOPH;
    for (const gy of gaps) { F.wallCapV(g, LEFTW - 6, y, gy - y); y = gy + 14; }
    F.wallCapV(g, LEFTW - 6, y, wbY - 6 - y);
    F.wallCapH(g, 0, wbY - 6, LEFTW);
    F.signPlate(g, "PHONES", 4, TOPH + 3);
    F.signPlate(g, "PLANNING", 4, wbY + 1);
    // Bottom band: the corridor wall shows its face inside the rooms.
    F.wallFace(g, 0, by - 9, FW, 9);
    F.wallCapH(g, 0, by - 14, FW);
    F.wallCapV(g, brW - 3, by - 14, FH - by + 14);
    F.wallCapV(g, brW + bathW - 3, by - 14, FH - by + 14);
    for (const [door, name] of [[P.breakDoor, "KITCHEN"], [P.bathDoor, "WC"], [P.lobbyDoor, "LOBBY"]]) {
      F.doorway(g, door, by - 9, 9);
      F.signPlate(g, name, name === "WC" ? door - 22 : door + 12, by - 9);
    }
    // Outer walls.
    F.wallCapV(g, -6, -5, FH + 10);
    F.wallCapV(g, FW, -5, FH + 10);
    F.wallCapH(g, -6, FH, FW + 12);
    this.terrain = { canvas: c, ox: -pad, oy: -pad, land: { minX: -6, minY: -5, maxX: FW + 6, maxY: FH + 5 } };
  }

  // ------------------------------------------------------------ data

  assignSlots() {
    if (!this.plan) return;
    const tops = [...this.robots.values()].filter((r) => !r.drone).sort((a, b) => a.key.localeCompare(b.key));
    const seatIdx = new Map(), perProject = new Map();
    for (const r of tops) { const i = perProject.get(r.project) || 0; perProject.set(r.project, i + 1); seatIdx.set(r.key, i); }
    this.owners = new Map(tops.map((r) => [this.seat(r, seatIdx.get(r.key), "work").key, r]));
    const counters = new Map();
    const take = (k) => { const i = counters.get(k) || 0; counters.set(k, i + 1); return i; };
    const idle = [], sleepers = [];
    let stagger = 0;
    for (const r of tops) {
      const s = r.session, st = s.status;
      let p = null;
      if (st === "blocked") p = this.place("queue", take("queue"));
      else if (st === "waiting") p = this.seat(r, seatIdx.get(r.key), "hand");
      else if (st === "offline") p = this.place("lobby", take("lobby"));
      else if (st === "sleeping") sleepers.push(r);
      else if (st === "idle") idle.push(r);
      else if (r.station === "forge") p = this.seat(r, seatIdx.get(r.key), "work");
      else if (ROOM_STATIONS.has(r.station)) p = this.place(r.station, take(r.station));
      else p = this.place("meeting", take("meeting"));
      if (!r.place) { r.place = this.place("spawn"); r.x = r.place.x; r.y = r.place.y; r.route = []; r.delay = this.snapNext ? 0 : stagger++ * 0.7; }
      if (r.prevStatus === "working" && st === "waiting") this.spawnFx(r.x, r.y - 12, "#ffd23f");
      r.prevStatus = st;
      if (p) this.setPlace(r, p);
    }
    const used = new Set();
    sleepers.forEach((r, i) => { const k = SOFT[i] ?? `nap${i}`; used.add(k); this.setPlace(r, this.breakSpot(k, true)); });
    const phase = Math.floor(this.t / 45) % PASTIMES.length;
    const order = [...PASTIMES[phase], ...SOFT];
    idle.forEach((r, i) => {
      const k = order.find((x) => !used.has(x)) ?? `idle${i}`;
      used.add(k);
      this.setPlace(r, this.breakSpot(k, false));
    });
    for (const r of this.robots.values()) {
      if (!r.drone || r.init) continue;
      r.init = true;
      const parent = this.robots.get(r.session.parent);
      if (parent) { r.x = parent.x; r.y = parent.y - 20; }
    }
    this.snapNext = false;
  }

  setPlace(r, p) {
    r.target = p;
    r.tx = p.x; r.ty = p.y;
    if (this.snapNext) { r.place = p; r.x = p.x; r.y = p.y; r.route = []; }
  }

  // ------------------------------------------------------------ routing

  /** Shortest path along the corridors (Ct, Cb) and the vertical aisles, between two points on them. */
  gridPath(P, Q) {
    const { vlines, Ct, Cb } = this.plan;
    const nodes = [];
    for (const x of vlines) nodes.push([x, Ct], [x, Cb]);
    const iP = nodes.push(P) - 1, iQ = nodes.push(Q) - 1;
    const adj = nodes.map(() => []);
    const link = (ids, axis) => {
      ids.sort((a, b) => nodes[a][axis] - nodes[b][axis]);
      for (let i = 1; i < ids.length; i++) {
        const a = ids[i - 1], b = ids[i], d = Math.abs(nodes[a][axis] - nodes[b][axis]);
        adj[a].push([b, d]); adj[b].push([a, d]);
      }
    };
    const all = nodes.map((_, i) => i);
    for (const y of [Ct, Cb]) link(all.filter((i) => same(nodes[i][1], y)), 0);
    for (const x of vlines) link(all.filter((i) => same(nodes[i][0], x) && nodes[i][1] >= Ct - 0.6 && nodes[i][1] <= Cb + 0.6), 1);
    const dist = nodes.map(() => Infinity), prev = nodes.map(() => -1), done = new Set();
    dist[iP] = 0;
    while (done.size < nodes.length) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++) if (!done.has(i) && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] === Infinity) break;
      done.add(u);
      if (u === iQ) break;
      for (const [v, d] of adj[u]) if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; prev[v] = u; }
    }
    if (dist[iQ] === Infinity) return [Q];
    const path = [];
    for (let u = iQ; u >= 0; u = prev[u]) path.unshift(nodes[u]);
    return path;
  }

  path(A, B) {
    if (A.room && A.room === B.room) return [{ x: B.x, y: B.y }];
    const out = [...[...A.via].reverse().map(([x, y]) => ({ x, y }))];
    for (const [x, y] of this.gridPath(A.E, B.E)) out.push({ x, y, grid: true });
    for (const [x, y] of B.via) out.push({ x, y });
    out.push({ x: B.x, y: B.y });
    return out;
  }

  // ------------------------------------------------------------ simulation

  update(dt) {
    if (this.cameraTarget) {
      const blend = this.paused ? 1 : 1 - Math.exp(-9 * dt);
      this.cam.x += (this.cameraTarget.x - this.cam.x) * blend;
      this.cam.y += (this.cameraTarget.y - this.cam.y) * blend;
      if (Math.hypot(this.cameraTarget.x - this.cam.x, this.cameraTarget.y - this.cam.y) < 0.1) this.cameraTarget = null;
    }
    const drones = [...this.robots.values()].filter((r) => r.drone).sort((a, b) => a.key.localeCompare(b.key));
    for (const r of this.robots.values()) {
      if (r.drone) { this.droneGoal(r, drones); this.fly(r, dt); continue; }
      if (!r.target) continue;
      if (this.paused) { r.place = r.target; r.x = r.target.x; r.y = r.target.y; r.route = []; r.walking = false; continue; }
      if (r.delay > 0) { r.delay -= dt; continue; }
      if (!r.route.length && r.place.key !== r.target.key) { r.route = this.path(r.place, r.target); r.place = r.target; }
      let budget = SPEED * dt;
      while (budget > 0 && r.route.length) {
        const w = r.route[0];
        const dx = w.x - r.x, dy = w.y - r.y, d = Math.hypot(dx, dy);
        if (d <= budget) {
          r.x = w.x; r.y = w.y; budget -= d; r.route.shift();
          // Changed plans mid-walk: turn around at the next corridor crossing.
          if (w.grid && r.place.key !== r.target.key) {
            const B = r.target;
            r.route = [...this.gridPath([w.x, w.y], B.E).slice(1).map(([x, y]) => ({ x, y, grid: true })), ...B.via.map(([x, y]) => ({ x, y })), { x: B.x, y: B.y }];
            r.place = B;
          }
        } else { r.x += (dx / d) * budget; r.y += (dy / d) * budget; budget = 0; }
      }
      r.walking = r.route.length > 0;
    }
    const P = this.plan;
    if (P && !this.paused) {
      // The robot vacuum patrols the top corridor.
      const span = P.FW - P.Lc - 20;
      this.roomba.x += this.roomba.dir * 14 * dt;
      if (this.roomba.x > span || this.roomba.x < 0) { this.roomba.dir *= -1; this.roomba.x = Math.max(0, Math.min(span, this.roomba.x)); }
    }
    this.fx = this.fx.filter((f) => { f.life -= dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 30 * dt; return f.life > 0; });
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    this.hour = h;
    this.night = h >= 20 || h < 6 ? 1 : h >= 18 ? (h - 18) / 2 : h < 8 ? (8 - h) / 2 : 0;
  }

  /** Sub-agents are drones: they hover where their own work happens, or orbit their parent. */
  droneGoal(r, drones) {
    const s = r.session;
    if (s.status === "working") {
      const peers = drones.filter((d) => d.session.status === "working" && d.station === r.station);
      const k = peers.indexOf(r);
      let base;
      if (r.station === "forge") { const parent = this.robots.get(s.parent); base = parent?.target ? { x: parent.target.x, y: parent.target.y } : null; }
      else if (ROOM_STATIONS.has(r.station)) base = this.place(r.station, k);
      else base = this.place("meeting", 6 + k);
      if (base) { r.tx = base.x + 12 + (k % 3) * 8; r.ty = base.y - 22 + Math.sin(this.t * 2 + r.phase) * 1.5; return; }
    }
    const parent = this.robots.get(s.parent);
    if (!parent) return;
    const kids = drones.filter((d) => d.session.parent === s.parent);
    const a = this.t * 1.2 + (kids.indexOf(r) / Math.max(1, kids.length)) * Math.PI * 2;
    r.tx = parent.x + Math.cos(a) * 13;
    r.ty = parent.y - 20 + Math.sin(a) * 4;
  }

  fly(r, dt) {
    const dx = r.tx - r.x, dy = r.ty - r.y, d = Math.hypot(dx, dy);
    if (this.paused || d < 0.5) { if (this.paused) { r.x = r.tx; r.y = r.ty; } return; }
    const k = Math.min(1, (DRONE_SPEED * dt) / d);
    r.x += dx * k; r.y += dy * k;
  }

  // ------------------------------------------------------------ rendering

  hit(e) {
    const rect = this.canvas.getBoundingClientRect();
    const wx = (e.clientX - rect.left) / this.scale - this.offX;
    const wy = (e.clientY - rect.top) / this.scale - this.offY;
    let best = null, bestD = 1e9;
    for (const r of this.robots.values()) {
      const dx = wx - r.x, dy = wy - (r.drone ? r.y : r.y - 8);
      if (Math.abs(dx) <= (r.drone ? 7 : 8) && Math.abs(dy) <= (r.drone ? 6 : 10)) {
        const dist = dx * dx + dy * dy;
        if (dist < bestD) { best = r.key; bestD = dist; }
      }
    }
    return best;
  }

  arrivedAt(prefix) {
    return [...this.robots.values()].filter((r) => !r.drone && !r.walking && !(r.delay > 0) && r.place?.key.startsWith(prefix) && r.place.key === r.target?.key);
  }

  draw() {
    const g = this.bctx;
    const W = this.buf.width, H = this.buf.height;
    const t = this.t;
    this.offX = Math.round(W / 2 - this.cam.x);
    this.offY = Math.round(H / 2 - this.cam.y);
    const ox = this.offX, oy = this.offY;
    g.fillStyle = "#1e2130";
    g.fillRect(0, 0, W, H);
    if (this.terrain) g.drawImage(this.terrain.canvas, this.terrain.ox + ox, this.terrain.oy + oy);
    const P = this.plan;
    if (!P) return this.blit();
    const R = P.rooms, hour = this.hour ?? 12;

    // Windows, boards and a clock on the back wall.
    const { cx, w } = P.meet;
    const meeting = this.arrivedAt("meet");
    for (const [k, r] of Object.entries(R)) {
      for (let x = r.x + 8; x + 20 < r.x + r.w - 6; x += 30) {
        if (k === "meeting" && x + 20 > cx - 32 && x < cx + 32) continue;
        if (k === "server") continue;
        F.drawWindow(g, x + ox, 3 + oy, 20, 14, t, hour);
      }
    }
    F.drawBoard(g, cx - 28 + ox, 3 + oy, 56, 15, t, meeting.length > 0);
    F.drawClock(g, R.meeting.x + R.meeting.w - 12 + ox, 10 + oy);
    F.drawAC(g, R.server.x + 8 + ox, 5 + oy);
    F.drawPoster(g, R.server.x + R.server.w - 18 + ox, 5 + oy, 1);

    const D = [];
    const add = (y, draw) => D.push({ y, draw });
    const busyAt = (prefix) => this.arrivedAt(prefix).some((r) => r.session.status === "working");
    const queue = [...this.robots.values()].some((r) => r.session.status === "blocked");

    // Meeting room.
    for (let i = 0; i < 6; i++) {
      const s = this.place("meeting", i);
      add(s.y - 1, () => F.drawChair(g, s.x + ox, s.y + oy));
    }
    add(70, () => F.drawMeetingTable(g, cx + ox, 70 + oy, w, t, meeting.length > 0));
    add(TOPH - 16, () => F.drawPlant(g, R.meeting.x + 12 + ox, TOPH - 16 + oy, true));
    add(36, () => F.drawPlant(g, R.meeting.x + R.meeting.w - 14 + ox, 36 + oy, false));
    // Library: shelves along the back wall, a reading corner on the rug.
    const lib = R.library;
    add(48, () => { for (let x = lib.x + 6; x + 24 <= lib.x + lib.w - 4; x += 26) F.drawShelf(g, x + ox, 48 + oy, 24, x); });
    add(82, () => F.drawArmchair(g, lib.x + lib.w - 42 + ox, 82 + oy, "#e8e8ee"));
    add(82, () => F.drawSideTable(g, lib.x + lib.w - 24 + ox, 82 + oy));
    // Server room.
    const srv = R.server, srvBusy = busyAt("srv");
    add(52, () => { let k = 0; for (let x = srv.x + 6; x + 18 <= srv.x + srv.w - 4; x += 22) F.drawRack(g, x + ox, 52 + oy, t, srvBusy, k++); });
    add(84, () => F.drawConsole(g, srv.x + srv.w - 22 + ox, 84 + oy, t, srvBusy));
    // Manager's office: your empty chair.
    const boss = R.boss;
    add(64, () => F.drawBossDesk(g, boss.x + Math.round(boss.w / 2) + 10 + ox, 64 + oy, t, queue));
    add(48, () => F.drawShelf(g, boss.x + 8 + ox, 48 + oy, 24, 3));
    add(TOPH - 16, () => F.drawPlant(g, boss.x + boss.w - 12 + ox, TOPH - 16 + oy, true));
    add(TOPH, () => F.drawDoorLight(g, boss.door - 12 + ox, TOPH - 4 + oy, t, queue));
    // Phone booths.
    const boothBusy = new Set(this.arrivedAt("booth").filter((r) => r.session.status === "working").map((r) => Number(r.place.key.slice(5)) % 3));
    for (let k = 0; k < 3; k++) {
      const y0 = TOPH + 16 + k * 34;
      add(y0, () => F.drawBooth(g, 6 + ox, y0 + oy, LEFTW - 20, 30, t, boothBusy.has(k)));
      add(y0 + 31, () => F.drawBoothFront(g, 6 + ox, y0 + 30 + oy, LEFTW - 20));
    }
    // Planning corner.
    add(P.wbY + 40, () => F.drawWhiteboard(g, 8 + ox, P.wbY + 40 + oy, LEFTW - 24, t, busyAt("plan")));
    add(P.Cb + 6, () => F.drawPlant(g, 12 + ox, P.Cb + 6 + oy, true));
    // Team pods: a partition behind each row of three desks, a chair behind every seat.
    for (const d of this.projects.values()) {
      for (let row = 0; row < 2; row++) {
        const py = d.pod.y + SEAT_Y[row] - 10;
        add(py, () => F.drawPartition(g, d.pod.x + ox, py + oy, POD_W - 4, d.soft));
      }
      for (let i = 0; i < 6; i++) {
        const row = Math.floor(i / 3), col = i % 3;
        const x = d.pod.x + SEAT_X[col], y = d.pod.y + SEAT_Y[row];
        const key = `seat:${d.name}:${i}`;
        const owner = this.owners?.get(key);
        const here = owner && !owner.walking && owner.place?.key === key && owner.target?.key === key;
        const mode = !owner ? "off" : here && owner.session.status === "working" ? "code" : here && owner.session.status === "waiting" ? "done" : "sleep";
        add(y - 1, () => F.drawChair(g, x + ox, y + oy));
        add(y + 1, () => F.drawDesk(g, x + ox, y + oy, t, mode, i + d.index * 7));
      }
      add(d.pod.y + POD_H + 4, () => F.drawPlant(g, d.pod.x + POD_W - 2 + ox, d.pod.y + POD_H + 4 + oy, false));
    }
    // Kitchen and lounge.
    const by = P.by, brW = P.brW;
    const at = (k) => this.arrivedAt(`break-${k}`).length > 0;
    add(by + 16, () => {
      F.drawCounter(g, 22 + ox, by + 16 + oy, 108);
      F.drawCoffee(g, 44 + ox, by + 16 + oy, t, at("coffee"));
      F.drawMicrowave(g, 74 + ox, by + 16 + oy);
      F.drawSink(g, 104 + ox, by + 16 + oy);
    });
    add(by + 20, () => F.drawFridge(g, 12 + ox, by + 20 + oy));
    add(by + 18, () => F.drawCooler(g, 142 + ox, by + 18 + oy, t));
    add(by + 36, () => F.drawVending(g, brW - 16 + ox, by + 36 + oy, t));
    add(by + 86, () => F.drawCouch(g, 16 + ox, by + 94 + oy, 60, "#8e9ab0"));
    add(by + 87, () => F.drawArmchair(g, 96 + ox, by + 95 + oy, "#c9a0a0"));
    add(by + 87, () => F.drawArmchair(g, 116 + ox, by + 95 + oy, "#c9a0a0"));
    add(by + 70, () => F.drawPingPong(g, brW - 100 + ox, by + 70 + oy, 52, t, at("pp0") && at("pp1")));
    add(P.FH - 4, () => F.drawPlant(g, brW - 14 + ox, P.FH - 4 + oy, true));
    // Restroom (nobody needs it, but every office has one).
    const bx = brW + 4;
    add(by + 30, () => { for (let k = 0; k < 2; k++) { F.drawStall(g, bx + k * 26 + ox, by + 32 + oy, 24); F.drawToilet(g, bx + 13 + k * 26 + ox, by + 26 + oy); } });
    add(P.FH - 10, () => F.drawWashbasin(g, bx + 14 + ox, P.FH - 10 + oy));
    // Lobby.
    const lx = brW + P.bathW;
    const arriving = [...this.robots.values()].some((r) => !r.drone && (r.delay > 0 || (r.place?.key === "spawn" && Math.hypot(r.x - (P.FW - 40), r.y - (by + 28)) < 20)));
    add(by + 18, () => F.drawElevator(g, P.FW - 40 + ox, by + 18 + oy, t, arriving));
    add(by + 66, () => F.drawReception(g, lx + Math.round((P.FW - lx) / 2) - 14 + ox, by + 66 + oy));
    add(by + 40, () => { F.drawArmchair(g, lx + 52 + ox, by + 40 + oy, "#8e9ab0"); F.drawArmchair(g, lx + 72 + ox, by + 40 + oy, "#8e9ab0"); });
    add(by + 20, () => F.drawPlant(g, lx + 92 + ox, by + 20 + oy, true));
    add(P.FH - 4, () => F.drawPlant(g, P.FW - 10 + ox, P.FH - 4 + oy, true));
    add(by + 20, () => F.drawStorage(g, P.FW - 92 + ox, by + 20 + oy, 26, 2));
    add(by + 30, () => F.drawBoxes(g, P.FW - 64 + ox, by + 30 + oy));
    add(P.Ct + 30, () => F.drawPrinter(g, P.Lc + 2 + ox, P.Ct - 2 + oy, t, busyAt("plan")));
    // Robots and drones.
    const speaker = meeting.length ? meeting.sort((a, b) => a.key.localeCompare(b.key))[Math.floor(t / 2.5) % meeting.length] : null;
    for (const r of this.robots.values()) {
      if (r.drone) add(r.y + 200, () => this.drawDrone(g, r, ox, oy));
      else if (!(r.delay > 0)) add(r.y + (r.place?.over && !r.walking ? 10 : 0), () => this.drawPerson(g, r, ox, oy, r === speaker));
    }
    add(P.Ct + 2, () => F.drawRoomba(g, P.Lc + 10 + this.roomba.x + ox, P.Ct + 2 + oy, t));
    D.sort((a, b) => a.y - b.y);
    for (const d of D) d.draw();
    for (const f of this.fx) px(g, f.x + ox, f.y + oy, 1, 1, f.color);
    if (this.night > 0) { g.fillStyle = `rgba(14,12,50,${0.16 * this.night})`; g.fillRect(0, 0, W, H); }
    this.blit();
  }

  blit() {
    const ctx = this.ctx, s = this.scale * this.dpr;
    ctx.imageSmoothingEnabled = s < 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.buf, 0, 0, this.buf.width * s, this.buf.height * s);
    this.drawLabels(ctx, s, this.offX, this.offY);
  }

  drawPerson(g, r, ox, oy, speaking) {
    const s = r.session, st = s.status, t = this.t + r.phase;
    const m = providerMeta(s.provider);
    const x = Math.round(r.x + ox), y = Math.round(r.y + oy);
    const arrived = !r.walking && r.place?.key === r.target?.key;
    const pose = arrived ? r.place.pose : "walk";
    const hover = !!m.hover;
    const seated = ["sit", "work", "hand", "sleep"].includes(pose) && (r.place.desk || r.place.room === "meeting" || r.place.over) && !hover;
    const step = Math.floor(t * 7) % 2;
    const legs = hover ? (step ? "hover" : "hover2") : seated ? "sit" : r.walking && step ? "step" : "stand";
    const blink = (t % 4) < 0.12;
    const eyes = st === "offline" ? "off" : st === "sleeping" || pose === "sleep" || blink ? "closed" : "open";
    const working = st === "working";
    const arms = pose === "hand" ? true : (pose === "work" || pose === "board") && working ? Math.floor(t * 4) % 2 === 0 : false;
    const sprite = robotSprite({ provider: s.provider, legs, arms, eyes, chest: STATUS[st]?.color || "#46e07a", gray: st === "offline" });
    const lift = hover ? 3 : seated ? -2 : 0;
    const bob = r.walking ? (step ? -1 : 0) : hover ? Math.round(Math.sin(t * 3)) : 0;
    if (!seated) px(g, x - 5, y - 1, 11, 2, "rgba(0,0,0,0.25)");
    if (this.selected === r.key) {
      const c = Math.floor(this.t * 4) % 2 ? "#ffffff" : "#ffd23f";
      const ay = y - 30 - lift + Math.round(Math.sin(this.t * 6) * 1.5);
      px(g, x - 2, ay, 5, 1, c); px(g, x - 1, ay + 1, 3, 1, c); px(g, x, ay + 2, 1, 1, c);
    }
    g.drawImage(sprite, x - 6, y - 16 + bob - lift);
    // Props: a form to sign, a phone, a coffee cup.
    const hy = y - 9 + bob - lift;
    if (pose === "paper") { obox(g, x + 5, hy - 2, 5, 6, "#ffffff"); px(g, x + 6, hy, 3, 1, "#9aa0b4"); px(g, x + 6, hy + 2, 2, 1, "#9aa0b4"); }
    if (pose === "phone" && working) { px(g, x + 4, hy - 5, 2, 5, OUT); }
    if (pose === "coffee") { obox(g, x + 5, hy - 1, 4, 4, "#f2ead6"); if (Math.floor(t * 2) % 2) px(g, x + 6, hy - 3, 1, 1, "#e8e8f0"); }
    if (arrived && working && ["library", "server", "planning"].includes(r.place.room)) {
      drawToolFx(g, r.place.room === "server" ? "terminal" : r.place.room === "planning" ? "tasks" : "library", x + 7, y - 8 + bob - lift, t);
    }
    // Bubbles.
    const bx = x + 3, byy = y - 18 - lift;
    const cur = s.current, fresh = cur && Date.now() - cur.ts < 20000;
    if (st === "blocked") drawBubble(g, "block", bx, byy, t);
    else if (st === "waiting") drawBubble(g, "wait", bx, byy, t);
    else if (st === "sleeping") drawBubble(g, "sleep", x + 2, y - 14 - lift, t);
    else if (working && fresh && cur.kind === "error") drawBubble(g, "error", bx, byy, t);
    else if (working && arrived && r.place.room === "meeting") drawBubble(g, speaking ? "user" : "think", bx, byy, t, m.body);
    else if (st === "idle" && arrived && ["cooler0", "cooler1"].some((k) => r.place.key === `break-${k}`) && Math.floor(t / 3) % 2) drawBubble(g, "user", bx, byy, t);
  }

  drawDrone(g, r, ox, oy) {
    const s = r.session, st = s.status, t = this.t + r.phase;
    const working = st === "working";
    const x = Math.round(r.x + ox), y = Math.round(r.y + oy);
    const bob = Math.round(Math.sin(t * (working ? 7 : 4)));
    const sprite = droneSprite({
      provider: s.provider, rotor: st === "offline" ? 0 : Math.floor(t * (working ? 16 : 8)) % 2,
      eyes: st === "offline" ? "off" : st === "sleeping" ? "closed" : "open", chest: STATUS[st]?.color || "#46e07a", gray: st === "offline",
    });
    if (this.selected === r.key) {
      const c = Math.floor(this.t * 4) % 2 ? "#ffffff" : "#ffd23f";
      const ay = y - 16 + Math.round(Math.sin(this.t * 6) * 1.5);
      px(g, x - 2, ay, 5, 1, c); px(g, x - 1, ay + 1, 3, 1, c); px(g, x, ay + 2, 1, 1, c);
    }
    g.drawImage(sprite, x - 5, y - 5 + bob);
    if (working && ROOM_STATIONS.has(r.station)) drawToolFx(g, r.station, x + 7, y + 1 + bob, t);
    else if (working) drawBubble(g, "think", x + 1, y - 7 + bob, t, providerMeta(s.provider).body);
  }

  drawLabels(ctx, s, ox, oy) {
    const fontPx = Math.min(12 * this.dpr, Math.max(7 * this.dpr, Math.round(3.4 * s)));
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fontPx}px "Press Start 2P", monospace`;
    // A hanging team sign over every pod.
    for (const d of this.projects.values()) {
      const sx = (d.pod.x + POD_W / 2 - 2 + ox) * s, sy = (d.pod.y - 7 + oy) * s;
      const full = (d.label || d.name).toUpperCase();
      let label = full.slice(0, 24);
      while (label.length > 3 && ctx.measureText(label).width + fontPx * 1.4 > (POD_W - 10) * s) label = label.slice(0, -1);
      if (label.length < full.length) label = label.slice(0, -1) + "…";
      const w = ctx.measureText(label).width + fontPx * 1.4, h = fontPx * 2.2;
      ctx.fillStyle = OUT;
      ctx.fillRect(Math.round(sx - w / 2 - s), Math.round(sy - h / 2 - s), Math.round(w + 2 * s), Math.round(h + 2 * s));
      // A white team plate with a stripe in the team colour.
      ctx.fillStyle = "#f6f6f8";
      ctx.fillRect(Math.round(sx - w / 2), Math.round(sy - h / 2), Math.round(w), Math.round(h));
      ctx.fillStyle = d.color;
      ctx.fillRect(Math.round(sx - w / 2), Math.round(sy + h / 2 - 2 * s), Math.round(w), Math.round(2 * s));
      ctx.fillStyle = "#3b3d4c";
      ctx.fillText(label, sx, sy);
    }
    const tagFont = Math.min(11, Math.max(8, Math.round(3.2 * s)));
    ctx.font = `${tagFont}px "Press Start 2P", monospace`;
    for (const key of new Set([this.hovered, this.selected])) {
      const r = key && this.robots.get(key);
      if (!r) continue;
      const m = providerMeta(r.session.provider);
      const sx = (r.x + ox) * s, sy = (r.y + oy - (r.drone ? 18 : 32)) * s - tagFont;
      const text = `${r.drone ? "SUB-AGENT" : m.short} · ${r.session.title}`.slice(0, 42);
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
