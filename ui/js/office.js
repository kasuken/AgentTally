// One shared office. Every project is a team pod of desks,
// every session is a robot employee. Thinking agents meet in the meeting room, readers go to the
// library, runners to the server room, web/MCP calls happen in the phone booths, planning at the
// kanban board. Approvals queue at the manager's door (you), idle agents take a break.
// Camera, pan/zoom, selection and the frame loop are inherited from World.

import { World } from "./world.js";
import { px, drawBubble, drawToolFx } from "./sprites.js";
import { crewSprite } from "./crew-art.js";
import { providerMeta, stationFor, STATUS } from "./meta.js";
import * as F from "./office-sprites.js";

const { OUT, obox, pixelText } = F;
const LEFTW = 70, AISLE = 18, POD_W = 84, ROWGAP = 16, TOPH = 100, BOTH = 96, MIN_FW = 508;
const SEATS_PER_ROW = 2, SEAT_Y = 28, DESK_PITCH = 42, BOOTHS = 2;
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

function workstation(pod, team, i) {
  const row = Math.floor(i / SEATS_PER_ROW), right = i % 2;
  const y = pod.y + SEAT_Y + row * DESK_PITCH;
  if ((team + row) % 2 === 0) {
    return { row, facing: right ? "west" : "east", x: pod.x + (right ? 70 : 14), y,
      surfaceX: pod.x + (right ? 54 : 30), surfaceY: y, approachY: y - 18 };
  }
  const x = pod.x + (right ? 60 : 24);
  return { row, facing: right ? "north" : "south", x, y: y + (right ? 12 : -8),
    surfaceX: x, surfaceY: y + (right ? -2 : 1), approachY: y + (right ? 17 : -18) };
}

const DUTIES = {
  desk: ["Team desks", "work"], hand: ["Team desks", "hand"], queue: ["Review desk", "paper"],
  meeting: ["Meeting room", "sit"], library: ["Library", "work"], terminal: ["Server room", "work"],
  radar: ["Call booth", "phone"], tasks: ["Planning wall", "board"], idle: ["Lounge", "stand"],
  sleeping: ["Lounge", "sleep"], lobby: ["Lobby", "gone"],
};
export function officeDuty(s) {
  const byStatus = { waiting: "hand", blocked: "queue", offline: "lobby", sleeping: "sleeping", idle: "idle" };
  const station = stationFor(s);
  const kind = byStatus[s.status] || (station === "forge" ? "desk" : ROOM_STATIONS.has(station) ? station : "meeting");
  return { kind, label: DUTIES[kind][0], pose: DUTIES[kind][1] };
}

export class Office extends World {
  constructor(canvas, opts) {
    super(canvas, opts);
    this.roomba = { x: 0, dir: 1 };
    const tile = document.createElement("canvas");
    tile.width = tile.height = 12;
    const g = tile.getContext("2d");
    px(g,0,0,12,12,"#1b3036"); px(g,0,0,1,1,"#364a4d");
    this.backdrop = this.bctx.createPattern(tile, "repeat");
  }

  // ------------------------------------------------------------ floor plan

  setSessions(sessions) {
    const counts = new Map();
    for (const s of sessions) {
      const project = s.cwd || s.project;
      counts.set(project, (counts.get(project) || 0) + (s.parent ? 0 : 1));
    }
    const prev = this.staff;
    this.staff = counts;
    // World rebuilds on project changes; a growing team can also need a longer desk bank.
    if (prev && counts.size === prev.size && [...counts.keys()].every(k => prev.has(k)) &&
        [...counts].some(([k,n]) => this.deskRows(n) !== this.deskRows(prev.get(k)))) this.layout();
    super.setSessions(sessions);
  }

  deskRows(n) { return Math.max(1, Math.ceil(n / SEATS_PER_ROW)); }

