// Professional "workspace" view: one panel per project, one row per session with a
// 30-minute activity timeline. It exposes the same small interface main.js uses for
// the pixel World (setSessions, select, focus, recenter, zoom, setPaused).

import { providerMeta, STATUS_TEXT, stationFor, describe, ago, compact, escapeHtml as esc } from "./meta.js";
import { sortSessions } from "./selectors.js";

export const TIMELINE_MS = 30 * 60e3;
const TOOL_STATIONS = ["library", "forge", "terminal", "radar", "tasks"]; // Session.stations[1..5]
export const TONE_LABEL = {
  hub: "Think", library: "Read", forge: "Edit", terminal: "Run", radar: "Web", tasks: "Plan",
  user: "Prompt", done: "Turn done", error: "Error", wait: "Waiting", system: "System",
};

/** The colour family of an event: its station for tool calls, otherwise its kind. */
export function eventTone(e) {
  if (e.kind === "tool") return e.station || "tasks";
  if (e.kind === "think" || e.kind === "reply") return "hub";
  return e.kind;
}

/**
 * Groups sessions into project panels. Projects that need you come first, then busy
 * ones, then the most recently active. Within a project, sub-agents follow their parent.
 */
export function groupProjects(sessions) {
  const byProject = new Map();
  for (const s of sessions) {
    const key = s.cwd || s.project;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(s);
  }
  const groups = [...byProject].map(([key, list]) => {
    const keys = new Set(list.map((s) => s.key));
    const roots = sortSessions(list.filter((s) => !s.parent || !keys.has(s.parent)), "attention");
    const rows = [];
    const placed = new Set();
    const place = (s, depth) => {
      if (placed.has(s.key)) return;
      placed.add(s.key);
      const children = sortSessions(list.filter((c) => c.parent === s.key), "attention");
      rows.push({ session: s, depth, kids: { total: children.length, working: children.filter((c) => c.status === "working").length } });
      for (const child of children) place(child, depth + 1);
    };
    roots.forEach((s) => place(s, 0));
    list.forEach((s) => place(s, 1)); // cycles or orphans, just in case
    const count = (status) => list.filter((s) => s.status === status).length;
    return {
      key, name: list[0].project, path: list[0].cwd, rows,
      blocked: count("blocked"), waiting: count("waiting"), working: count("working"),
      tools: list.reduce((a, s) => a + s.toolCalls, 0),
      last: Math.max(...list.map((s) => s.lastTs)),
    };
  });
  return groups.sort((a, b) =>
    b.blocked - a.blocked || (b.blocked + b.waiting) - (a.blocked + a.waiting) ||
    b.working - a.working || b.last - a.last || a.name.localeCompare(b.name));
}

/** Tick positions (0-100%) for events inside the timeline window ending at `now`. */
export function timelineTicks(events, now) {
  const start = now - TIMELINE_MS;
  return events
    .filter((e) => e.ts >= start && e.ts <= now + 5000 && e.kind !== "system")
    .map((e) => ({ left: Math.min(100, Math.max(0, ((e.ts - start) / TIMELINE_MS) * 100)), tone: eventTone(e), event: e }));
}

function rowMarkup({ session: s, depth, kids }, now) {
  const m = providerMeta(s.provider);
  const working = s.status === "working";
  const tone = working ? (s.current ? eventTone(s.current) : "hub") : `st-${s.status}`;
  const chip = working ? TONE_LABEL[stationFor(s)] || "Think" : STATUS_TEXT[s.status];
  const ticks = timelineTicks(s.events, now)
    .map((t) => `<i class="tick t-${t.tone}" style="left:${t.left.toFixed(2)}%"></i>`).join("");
  const tools = s.stations.slice(1, 6);
  const total = tools.reduce((a, n) => a + n, 0);
  const mix = total
    ? tools.map((n, i) => n ? `<i class="t-${TOOL_STATIONS[i]}" style="flex-basis:${((n / total) * 100).toFixed(1)}%"></i>` : "").join("")
    : "";
  const mixTitle = total ? tools.map((n, i) => `${TONE_LABEL[TOOL_STATIONS[i]]} ${n}`).join(" · ") : "No tool calls yet";
  return `<span class="s-dot"></span>
    <span class="s-main">
      <span class="s-line1">${depth ? '<span class="s-sub" title="Sub-agent">↳</span>' : ""}<b>${esc(s.title)}</b>${subsPill(kids)}</span>
      <span class="s-line2"><span class="badge" style="--c:${m.body}">${depth ? esc(`Sub-agent · ${s.role && s.role !== "subagent" ? s.role : m.name}`) : esc(m.name)}</span><span class="s-doing">${esc(describe(s.current))}</span></span>
    </span>
    <span class="s-now t-${tone}">${esc(chip)}</span>
    <span class="s-track" title="Activity in the last 30 minutes">${ticks}<i class="now"></i></span>
    <span class="s-mix" title="${esc(mixTitle)}">${mix}</span>
    <span class="s-meta"><span>${compact(s.toolCalls)} tools</span><time data-ts="${s.lastTs}">${ago(now - s.lastTs)}</time></span>`;
}

