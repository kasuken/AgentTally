// Pure view selectors. Overview counts remain useful while drilling into results.
import { providerMeta } from "./meta.js";
export const WINDOWS = { live: 15 * 60e3, "1h": 3600e3, "6h": 6 * 3600e3, "24h": 24 * 3600e3 };
export const needsAttention = (s) => s.status === "blocked" || s.status === "waiting";
export const isResting = (s) => ["idle", "sleeping", "offline"].includes(s.status);
export function inWindow(s, window, now) {
  const active = s.status === "working" || needsAttention(s);
  return (active || now - s.lastTs < (WINDOWS[window] || WINDOWS["6h"])) &&
    (window !== "live" || !["offline", "sleeping"].includes(s.status));
}
export function selectSessions(sessions, filters, now) {
  const query = (filters.query || "").trim().toLocaleLowerCase();
  return sessions.filter((s) => !filters.hidden.has(s.provider) && inWindow(s, filters.window, now))
    .filter((s) => !filters.project || (s.cwd || s.project) === filters.project)
    .filter((s) => !query || [s.title, s.project, s.cwd, s.provider, providerMeta(s.provider).name, s.client, s.model].filter(Boolean).join(" ").toLocaleLowerCase().includes(query))
    .filter((s) => filters.status === "all" || (filters.status === "attention" ? needsAttention(s) : filters.status === "resting" ? isResting(s) : s.status === filters.status));
}
export function sortSessions(sessions, sort = "attention") {
  const order = { blocked: 0, waiting: 1, working: 2, idle: 3, sleeping: 4, offline: 5 };
  return [...sessions].sort((a, b) => (sort === "project" ? a.project.localeCompare(b.project) : 0) ||
    (sort !== "recent" ? order[a.status] - order[b.status] : b.lastTs - a.lastTs) ||
    (sort !== "recent" ? a.project.localeCompare(b.project) : 0) || a.key.localeCompare(b.key));
}

/**
 * Puts each sub-agent right after its parent (when the parent is in the list), deepest last,
 * keeping the given order otherwise. Returns `{ key, s, depth, kids: { total, working } }`.
 */
export function nestSubagents(list) {
  const keys = new Set(list.map((s) => s.key));
  const children = new Map();
  for (const s of list) {
    if (s.parent && keys.has(s.parent) && s.parent !== s.key) {
      if (!children.has(s.parent)) children.set(s.parent, []);
      children.get(s.parent).push(s);
    }
  }
  const out = [];
  const seen = new Set();
  const add = (s, depth) => {
    if (seen.has(s.key)) return;
    seen.add(s.key);
    const kids = children.get(s.key) || [];
    out.push({ key: s.key, s, depth, kids: { total: kids.length, working: kids.filter((k) => k.status === "working").length } });
    kids.forEach((k) => add(k, depth + 1));
  };
  list.filter((s) => !(s.parent && keys.has(s.parent))).forEach((s) => add(s, 0));
  list.forEach((s) => add(s, 1)); // anything left (e.g. a parent cycle)
  return out;
}