  layout() {
    const n = Math.max(1, this.projectOrder.length);
    const aspect = Math.max(0.5, Math.min(3, (this.cw || 1200) / (this.ch || 700)));
    const cols = Math.max(1, Math.min(n, Math.max(4, Math.ceil(Math.sqrt(n * aspect * .7)))));
    const rows = Math.ceil(n / cols);
    const Lc = LEFTW + AISLE / 2;
    const vlines = Array.from({ length: cols + 1 }, (_, c) => Lc + c * (POD_W + AISLE));
    const FW = Math.max(MIN_FW, vlines[cols] + AISLE / 2 + 8);
    const Ct = TOPH + 12;
    const rowY = [];
    let y = Ct + 13;
    for (let r = 0; r < rows; r++) {
      rowY.push(y);
      const teams = this.projectOrder.slice(r * cols, (r + 1) * cols);
      y += Math.max(1, ...teams.map(k => this.deskRows(this.staff.get(k)))) * DESK_PITCH + ROWGAP;
    }
    const wbY = TOPH + 16 + BOOTHS * 30;
    const Cb = Math.max(y + 6, wbY + 63);
    const by = Cb + 26, FH = by + BOTH;
    const mw = Math.round(FW * 0.34), lw = Math.round(FW * 0.24), sw = Math.round(FW * 0.19);
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
      const pod = { x: LEFTW + AISLE + (i % cols) * (POD_W + AISLE), y: rowY[Math.floor(i / cols)], aisle: vlines[i % cols], rows: this.deskRows(this.staff.get(name)) };
      const spawn = [FW - 40, by + 28];
      const desks = Array.from({length: pod.rows * SEATS_PER_ROW}, (_,seat) => workstation(pod,i,seat));
      this.projects.set(name, { name, index: i, pod, desks, color: TEAM[i % TEAM.length], stations: { hub: spawn, dock: spawn }, shore: [] });
    });
    // Opening the monitor shows a shift already in progress, not everyone at the lift.
    this.snapNext = true;
    this.renderTerrain();
    if (!this.userPan) this.fit();
  }

  fit() {
    if (!this.plan || !this.cw || !this.ch) return;
    const { FW, FH } = this.plan;
    const foot = 37;
    this.scale = Math.max(.1, Math.min(5, (this.cw - 22) / (FW + 12), (this.ch - foot - 10) / (FH + 10)));
    this.cam = {x: FW / 2, y: FH / 2 + (foot - 10) / (2 * this.scale)};
    this.cameraTarget = null; this.dirty = true; this.sizeBuffer();
  }

  sizeBuffer() {
    // Keep the room coordinates in world units. Only close-ups / high-DPI displays
    // need the extra backing pixels for faceplates, controls and fabric stitching.
    this.density = this.scale * this.dpr >= 1.5 ? 2 : 1;
    this.buf.width = Math.ceil(this.cw / this.scale) * this.density;
    this.buf.height = Math.ceil(this.ch / this.scale) * this.density;
    this.bctx.setTransform(this.density, 0, 0, this.density, 0, 0);
    this.bctx.imageSmoothingEnabled = false;
  }

  visit(room) {
    this.stopCinema();
    const p = this.plan;
    if (!p) return;
    const to = {
      meeting: [p.rooms.meeting.w / 2, 51, p.rooms.meeting.w + 22, TOPH + 25],
      desk: [p.Lc + POD_W + AISLE, p.Ct + 56, Math.min(260, p.FW - p.Lc), 126],
      break: [p.brW / 2, p.by + BOTH / 2, p.brW + 12, BOTH + 26],
      queue: [p.rooms.boss.x + p.rooms.boss.w / 2, 62, p.rooms.boss.w + 45, TOPH + 44],
    }[room];
    this.scale = Math.max(.1, Math.min(5, this.cw / to[2], (this.ch - 35) / to[3]));
    this.cam = {x: to[0], y: to[1] + 12 / this.scale};
    this.userZoom = this.userPan = true;
    this.cameraTarget = null; this.dirty = true; this.sizeBuffer();
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
        const near = i % 2 === 1;
        const x = Math.round(cx + (i < 2 ? -1 : 1) * w * .25);
        const aisle = near ? 81 : 36;
        return this.spot(`meet${i}`, "meeting", x, near ? 78 : 48, E,
          [...topVia(m), [m.door, aisle], [x, aisle]], { pose: "sit", facing: near ? "north" : "south" });
      }
      if (i === 4 || i === 5) {
        const x = Math.round(cx + (i === 4 ? -1 : 1)*(w/2+7));
        return this.spot(`meet${i}`, "meeting", x, 61, E, [...topVia(m),[x,TOPH-8]], { pose:"sit", facing:i === 4 ? "east" : "west" });
      }
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
      const k = i % BOOTHS, y0 = TOPH + 16 + k * 30;
      return this.spot(`booth${i}`, `booth:${k}`, 18 + (Math.floor(i / BOOTHS) % 3) * 14, y0 + 23, [P.Lc, y0 + 23], [[LEFTW - 6, y0 + 23]], { pose: "phone" });
    }
    if (kind === "tasks") {
      return this.spot(`plan${i}`, "planning", 12 + (i % 4) * 14, P.wbY + 52 + (Math.floor(i / 4) % 2) * 6, [P.Lc, P.wbY + 52], [[LEFTW - 6, P.wbY + 52]], { pose: "board" });
    }
    if (kind === "lobby") {
      return this.spot(`lobby${i}`, "lobby", P.FW - 26 - (i % 8) * 14, P.FH - 12 - (Math.floor(i / 8) % 2) * 10, [P.lobbyDoor, P.Cb], [[P.lobbyDoor, P.by + 10]], { pose: "gone" });
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
    const {row,x,y,approachY,facing} = d.desks[i];
    return this.spot(`seat:${r.project}:${i}`, `pod:${r.project}:${row}`, x, y,
      [d.pod.aisle, approachY], [[x, approachY]], { pose, desk:true, facing });
  }

  renderTerrain() {
    const P = this.plan, { FW, FH, by, rooms: R, brW, bathW, wbY } = P;
    const pad = 40;
    const c = document.createElement("canvas");
    c.width = FW + pad * 2; c.height = FH + pad * 2;
    const g = c.getContext("2d");
    g.translate(pad, pad);
    px(g, -4, 0, FW + 16, FH + 12, "#151620");
    // Floors: light tiles everywhere, then each room's own floor.
    F.drawFloor(g, 0, 0, FW, FH, "studio");
    const roomFloor = { meeting: "tile", library: "wood", server: "server", boss: "wood" };
    for (const [k, r] of Object.entries(R)) F.drawFloor(g, r.x, 20, r.w, TOPH - 34, roomFloor[k]);
    F.drawRug(g, R.library.x + R.library.w - 58, 64, 50, 22, "#5a7ab0", "#3f5a88");
    F.drawRug(g, R.boss.x + 14, 40, R.boss.w - 28, 40, "#76989a", "#486c77");
    F.drawRug(g, 16, 37, R.meeting.w - 44, 45, "#a5b2b1", "#829294");
    F.drawFloor(g, 0, TOPH, LEFTW - 6, wbY - TOPH - 6, "dark");
    F.drawFloor(g, 0, by, brW, FH - by, "kitchen");
    F.drawRug(g, 8, by + 64, 120, 30, "#d79e92", "#ad716f");
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
    const plates = { meeting: "MEETING", library: "LIBRARY", server: "SERVERS", boss: "REVIEW" };
    for (const [k, r] of Object.entries(R)) {
      F.doorway(g, r.door, TOPH - 9, 9);
      F.signPlate(g, plates[k], k === "boss" ? r.door + 12 : r.door - 12 - F.textWidth(plates[k]) - 4, TOPH - 9);
    }
    // Left column: phone booths behind a wall with an opening for each, then the planning corner.
    const gaps = Array.from({ length: BOOTHS }, (_,k) => TOPH + 16 + k * 30 + 12);
    let y = TOPH;
    for (const gy of gaps) { F.wallCapV(g, LEFTW - 6, y, gy - y); y = gy + 14; }
    F.wallCapV(g, LEFTW - 6, y, wbY - 6 - y);
    F.wallCapH(g, 0, wbY - 6, LEFTW);
    F.signPlate(g, "CALLS", 4, TOPH + 3);
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
      const duty = officeDuty(s);
      if (duty.kind === "hand" || duty.kind === "desk") p = this.seat(r, seatIdx.get(r.key), duty.pose);
      else if (duty.kind === "sleeping") sleepers.push(r);
      else if (duty.kind === "idle") idle.push(r);
      else p = this.place(duty.kind, take(duty.kind));
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
      if (!r.drone || (r.init && !this.snapNext)) continue;
      r.init = true;
      const parent = this.robots.get(r.session.parent);
      if (parent) { r.x = parent.x; r.y = parent.y - 20; }
      else { const seat = this.seat(r, 0, "work"); r.x = seat.x; r.y = seat.y - 20; }
      r.tx = r.x; r.ty = r.y;
    }
    this.snapNext = false;
  }

  setPlace(r, p) {
    r.target = p;
    r.tx = p.x; r.ty = p.y;
    if (this.snapNext) { r.place = p; r.x = p.x; r.y = p.y; r.route = []; r.walking = false; r.delay = 0; }
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
      if (!r.route.length) {
        if (r.place.key !== r.target.key) r.route = this.path(r.place, r.target);
        r.place = r.target; // Same desk, different pose (e.g. typing -> hand raised).
      }
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
      if (r.station === "forge") base = this.seat(r, 0, "work");
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
    const W = this.buf.width / this.density, H = this.buf.height / this.density;
    const t = this.t;
    this.offX = Math.round(W / 2 - this.cam.x);
    this.offY = Math.round(H / 2 - this.cam.y);
    const ox = this.offX, oy = this.offY;
    g.save();
    g.translate(ox, oy);
    g.fillStyle = this.backdrop;
    g.fillRect(-ox, -oy, W, H);
    g.restore();
    if (this.terrain) g.drawImage(this.terrain.canvas, this.terrain.ox + ox, this.terrain.oy + oy);
    const P = this.plan;
    if (!P) return this.blit();
    const R = P.rooms, hour = this.hour ?? 12;

    // Windows, boards and a clock on the back wall.
    const { cx, w } = P.meet;
    const meeting = this.arrivedAt("meet");
    F.drawWindow(g, R.meeting.x + 6 + ox, 2 + oy, Math.max(22, cx-40), 17, t, hour);
    F.drawWindow(g, cx + 34 + ox, 2 + oy, R.meeting.w - cx - 57, 17, t, hour);
    F.drawWindow(g, R.library.x + 10 + ox, 2 + oy, R.library.w - 20, 17, t, hour);
    F.drawWindow(g, R.boss.x + 12 + ox, 2 + oy, R.boss.w - 28, 17, t, hour);
    F.drawBoard(g, cx - 28 + ox, 3 + oy, 56, 15, t, meeting.length > 0);
    F.drawClock(g, R.meeting.x + R.meeting.w - 12 + ox, 10 + oy);
    F.drawAC(g, R.server.x + 8 + ox, 5 + oy);
    F.drawPoster(g, R.server.x + R.server.w - 18 + ox, 5 + oy, 1);

    const D = [];
    const add = (y, draw) => D.push({ y, draw });
    const chair = ({x,y,facing}) => {
      add(y-1, () => F.drawChair(g,x+ox,y+oy,facing));
      if (facing === "north") add(y+1, () => F.drawChairBack(g,x+ox,y+oy,facing));
    };
    const busyAt = (prefix) => this.arrivedAt(prefix).some((r) => r.session.status === "working");
    const queue = [...this.robots.values()].some((r) => r.session.status === "blocked");

    // Meeting room.
    F.drawSunlight(g, 6 + ox, 20 + oy, Math.max(22,cx-40), this.night);
    F.drawSunlight(g, R.boss.x + 16 + ox, 20 + oy, 30, this.night);
    for (let i = 0; i < 6; i++) chair(this.place("meeting", i));
    add(70, () => F.drawMeetingTable(g, cx + ox, 70 + oy, w, meeting.length > 0));
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
    const boothBusy = new Set(this.arrivedAt("booth").map((r) => Number(r.place.key.slice(5)) % BOOTHS));
    for (let k = 0; k < BOOTHS; k++) {
      const y0 = TOPH + 16 + k * 30;
      add(y0, () => F.drawBooth(g, 6 + ox, y0 + oy, LEFTW - 20, 27, t, boothBusy.has(k)));
      add(y0 + 28, () => F.drawBoothFront(g, 6 + ox, y0 + 27 + oy, LEFTW - 20));
    }
    // Planning corner.
    add(P.wbY + 48, () => F.drawWhiteboard(g, 8 + ox, P.wbY + 48 + oy, LEFTW - 24, t, busyAt("plan")));
    add(P.Cb + 6, () => F.drawPlant(g, 12 + ox, P.Cb + 6 + oy, true));
    for (const d of this.projects.values()) {
      for (const [i,desk] of d.desks.entries()) {
        const key = `seat:${d.name}:${i}`;
        const owner = this.owners?.get(key);
        const here = owner && !owner.walking && owner.place?.key === key && owner.target?.key === key;
        const mode = !owner ? "off" : here && owner.session.status === "working" ? "code" : here && owner.session.status === "waiting" ? "done" : "sleep";
        chair(desk);
        add(desk.surfaceY+7, () => F.drawDesk(g,desk.surfaceX+ox,desk.surfaceY+oy,desk.facing,t,mode,i+d.index));
      }
    }
    // A quiet reading nook uses the last unoccupied bay rather than another empty desk.
    const last = this.projects.get(this.projectOrder.at(-1));
    if (last && last.pod.x + 2 * POD_W + AISLE < P.FW) {
      const x = last.pod.x + POD_W + AISLE + 5, y = last.pod.y + SEAT_Y;
      F.drawRug(g,x+ox,y-14+oy,72,28,"#a7b3a8","#7f9291");
      add(y+4, () => F.drawCouch(g,x+5+ox,y+4+oy,37,"#71998d"));
      add(y+6, () => F.drawSideTable(g,x+55+ox,y+6+oy));
      add(y-5, () => F.drawPlant(g,x+67+ox,y-5+oy,true));
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
    ctx.imageSmoothingEnabled = s < this.density;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.buf, 0, 0, this.buf.width * s / this.density, this.buf.height * s / this.density);
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
    const arms = pose === "hand" || speaking || ((pose === "work" || pose === "board") && working && Math.floor(t * 4) % 2 === 0);
    const sprite = crewSprite({ provider: s.provider, legs, arms, eyes, facing: arrived ? r.place.facing : undefined, chest: STATUS[st]?.color, gray: st === "offline" });
    // Seats behind the conference table must show shoulders and a gesturing hand above its rim.
    const lift = hover ? 3 : seated ? 1 : 0;
    const bob = r.walking ? (step ? -1 : 0) : hover ? Math.round(Math.sin(t * 3)) : 0;
    if (!seated) px(g, x - 5, y - 1, 11, 2, "rgba(0,0,0,0.25)");
    if (this.selected === r.key) {
      const c = Math.floor(this.t * 4) % 2 ? "#ffffff" : "#ffd23f";
      const ay = y - 30 - lift + Math.round(Math.sin(this.t * 6) * 1.5);
      px(g, x - 2, ay, 5, 1, c); px(g, x - 1, ay + 1, 3, 1, c); px(g, x, ay + 2, 1, 1, c);
    }
    g.drawImage(sprite, x - 8, y - 18 + bob - lift, 16, 18);
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
    const sprite = crewSprite({
      provider: s.provider, drone: true, rotor: st === "offline" ? 0 : Math.floor(t * (working ? 16 : 8)) % 2,
      eyes: st === "offline" ? "off" : st === "sleeping" ? "closed" : "open", chest: STATUS[st]?.color || "#46e07a", gray: st === "offline",
    });
    if (this.selected === r.key) {
      const c = Math.floor(this.t * 4) % 2 ? "#ffffff" : "#ffd23f";
      const ay = y - 16 + Math.round(Math.sin(this.t * 6) * 1.5);
      px(g, x - 2, ay, 5, 1, c); px(g, x - 1, ay + 1, 3, 1, c); px(g, x, ay + 2, 1, 1, c);
    }
    g.drawImage(sprite, x - 8, y - 9 + bob, 16, 18);
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
      const sx = (d.pod.x + POD_W / 2 + ox) * s, sy = (d.pod.y + 2 + oy) * s;
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
