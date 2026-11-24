import { projectKey, timelineTicks, TIMELINE_MS } from "./board.js";
import { providerMeta, sessionAction } from "./meta.js";
import { needsAttention, sortSessions } from "./selectors.js";

const MINUTES = TIMELINE_MS / 60000;
const $ = (id) => document.getElementById(id);
const write = (el, value) => { if (el.textContent !== value) el.textContent = value; };

export function projectSignals(sessions, at) {
  const projects = new Map();
  for (const s of sessions) {
    const key = projectKey(s);
    if (!projects.has(key)) projects.set(key, { key, name: s.project, bins: Array(MINUTES).fill(0), waits: new Set(), total: 0 });
    const lane = projects.get(key);
    for (const { event } of timelineTicks(s.events, at)) {
      const minute = Math.min(MINUTES - 1, Math.floor((event.ts - (at - TIMELINE_MS)) / 60000));
      lane.bins[minute]++;
      if (event.kind === "wait") lane.waits.add(minute);
      lane.total++;
    }
  }
  return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

export function priorityQueue(sessions) {
  const queue = sortSessions(sessions.filter(needsAttention));
  return queue.length ? queue : sortSessions(sessions.filter((s) => s.status === "working"));
}

export class SignalDeck {
  constructor(onInspect, onProject) {
    this.lanes = new Map();
    $("priority-list").onclick = (e) => {
      const row = e.target.closest("button[data-key]");
      if (row) onInspect(row.dataset.key, row);
    };
    $("signal-lanes").onclick = (e) => {
      const row = e.target.closest("button[data-project]");
      if (row) onProject(row.dataset.project === this.project ? "" : row.dataset.project);
    };
  }

  render({ sessions, mapSessions, at, project, connected, hasSnapshot, filtered }) {
    this.project = project;
    this.connected = connected;
    this.hasSnapshot = hasSnapshot;
    this.renderPriority(connected && hasSnapshot ? priorityQueue(sessions) : [], filtered);
    this.renderMap(projectSignals(mapSessions, at));
  }

  renderPriority(queue, filtered) {
    const list = $("priority-list");
    const existing = new Map([...list.children].map((b) => [b.dataset.key, b]));
    const active = document.activeElement;
    write($("priority-title"), queue[0]?.status === "working" ? "In progress" : "Needs you");
    write($("priority-count"), queue.length ? `${queue.length} session${queue.length === 1 ? "" : "s"}` : "");
    for (const [i, s] of queue.entries()) {
      let row = existing.get(s.key);
      existing.delete(s.key);
      if (!row) {
        row = document.createElement("button");
        row.type = "button";
        row.dataset.key = s.key;
        row.setAttribute("aria-controls", "detail");
        row.innerHTML = '<span class="queue-type"></span><span class="queue-copy"><strong></strong><small></small></span><span class="queue-go" aria-hidden="true">→</span>';
      }
      row.className = `queue-row ${s.status}`;
      write(row.firstElementChild, s.status === "blocked" ? "Approval" : s.status === "waiting" ? "Reply" : "Working");
      const action = sessionAction(s);
      write(row.children[1].firstElementChild, s.title);
      write(row.children[1].lastElementChild, `${s.project} · ${providerMeta(s.provider).name} · ${action}`);
      row.title = `${s.title}\n${action}`;
      if (list.children[i] !== row) list.insertBefore(row, list.children[i] || null);
    }
    for (const row of existing.values()) row.remove();
    if (active?.isConnected && active !== document.activeElement) active.focus({ preventScroll: true });
    $("priority-empty").hidden = !!queue.length;
    if (!queue.length) write($("priority-empty"), !this.connected ? "Updates interrupted. Waiting for a fresh scan." :
      !this.hasSnapshot ? "Waiting for the scanner to connect." :
      filtered ? "No active sessions match these filters." : "No approvals, replies or active work right now.");
  }

  renderMap(projects) {
    const list = $("signal-lanes");
    const peak = Math.max(1, ...projects.map((lane) => Math.max(...lane.bins)));
    const names = new Map();
    for (const lane of projects) names.set(lane.name, (names.get(lane.name) || 0) + 1);
    const present = new Set();
    for (const [i, lane] of projects.entries()) {
      present.add(lane.key);
      let row = this.lanes.get(lane.key);
      if (!row) {
        row = document.createElement("button");
        row.type = "button";
        row.className = "signal-lane";
        row.dataset.project = lane.key;
        row.innerHTML = '<span class="lane-name"></span><span class="lane-bars" aria-hidden="true"></span><span class="lane-total"></span>';
        row.children[1].append(...lane.bins.map(() => document.createElement("i")));
        this.lanes.set(lane.key, row);
      }
      if (list.children[i] !== row) list.insertBefore(row, list.children[i] || null);
      const label = names.get(lane.name) > 1 ? lane.key : lane.name;
      write(row.firstElementChild, label);
      write(row.lastElementChild, String(lane.total));
      row.title = `${label}: ${lane.total} recorded events in 30 minutes. Select to filter; select again to clear.`;
      row.setAttribute("aria-label", `Filter by ${label}, ${lane.total} recorded events in 30 minutes${lane.waits.size ? ", including a wait" : ""}`);
      row.setAttribute("aria-pressed", String(lane.key === this.project));
      for (const [j, count] of lane.bins.entries()) {
        const bar = row.children[1].children[j];
        const height = count ? `${Math.max(16, Math.round(count / peak * 100))}%` : "0%";
        if (bar.style.height !== height) bar.style.height = height;
        bar.classList.toggle("has-wait", lane.waits.has(j));
      }
    }
    for (const [key, row] of this.lanes) if (!present.has(key)) { row.remove(); this.lanes.delete(key); }
    $("signal-empty").hidden = !!projects.length;
    $("signal-wait-key").hidden = !projects.some((lane) => lane.waits.size);
    write($("signal-empty"), !this.hasSnapshot ? "No snapshot available." : "No projects match this view.");
    write($("signal-range"), !this.connected && this.hasSnapshot ? "Last snapshot" : "Last 30 minutes");
    write($("signal-end"), !this.connected || !this.hasSnapshot ? "Snapshot" : "Now");
  }
}
