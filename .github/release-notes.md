# AgentTally v0.2.1

## Antigravity, step by step

Antigravity sessions used to show a single "Running" entry. AgentTally now reads each conversation's steps, so you see what Antigravity is actually doing, in both the Pixel world and the Pro view:

- Your prompts, the model's reasoning and its replies.
- Every tool call on the right station, with the summary Antigravity writes for it: `run_command` at the Terminal ("Run tests"), `view_file`, `grep_search` and `list_dir` at the Library, file writes and edits at the Forge, web searches at the Radar, tasks and timers at Quests.
- Failed tool calls with their error, and background tasks finishing ("Run dotnet test finished").
- Tool counts and the tool mix now cover the whole conversation.

Works for both the Antigravity IDE and CLI. New steps are read as they arrive; a step that is still being written is picked up once it is complete.

## Fixes

- Old Antigravity conversations could look like they had just finished ("your turn"). Reading a SQLite database touches its `-shm` file, and AgentTally mistook that for activity. Those files are now ignored, databases without a journal are opened without creating any files, and a finished turn is dated by Antigravity itself.
- Tool arguments are recognised regardless of letter case, so file paths and commands show up for more agents.

**Supported agents:** Claude Code, Codex, GitHub Copilot CLI, GitHub Copilot Chat (VS Code, Insiders, Cursor, VSCodium), Gemini CLI, Antigravity, plus activity-only support for OpenCode. AgentTally only reads local log files and never sends anything anywhere.

## Downloads

| Platform | File |
|---|---|
| Windows | `AgentTally_*_x64-setup.exe` (installer) or `AgentTally_*_x64_en-US.msi` |
| macOS (Apple Silicon) | `AgentTally_*_aarch64.dmg` |
| macOS (Intel) | `AgentTally_*_x64.dmg` |
| Linux | `AgentTally_*_amd64.AppImage`, `AgentTally_*_amd64.deb` or `AgentTally-*.x86_64.rpm` |

The builds are not code-signed yet. See the [install guide](https://github.com/kasuken/AgentTally#install) for how to open them on Windows and macOS.
