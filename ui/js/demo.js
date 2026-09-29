// Simulated snapshots for running the UI outside Tauri (browser preview / ?demo).

const TOOLS = {
  claude: [["Read", "library", "src/world.rs"], ["Grep", "library", "fn render"], ["Edit", "forge", "src/lib.rs"], ["Bash", "terminal", "cargo test"], ["WebFetch", "radar", "docs.rs/tauri"], ["TodoWrite", "tasks", "3 todos"], ["Agent", "tasks", "Explore log formats"]],
  codex: [["exec_command", "terminal", "npm run build"], ["apply_patch", "forge", "app/page.tsx"], ["web_search", "radar", "next.js 16 caching"], ["update_plan", "tasks", "4 steps"], ["exec_command", "terminal", "rg -n TODO"]],
  copilot: [["view", "library", "README.md"], ["powershell", "terminal", "dotnet build"], ["edit", "forge", "Program.cs"], ["web_fetch", "radar", "learn.microsoft.com"], ["task", "tasks", "Started explore"]],
  vscode: [["copilot_readFile", "library", "Startup.cs"], ["copilot_replaceString", "forge", "CHANGELOG.md"], ["run_in_terminal", "terminal", "git status"]],
  gemini: [["read_file", "library", "main.go"], ["replace", "forge", "handler.go"], ["run_shell_command", "terminal", "go test ./..."], ["google_web_search", "radar", "grpc retries"]],
  antigravity: [],
};

const SEED = [
  { provider: "claude", project: "AgentTally", title: "Agent activity monitor dashboard", model: "claude-opus-5-5", status: "working" },
  { provider: "claude", project: "AgentTally", title: "Explore log formats", model: "claude-haiku-4-5", status: "working", parentIdx: 0 },
  { provider: "codex", project: "business-os", title: "Weekly standup draft", model: "gpt-6-luna", status: "working" },
  { provider: "copilot", project: "LearnStack", title: "Stripe webhook isolation", model: "claude-sonnet-5-5", status: "blocked" },
  { provider: "vscode", project: "LearnStack", title: "Changelog request for updates", model: "GPT-6 Luna", status: "waiting" },
  { provider: "claude", project: "Brainy", title: "Account deletion flow", model: "claude-opus-5-5", status: "working" },
  { provider: "gemini", project: "casegrid", title: "Release notes for 0.0.1", model: "gemini-3-pro", status: "idle" },
  { provider: "antigravity", project: "antigravity", title: "Antigravity conversation", status: "sleeping" },
  { provider: "copilot", project: "casegrid", title: "Azure static web app", model: "gpt-6-sol", status: "offline" },
  { provider: "codex", project: "website", title: "Blog post images", model: "gpt-6-luna", status: "working" },
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
    cwd: `C:\\_GITHUB_\\${s.project}`,
    model: s.model || null,
    branch: i % 3 ? "main" : "feature/hex-world",
    client: null,
    parent: s.parentIdx !== undefined ? `${SEED[s.parentIdx].provider}:demo-${s.parentIdx}` : null,
    role: s.parentIdx !== undefined ? "subagent" : null,
    status: s.status,
    started: start - (20 + i * 13) * 60000,
    lastTs: start - (s.status === "working" ? 2000 : s.status === "idle" ? 40 * 60000 : s.status === "sleeping" ? 5 * 3600000 : 60000),
    current: null,
    events: [],
    tokensIn: 50000 + i * 91234,
    tokensOut: 4000 + i * 3100,
    toolCalls: 10 + i * 7,
    stations: [3, 8 + i, 4, 6, 1, 2],
  }));
  const push = (s, ev) => {
    s.events.push(ev);
    if (s.events.length > 25) s.events.shift();
    s.current = ev;
    s.lastTs = ev.ts;
  };
  for (const s of sessions) {
    const now = Date.now();
    push(s, { ts: s.lastTs - 30000, kind: "user", station: "hub", text: PROMPTS[s.id.length % PROMPTS.length] });
    const tools = TOOLS[s.provider] || [];
    for (let k = 0; k < 4 && tools.length; k++) {
      const [tool, station, text] = tools[(k + s.title.length) % tools.length];
      push(s, { ts: s.lastTs + 1, kind: "tool", station, tool, text });
    }
    if (s.status === "waiting") push(s, { ts: now - 60000, kind: "done", station: "hub", text: "Changelog updated for 1.3.0" });
    if (s.status === "blocked") push(s, { ts: now - 30000, kind: "wait", station: "hub", text: "Waiting for your permission" });
    if (s.status === "offline") push(s, { ts: now - 3 * 3600000, kind: "done", station: "hub", text: "Session closed" });
    if (s.status === "idle") s.lastTs = now - 40 * 60000;
    if (s.status === "sleeping") s.lastTs = now - 5 * 3600000;
  }

  function tick() {
    const now = Date.now();
    for (const s of sessions) {
      if (s.status !== "working" || Math.random() < 0.45) continue;
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
    if (Math.random() < 0.04) {
      const w = sessions.find((s) => s.status === "waiting");
      if (w) { w.status = "working"; push(w, { ts: now, kind: "user", station: "hub", text: "Looks good, continue" }); }
    } else if (Math.random() < 0.03) {
      const w = sessions.find((s) => s.status === "working" && !s.parent && s.provider !== "claude");
      if (w) { w.status = "waiting"; push(w, { ts: now, kind: "done", station: "hub", text: "All tests pass." }); }
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
