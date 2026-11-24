import { providerMeta, STATUS_TEXT, sessionAction, ago, escapeHtml as esc } from "./meta.js";
import { sortSessions, nestSubagents } from "./selectors.js";

export const TIMELINE_MS = 30 * 60e3;
export const projectKey = (s) => s.cwd || s.project;

export function eventTone(e) {
  if (e.kind === "tool") return e.station || "tasks";
  if (e.kind === "think" || e.kind === "reply") return "hub";
  return e.kind;
}

export function groupProjects(sessions, sort = "attention") {
  const byProject = new Map();
  for (const s of sessions) {
    const key = projectKey(s);
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(s);
  }
  const groups = [...byProject].map(([key, list]) => {
    const rows = nestSubagents(sortSessions(list, sort)).map(({ s, depth, kids }) => ({ session: s, depth, kids }));
    const count = (status) => list.filter((s) => s.status === status).length;
    return {
      key, name: list[0].project, path: list[0].cwd, rows,
      blocked: count("blocked"), waiting: count("waiting"), working: count("working"),
      last: Math.max(...list.map((s) => s.lastTs)),
    };
  });
  return groups.sort((a, b) =>
    (sort === "attention" ? b.blocked - a.blocked || b.waiting - a.waiting || b.working - a.working : 0) ||
    (sort !== "project" ? b.last - a.last : 0) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

/** Observations, not durations: only place events within the shared time axis. */
export function timelineTicks(events, now) {
  const start = now - TIMELINE_MS;
  return events.filter((e) => e.ts >= start && e.ts <= now && e.kind !== "system")
    .map((e) => ({ left: (e.ts - start) / TIMELINE_MS * 100, tone: eventTone(e), event: e }));
}

function rowMarkup({ session: s, depth, kids }, now) {
  const provider = providerMeta(s.provider).name;
  const agent = s.parent ? `Sub-agent · ${s.role && s.role !== "subagent" ? `${s.role} · ` : ""}${provider}` : provider;
  const ticks = timelineTicks(s.events, now)
    .map((t) => `<i class="tick t-${esc(t.tone)}" style="left:${t.left.toFixed(2)}%"></i>`).join("");
  const age = ago(now - s.lastTs);
  return `<span class="s-main" style="--depth:${depth}">
    <strong>${depth ? '<span class="s-sub" aria-hidden="true">↳</span>' : ""}${esc(s.title)}</strong>
    <span class="s-doing"><span class="s-agent">${esc(agent)}</span><span class="s-action">${esc(sessionAction(s))}</span></span>
    ${kids.total ? `<span class="s-kids">${kids.total} sub-agent${kids.total === 1 ? "" : "s"}${kids.working ? `, ${kids.working} working` : ""}</span>` : ""}
    </span>
    <span class="s-status"><span class="state ${esc(s.status)}">${esc(STATUS_TEXT[s.status])}</span>
    <time title="${esc(new Date(s.lastTs).toLocaleString())}">${age === "now" ? "Just now" : `${age} ago`}</time></span>
    <span class="s-track" aria-hidden="true">${ticks}</span>`;
}

export class Board {
  constructor(el, onSelect) {
    this.el = el;
    this.cache = new WeakMap();
    el.addEventListener("click", (e) => {
      const row = e.target.closest(".srow");
      if (row) onSelect(row.dataset.key, row);
    });
    this.head = document.createElement("div");
    this.head.className = "board-head";
    this.head.innerHTML = '<span>Session / latest action</span><span>State</span><span class="axis"><span>−30 min</span><span>Now</span></span>';
    el.append(this.head);
  }

  select(key) {
    for (const row of this.el.querySelectorAll(".srow")) row.setAttribute("aria-pressed", row.dataset.key === key);
  }

  focus(key) {
    const rows = [...this.el.querySelectorAll(".srow")];
    const row = rows.find((r) => r.dataset.key === key) || rows[0];
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }

  set(el, markup) {
    if (this.cache.get(el) === markup) return;
    el.innerHTML = markup;
    this.cache.set(el, markup);
  }

  render(sessions, selected, sort, now) {
    const groups = groupProjects(sessions, sort);
    const active = document.activeElement;
    const scroll = this.el.scrollTop;
    this.el.hidden = !groups.length;
    const panels = new Map([...this.el.querySelectorAll(":scope > .proj")].map((p) => [p.dataset.key, p]));
    const names = new Set(), duplicate = new Set();
    for (const g of groups) { if (names.has(g.name)) duplicate.add(g.name); names.add(g.name); }
    let anchor = this.head;
    for (const g of groups) {
      let panel = panels.get(g.key);
      panels.delete(g.key);
      if (!panel) {
        panel = document.createElement("section");
        panel.className = "proj";
        panel.dataset.key = g.key;
        panel.innerHTML = '<header class="proj-head"></header><div class="proj-rows"></div>';
      }
      if (anchor.nextElementSibling !== panel) anchor.after(panel);
      anchor = panel;
      const n = g.rows.length;
      const path = duplicate.has(g.name) && g.path ? `<span class="proj-path">${esc(g.path)}</span>` : "";
      this.set(panel.firstElementChild, `<h3 title="${esc(g.path || g.name)}">${esc(g.name)}${path}</h3><small>${n} session${n === 1 ? "" : "s"}</small>`);
      const list = panel.lastElementChild;
      const existing = new Map([...list.children].map((r) => [r.dataset.key, r]));
      g.rows.forEach((row, i) => {
        const s = row.session;
        let el = existing.get(s.key);
        existing.delete(s.key);
        if (!el) {
          el = document.createElement("button");
          el.type = "button";
          el.dataset.key = s.key;
          el.setAttribute("aria-controls", "detail");
        }
        el.className = `srow ${s.status}`;
        el.setAttribute("aria-pressed", s.key === selected);
        el.title = `${s.title}\n${sessionAction(s)}`;
        this.set(el, rowMarkup(row, now));
        if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
      });
      for (const el of existing.values()) el.remove();
    }
    for (const panel of panels.values()) panel.remove();
    if (active?.isConnected && active !== document.activeElement) active.focus({ preventScroll: true });
    this.el.scrollTop = scroll;
  }
}
