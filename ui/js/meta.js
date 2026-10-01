// Shared metadata: providers, stations, statuses, formatting helpers.

export const PROVIDERS = {
  claude:      { name: "Claude Code",  short: "CLAUDE",   body: "#e07a4f", shade: "#a34f2f", light: "#f7ad86", eye: "#fff1c2", accent: "#ffd166", head: "star" },
  codex:       { name: "Codex",        short: "CODEX",    body: "#dfe3ee", shade: "#8e95ab", light: "#ffffff", eye: "#37e8a3", accent: "#37e8a3", head: "visor" },
  copilot:     { name: "Copilot CLI",  short: "COPILOT",  body: "#9b6df2", shade: "#6242b8", light: "#c7a8ff", eye: "#ffffff", accent: "#ff8ad8", head: "goggles" },
  vscode:      { name: "Copilot Chat", short: "VSCODE",   body: "#3a8ff0", shade: "#235fa6", light: "#86c1ff", eye: "#ffffff", accent: "#9ae6ff", head: "goggles" },
  gemini:      { name: "Gemini CLI",   short: "GEMINI",   body: "#5a7ff7", shade: "#3450b3", light: "#9ab5ff", eye: "#ffe27a", accent: "#ffe27a", head: "sparkle" },
  antigravity: { name: "Antigravity",  short: "ANTIGRAV", body: "#2bc4d3", shade: "#17808b", light: "#93f3f9", eye: "#ff7ae0", accent: "#ff7ae0", head: "sparkle", hover: true },
  opencode:    { name: "OpenCode",     short: "OPENCODE", body: "#f2c14e", shade: "#b3842a", light: "#ffe49e", eye: "#1b1b2b", accent: "#ffffff", head: "visor" },
  // Not an agent: AgentTally's own mascot, the desktop buddy that reports on all the others.
  tally:       { name: "AgentTally",   short: "TALLY",    body: "#ff6fae", shade: "#c23d7d", light: "#ffb3d4", eye: "#ffffff", accent: "#ffd23f", head: "crown" },
};

export const providerMeta = (key) =>
  PROVIDERS[key] || { name: key, short: key.toUpperCase(), body: "#9aa3b8", shade: "#646c80", light: "#cfd6e6", eye: "#ffffff", accent: "#ffffff", head: "visor" };

// Hex "flower" per project: the core in the middle, six stations around it.
export const STATIONS = {
  hub:      { label: "CORE",     verb: "Thinking",   icon: "◆" },
  library:  { label: "LIBRARY",  verb: "Reading",    icon: "▤" },
  forge:    { label: "FORGE",    verb: "Editing",    icon: "⚒" },
  terminal: { label: "TERMINAL", verb: "Running",    icon: "▶" },
  radar:    { label: "RADAR",    verb: "Browsing",   icon: "◎" },
  tasks:    { label: "QUESTS",   verb: "Planning",   icon: "✦" },
  dock:     { label: "DOCK",     verb: "Resting",    icon: "⚡" },
};

export const STATUS = {
  working:  { label: "WORKING",  color: "#46e07a", order: 0 },
  blocked:  { label: "NEEDS OK", color: "#ff5a6a", order: 1 },
  waiting:  { label: "YOUR TURN", color: "#ffd23f", order: 2 },
  idle:     { label: "IDLE",     color: "#6fb6ff", order: 3 },
  sleeping: { label: "SLEEPING", color: "#7c7fa8", order: 4 },
  offline:  { label: "OFFLINE",  color: "#555a70", order: 5 },
};

/** Sentence-case status names shared by both interfaces. */
export const STATUS_TEXT = {
  blocked: "Needs approval", waiting: "Your turn", working: "Working", idle: "Idle", sleeping: "Sleeping", offline: "Offline",
};

export const KIND_ICON = {
  user: "»", think: "…", tool: "⚙", reply: "✉", done: "✓", error: "✗", wait: "!", system: "·",
};

export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;
  return `${Math.floor(h / 24)}d`;
}

export function compact(n) {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)}M`;
  return `${(n / 1e9).toFixed(1)}B`;
}

/** mcp__claude-in-chrome__navigate → claude-in-chrome › navigate */
export function toolName(name = "") {
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  return m ? `${m[1]} › ${m[2]}` : name;
}

export function describe(act) {
  if (!act) return "Standing by";
  const text = act.text || "";
  switch (act.kind) {
    case "tool": {
      const verb = STATIONS[act.station]?.verb || "Using";
      const tool = toolName(act.tool);
      return text ? `${tool}: ${text}` : `${verb} with ${tool}`;
    }
    case "think": return text || "Thinking…";
    case "reply": return text || "Writing a reply";
    case "user": return `You: ${text}`;
    case "done": return text ? `Done: ${text}` : "Turn complete";
    case "error": return text || "Error";
    case "wait": return text || "Waiting for you";
    default: return text;
  }
}

/** Where on its project's hex flower a robot should stand. */
export function stationFor(session) {
  const st = session.status;
  if (st === "idle" || st === "sleeping" || st === "offline") return "dock";
  if (st === "waiting" || st === "blocked") return "hub";
  const cur = session.current;
  if (!cur) return "hub";
  if (cur.kind === "tool") return cur.station || "tasks";
  return "hub";
}

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
