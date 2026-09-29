# AgentTally v0.2.0

## A Pro view, next to the pixel world

AgentTally now has two interfaces over the same data. The 16-bit hex world stays the default; press **Pro view** in the top bar (or <kbd>U</kbd>) for a calm workspace dashboard:

- One panel per project, with approvals and completed turns first.
- One row per session: status, agent, current activity, a **30-minute activity timeline** coloured by what the agent was doing (think, read, edit, run, web, plan), tool mix, tool count and last seen.
- Sub-agents indented under their parent session.
- Search, filters, sorting, session details and the activity log work the same in both views. The selected session and your choice of view are kept.

![The Pro workspace view](https://raw.githubusercontent.com/kasuken/AgentTally/main/docs/screenshots/pro.png)

## Better Antigravity support

- Each Antigravity conversation now appears **once**. Previously its database and journal files (`.db`, `.db-wal`, `.db-shm`) each showed up as a separate session.
- Sessions show the conversation **title**, the real **project folder** and the actual **run status** (running, your turn, stopped), read from Antigravity's conversation summaries. Sub-agent conversations appear under their parent, and the prompts you typed in the CLI show up in the activity log.

## Fixes

- A project used by several agents (for example Claude Code and Copilot Chat in VS Code) now lands on one island instead of two.
- Project paths from file links keep their leading `/` on macOS and Linux.
- OpenCode no longer risks showing the same session twice.
- Also includes everything from v0.1.1: clearer island buildings, separated coastlines and the station guide.

**Supported agents:** Claude Code, Codex, GitHub Copilot CLI, GitHub Copilot Chat (VS Code, Insiders, Cursor, VSCodium), Gemini CLI, Antigravity, plus activity-only support for OpenCode. AgentTally only reads local log files and never sends anything anywhere.

## Downloads

| Platform | File |
|---|---|
| Windows | `AgentTally_*_x64-setup.exe` (installer) or `AgentTally_*_x64_en-US.msi` |
| macOS (Apple Silicon) | `AgentTally_*_aarch64.dmg` |
| macOS (Intel) | `AgentTally_*_x64.dmg` |
| Linux | `AgentTally_*_amd64.AppImage`, `AgentTally_*_amd64.deb` or `AgentTally-*.x86_64.rpm` |

The builds are not code-signed yet. See the [install guide](https://github.com/kasuken/AgentTally#install) for how to open them on Windows and macOS.