/** "2 sub-agents working" on a parent row. */
function subsPill(kids) {
  if (!kids?.total) return "";
  const n = kids.working || kids.total;
  return `<span class="s-subs${kids.working ? " busy" : ""}">${n} sub-agent${n === 1 ? "" : "s"}${kids.working ? " working" : ""}</span>`;
}

function projectHead(g) {
  const pills = [
    g.blocked && `<span class="p-pill st-blocked">${g.blocked} approval${g.blocked === 1 ? "" : "s"}</span>`,
    g.waiting && `<span class="p-pill st-waiting">${g.waiting} your turn</span>`,
    g.working && `<span class="p-pill st-working">${g.working} working</span>`,
    `<span class="p-pill">${g.rows.length} session${g.rows.length === 1 ? "" : "s"}</span>`,
    `<span class="p-pill">${compact(g.tools)} tools</span>`,
  ].filter(Boolean).join("");
  return `<div class="proj-title"><h4>${esc(g.name)}</h4>${g.path ? `<span class="proj-path" title="${esc(g.path)}">${esc(g.path)}</span>` : ""}</div><div class="proj-stats">${pills}</div>`;
}

export class Board {
  constructor(el, { onSelect, now } = {}) {
    this.el = el;
    this.onSelect = onSelect || (() => {});
    this.now = now || Date.now;
    this.sessions = [];
    this.selected = null;
    this.active = false;
    this.markup = new WeakMap();
    el.addEventListener("click", (e) => {
      const row = e.target.closest(".srow");
      if (row) this.select(row.dataset.key);
    });
  }

  setSessions(sessions) {
    this.sessions = sessions;
    if (this.active) this.render();
  }

  setActive(on) {
    this.active = on;
    this.el.hidden = !on;
    if (on) this.render();
  }

  select(key) {
    this.setSelected(key);
    this.onSelect(key);
  }

  setSelected(key) {
    this.selected = key;
    for (const row of this.el.querySelectorAll(".srow")) {
      row.classList.toggle("sel", row.dataset.key === key);
      row.setAttribute("aria-pressed", row.dataset.key === key);
    }
  }

  focus(key) {
    const row = [...this.el.querySelectorAll(".srow")].find((r) => r.dataset.key === key);
    if (!row) return;
    row.scrollIntoView({ block: "nearest" });
    row.classList.remove("flash");
    void row.offsetWidth; // restart the highlight animation
    row.classList.add("flash");
  }

  recenter() { this.el.scrollTo({ top: 0 }); }
  zoom() {}
  setPaused() {}

  set(el, markup) {
    if (this.markup.get(el) !== markup) {
      el.innerHTML = markup;
      this.markup.set(el, markup);
    }
  }

  render() {
    const now = this.now();
    const groups = groupProjects(this.sessions);
    let head = this.el.querySelector(".board-head");
    if (!head) {
      head = document.createElement("div");
      head.className = "board-head";
      this.el.prepend(head);
    }
    const sessions = this.sessions.length;
    this.set(head, `<span></span><span>${groups.length} project${groups.length === 1 ? "" : "s"} · ${sessions} session${sessions === 1 ? "" : "s"}</span><span>Now</span><span class="axis"><span>−30m</span><span>−15m</span><span>now</span></span><span class="h-mix">Tool mix</span><span class="h-meta">Last seen</span>`);

    // Keyed reconciliation keeps row buttons (and keyboard focus) alive between polls.
    const panels = new Map([...this.el.querySelectorAll(":scope > .proj")].map((p) => [p.dataset.key, p]));
    let anchor = head;
    for (const g of groups) {
      let panel = panels.get(g.key);
      panels.delete(g.key);
      if (!panel) {
        panel = document.createElement("section");
        panel.className = "proj";
        panel.dataset.key = g.key;
        panel.innerHTML = '<header class="proj-head"></header><div class="proj-rows" role="list"></div>';
      }
      if (anchor.nextElementSibling !== panel) anchor.after(panel);
      anchor = panel;
      this.set(panel.firstElementChild, projectHead(g));
      const list = panel.lastElementChild;
      const rows = new Map([...list.children].map((r) => [r.dataset.key, r]));
      g.rows.forEach((row, i) => {
        const s = row.session;
        let el = rows.get(s.key);
        rows.delete(s.key);
        if (!el) {
          el = document.createElement("button");
          el.type = "button";
          el.dataset.key = s.key;
          el.setAttribute("role", "listitem");
        }
        el.className = `srow ${s.status}${row.depth ? " child" : ""}${s.key === this.selected ? " sel" : ""}`;
        el.setAttribute("aria-pressed", s.key === this.selected);
        el.title = `${s.title} · ${s.cwd || s.project}`;
        this.set(el, rowMarkup(row, now));
        if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
      });
      for (const el of rows.values()) el.remove();
    }
    for (const panel of panels.values()) panel.remove();
  }
}
