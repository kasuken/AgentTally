// Simulated snapshots for running the UI outside Tauri (browser preview / ?demo).

const TOOLS = {
  claude: [["Read", "library", "src/scanner.rs"], ["Grep", "library", "fn render"], ["Edit", "forge", "src/lib.rs"], ["Bash", "terminal", "cargo test"], ["WebFetch", "radar", "docs.rs/tauri"], ["TodoWrite", "tasks", "3 todos"], ["Agent", "tasks", "Explore log formats"]],
  codex: [["exec_command", "terminal", "npm run build"], ["apply_patch", "forge", "app/page.tsx"], ["web_search", "radar", "next.js 16 caching"], ["update_plan", "tasks", "4 steps"], ["exec_command", "terminal", "rg -n TODO"]],
  copilot: [["view", "library", "README.md"], ["powershell", "terminal", "dotnet build"], ["edit", "forge", "Program.cs"], ["web_fetch", "radar", "learn.microsoft.com"], ["task", "tasks", "Started explore"]],
  vscode: [["copilot_readFile", "library", "Startup.cs"], ["copilot_replaceString", "forge", "CHANGELOG.md"], ["run_in_terminal", "terminal", "git status"]],
  gemini: [["read_file", "library", "main.go"], ["replace", "forge", "handler.go"], ["run_shell_command", "terminal", "go test ./..."], ["google_web_search", "radar", "grpc retries"]],
  antigravity: [],
};

const SEED = [
  { provider: "claude", project: "AgentTally", title: "Agent activity monitor dashboard", model: "claude-opus-5-5", status: "working" },
  { provider: "claude", project: "AgentTally", title: "Explore log formats", model: "claude-haiku-4-5", status: "working", parentIdx: 0 },
  { provider: "codex", project: "docs-site", title: "Weekly release notes", model: "gpt-6-luna", status: "working" },
  { provider: "copilot", project: "shop-api", title: "Payment webhook retries", model: "claude-sonnet-5-5", status: "blocked" },
  { provider: "vscode", project: "docs-site", title: "Changelog for v1.3", model: "GPT-6 Luna", status: "waiting" },
  { provider: "claude", project: "notes-app", title: "Account deletion flow", model: "claude-opus-5-5", status: "waiting" },
  { provider: "gemini", project: "game-engine", title: "Shader hot reload", model: "gemini-3-pro", status: "idle" },
  { provider: "codex", project: "docs-site", title: "Fix broken links", model: "gpt-6-luna", status: "idle" },
  { provider: "antigravity", project: "antigravity", title: "Antigravity conversation", status: "sleeping", presenceOnly: true },
  { provider: "copilot", project: "game-engine", title: "Static site deploy", model: "gpt-6-sol", status: "offline" },
  { provider: "codex", project: "shop-api", title: "Trace retry handling", model: "gpt-6-luna", status: "working" },
  // Background sub-agents keep working after their parent handed the turn back.
  { provider: "claude", project: "notes-app", title: "Write migration tests", model: "claude-sonnet-5-5", status: "working", parentIdx: 5, role: "general-purpose" },
  { provider: "claude", project: "notes-app", title: "Review API contract", model: "claude-haiku-4-5", status: "working", parentIdx: 5, role: "Explore" },
];

const PROMPTS = ["Fix the failing tests", "Add dark mode", "Why is the build slow?", "Ship v0.2", "Refactor the scanner"];

