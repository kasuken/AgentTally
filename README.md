# AgentTally

A 16-bit hex world that shows what the AI coding agents on this machine are doing, live.

Every agent session is a small robot. Every project is a hex island with a **Core** in the
middle and six stations around it. Robots walk to the station that matches what they are doing:

| Station     | Activity                                   | Examples                                  |
|-------------|--------------------------------------------|-------------------------------------------|
| ◆ Core      | thinking, replying, waiting for you        | reasoning, final answer, permission asks  |
| ▤ Library   | reading and searching code                 | `Read`, `Grep`, `Glob`, `view`, readFile  |
| ⚒ Forge     | editing files                              | `Edit`, `Write`, `apply_patch`, replace   |
| ▶ Terminal  | running commands                           | `Bash`, `exec_command`, `powershell`      |
| ◎ Radar     | web and MCP tools                          | `WebFetch`, `web_search`, `mcp__*`        |
| ✦ Quests    | planning and sub-agents                    | `TodoWrite`, `Agent`/`Task`, `update_plan`|
| ⚡ Dock      | idle, sleeping or closed sessions          |                                           |

Robot bubbles: `…` thinking · yellow `!` finished its turn, **your turn** · red `?` waiting for
permission · `Zzz` sleeping. The chest light shows the status colour. Sub-agents are small drones
that orbit their parent robot.

## Supported agents

AgentTally only **reads** local log files. It never sends anything anywhere.

| Agent | Where it reads | Detail |
|---|---|---|
| Claude Code (CLI, desktop, IDE) | `~/.claude/projects/*/*.jsonl` (+ `subagents/`) | full: prompts, tools, tokens, titles |
| Codex (CLI / desktop) | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | full: tools (incl. code-mode `exec`), tokens, sub-agents |
| GitHub Copilot CLI | `~/.copilot/session-state/*/events.jsonl` | full: tools, permission prompts, session names |
| GitHub Copilot Chat (VS Code, Insiders, Cursor, VSCodium) | `<config>/Code*/User/workspaceStorage/*/chatSessions/*.jsonl` | prompts, tool invocations, titles |
| Gemini CLI | `~/.gemini/tmp/*/chats/session-*.json` | prompts, tools, tokens |
| Antigravity | `~/.gemini/antigravity*/conversations/*` | presence only (binary format) |
| OpenCode | `~/.local/share/opencode/opencode.db*` | presence only |

`CLAUDE_CONFIG_DIR` and `CODEX_HOME` are respected. Sessions touched in the last 24 hours are
tracked. The UI filters to LIVE / 1H / 6H / 24H.

### How status is derived

- **Working**: a turn is open and something was logged in the last 2 minutes (20 minutes if a
  tool call is still running).
- **Your turn**: the agent ended its turn (e.g. Claude `end_turn`, Codex `task_complete`,
  Copilot final `assistant.turn_end`) less than 20 minutes ago.
- **Needs approval**: a permission or approval request is pending (Copilot CLI, Codex).
- **Idle / Sleeping**: quiet for 20 minutes / 3 hours. **Offline**: the session was shut down.

## Run it

Requirements: Rust (stable), Node 18+, and on Windows the WebView2 runtime (bundled with Windows 11).

```bash
npm install
npm run dev        # desktop app with hot reload of the Rust side
npm run build      # release build + installer in src-tauri/target/release/bundle
```

UI-only preview in a browser, without Tauri:

```bash
npm run preview    # http://localhost:5178/?demo  simulated agents
                   # http://localhost:5178/?live  real logs via the debug binary (cargo build first)
```

Debug the log parsers without the UI:

```bash
cd src-tauri && cargo run -- --dump    # prints one snapshot as JSON
cargo test
```

## Controls

The overview puts **Needs you** first: permission requests, then completed turns. Click an
overview card or a status tab to filter. Overview counts always cover the selected time
window and enabled providers; search, project, and status filters narrow the world,
session list, and activity stream together.

- Search by session title, project, path, provider, client, or model. `/` focuses search.
- Filter by project or provider. **Clear filters** restores all sources and the 6-hour window.
- Sessions default to **Needs you first**, with stable ordering within each status so they
  do not jump around on every log update. Choose **Recently active** or **By project** as needed.
- Select a robot, session, or activity entry to inspect details and wrapped event text.
  Copy the project path or locate the robot from the details panel. Approvals and replies
  still happen in the original agent application.
- Drag to pan, scroll to zoom around the pointer, or use the zoom buttons. `F` fits the world.
- **Motion** pauses animation while snapshots keep updating. Reduced-motion preferences
  are respected. Rendering is capped at 30 fps and stops while the page is hidden.
- `Esc` closes session details; `?` opens the guide. Controls are keyboard accessible.
- Time window, enabled sources, sorting, and motion preferences are saved locally.

The source badge explicitly distinguishes **DEMO**, **LIVE**, and **RECONNECTING**.
Interrupted updates preserve the last snapshot, show a warning, and retry automatically.
Status is inferred from log activity; Antigravity and OpenCode expose file activity only.

## Verification

```bash
npm test           # filters, attention ordering, map fit, zoom, and paused motion
cargo test --manifest-path src-tauri/Cargo.toml
npm run build
```

For browser recovery checks without reading real agent logs, run
`node tests/fixture-server.mjs <absolute-mode-file>` and open
`http://localhost:5179/?live` (set `PORT` to use another port). Put `ready`, `error`, or `empty` in the mode file to exercise
the corresponding snapshot state. This test fixture uses simulated sessions.

## Layout

```
src-tauri/src/
  lib.rs            Tauri setup, background scan loop, `snapshot` command, "tally" event
  scanner.rs        finds session files, tails them incrementally (2 MB replay on first sight;
                    project root, first prompt and parent are read from the head)
  model.rs          Session / Activity / Status, tool → station mapping
  providers/        one parser per agent log format
ui/
  index.html, style.css
  js/world.js       hex map, layout, robots, camera, rendering
  js/sprites.js     pixel art: robots, tiles, buildings, bubbles
  js/main.js        data source, HUD, roster, logs
  js/selectors.js   time, project, provider, search, status, and sorting rules
  js/demo.js        simulated data for ?demo
```

Inspired by pixel-agent visualizers such as
[pixel-agents-standalone](https://github.com/rolandal/pixel-agents-standalone),
[agent-move](https://github.com/ylascaux/agent-move),
[agentroom](https://github.com/liuyixin-louis/agentroom) and
[agent-factory](https://github.com/kalmigs/agent-factory).

Font: Press Start 2P (SIL Open Font License), bundled in `ui/fonts`.