export function createDemo() {
  const start = Date.now();
  const sessions = SEED.map((s, i) => ({
    key: `${s.provider}:demo-${i}`,
    id: `demo-${i}`,
    provider: s.provider,
    title: s.title,
    project: s.project,
    cwd: `C:\\code\\${s.project}`,
    model: s.model || null,
    branch: i % 3 ? "main" : "feature/activity-log",
    client: null,
    parent: s.parentIdx !== undefined ? `${SEED[s.parentIdx].provider}:demo-${s.parentIdx}` : null,
    role: s.role || (s.parentIdx !== undefined ? "subagent" : null),
    status: s.status,
    presenceOnly: !!s.presenceOnly,
    started: start - (20 + i * 13) * 60000,
    lastTs: start - (s.status === "working" ? 2000 : s.status === "idle" ? 40 * 60000 : s.status === "sleeping" ? 5 * 3600000 : 60000),
    current: null,
    events: [],
    tokensIn: s.presenceOnly ? 0 : 50000 + i * 91234,
    tokensOut: s.presenceOnly ? 0 : 4000 + i * 3100,
    tokensInKnown: !s.presenceOnly,
    tokensOutKnown: !s.presenceOnly,
    toolCalls: s.presenceOnly ? 0 : 10 + i * 7,
    stations: s.presenceOnly ? [0, 0, 0, 0, 0, 0] : [3, 8 + i, 4, 6, 1, 2],
  }));
  const push = (s, ev) => {
    s.events.push(ev);
    if (s.events.length > 25) s.events.shift();
    s.current = ev;
    s.lastTs = ev.ts;
  };
  for (const s of sessions) {
    if (s.presenceOnly) continue;
    const now = Date.now();
    // Leave gaps between bursts of recorded events.
    const end = { idle: now - 40 * 60000, sleeping: now - 5 * 3600000, offline: now - 3 * 3600000 }[s.status] ?? s.lastTs - 2000;
    const active = ["working", "waiting", "blocked"].includes(s.status);
    const span = (active ? 18 + (s.title.length % 8) : 4) * 60000;
    const start = end - span;
    push(s, { ts: start, kind: "user", station: "hub", text: PROMPTS[s.id.length % PROMPTS.length] });
    const tools = TOOLS[s.provider] || [];
    const positions = s.title.length % 2 ? [3, 5, 7, 26, 27, 30, 72, 78, 92, 98] : [3, 12, 15, 38, 42, 46, 55, 83, 85, 89];
    for (let k = 0; tools.length && k < positions.length; k++) {
      const ts = start + Math.round(span * positions[k] / 100);
      if (k % 4 === 0) { push(s, { ts, kind: "think", station: "hub", text: "" }); continue; }
      const [tool, station, text] = tools[(k + s.title.length) % tools.length];
      push(s, { ts, kind: "tool", station, tool, text });
    }
    if (s.status === "waiting") push(s, { ts: now - 60000, kind: "done", station: "hub", text: s.provider === "vscode" ? "Changelog updated for 1.3.0" : "Account deletion flow ready for review" });
    if (s.status === "blocked") push(s, { ts: now - 30000, kind: "wait", station: "hub", text: "Requested permission to run the webhook tests" });
    if (s.status === "offline") push(s, { ts: end, kind: "done", station: "hub", text: "Session closed" });
    if (!active) s.lastTs = end;
  }

  // Start with a shift already in progress. Give each simulated task time to play out
  // before switching tools; real providers still report every event immediately.
  const shift = sessions.filter(s => s.status === "working");
  const nextAction = new Map();
  shift.forEach((s,i) => {
    const tool = TOOLS[s.provider]?.find(([,station]) => station === (s.parent ? "library" : "forge"));
    const planning = !tool || (!s.parent && s.provider === "codex");
    push(s, s.project === "shop-api" ? { ts:start, kind:"tool", station:"library", tool:"exec_command", text:"rg retry handlers.ts" }
      : planning ? { ts:start, kind:"think", station:"hub", text:"Reviewing changes for the release notes" }
      : { ts:start, kind:"tool", tool:tool[0], station:tool[1], text:tool[2] });
    nextAction.set(s.key, start + 16000 + i * 2700);
  });
  let nextHandoff = start + 45000;
  function tick() {
    const now = Date.now();
    for (const s of sessions) {
      if (s.status !== "working" || now < (nextAction.get(s.key) || 0)) continue;
      nextAction.set(s.key, now + 14000 + Math.random() * 19000);
      const tools = TOOLS[s.provider] || [];
      const r = Math.random();
      if (r < 0.2) push(s, { ts: now, kind: "think", station: "hub", text: "" });
      else if (r < 0.26) push(s, { ts: now, kind: "reply", station: "hub", text: "Found it: the scanner re-read the whole file on every poll." });
      else if (tools.length) {
        const [tool, station, text] = tools[Math.floor(Math.random() * tools.length)];
        push(s, { ts: now, kind: "tool", station, tool, text });
        s.toolCalls++;
        s.stations[["hub", "library", "forge", "terminal", "radar", "tasks"].indexOf(station)]++;
      }
      s.tokensIn += Math.floor(Math.random() * 4000);
      s.tokensOut += Math.floor(Math.random() * 400);
    }
    // Occasionally hand a turn back to you, or pick one up again.
    if (now >= nextHandoff) {
      nextHandoff = now + 45000;
      if (Math.random() < 0.5) {
        const w = sessions.find((s) => s.status === "waiting");
        if (w) { w.status = "working"; push(w, { ts: now, kind: "user", station: "hub", text: "Looks good, continue" }); }
      } else {
        const w = sessions.find((s) => s.status === "working" && !s.parent && s.provider !== "claude");
        if (w) { w.status = "waiting"; push(w, { ts: now, kind: "done", station: "hub", text: "All tests pass." }); }
      }
    }
    return {
      now,
      providers: [
        { key: "claude", name: "Claude Code", detected: true, roots: [] },
        { key: "codex", name: "Codex", detected: true, roots: [] },
        { key: "copilot", name: "Copilot CLI", detected: true, roots: [] },
        { key: "vscode", name: "Copilot Chat", detected: true, roots: [] },
        { key: "gemini", name: "Gemini CLI", detected: true, roots: [] },
        { key: "antigravity", name: "Antigravity", detected: true, roots: [] },
        { key: "opencode", name: "OpenCode", detected: false, roots: [] },
      ],
      sessions: structuredClone(sessions),
    };
  }
  return { tick };
}
