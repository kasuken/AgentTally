# AgentTally v0.2.5

## A desktop buddy while AgentTally is minimized

Minimize AgentTally and one robot stays on your desktop: just the robot, with no window around it, sitting above the taskbar and on top of your other windows. A thought cloud above its head shows what its agent is doing right now ("Edit: src/lib.rs", "Your turn · …", "Needs your OK"), and the robot acts it out with the same animations as on the islands: a hammer at the Forge, typing sparks at the Terminal, waving and hopping when it is your turn, reading or relaxing on the beach when idle, and `Zzz` when asleep.

- The buddy follows the agent that needs you most. Click the cloud to step through your other agents; after a full round it goes back to **AUTO**.
- Drag the robot to move it, and double-click it to bring AgentTally back.
- Clicks on the empty space around the robot go through to the windows underneath, so it never gets in your way.

This is a first version. It is tested on Windows; on macOS and Linux the transparent window depends on the system, so please report anything that looks off.

**Supported agents:** Claude Code, Codex, GitHub Copilot CLI, GitHub Copilot Chat (VS Code, Insiders, Cursor, VSCodium), Gemini CLI, Antigravity, plus activity-only support for OpenCode. AgentTally only reads local log files and never sends anything anywhere.

## Downloads

| Platform | File |
|---|---|
| Windows | `AgentTally_*_x64-setup.exe` (installer) or `AgentTally_*_x64_en-US.msi` |
| macOS (Apple Silicon) | `AgentTally_*_aarch64.dmg` |
| macOS (Intel) | `AgentTally_*_x64.dmg` |
| Linux | `AgentTally_*_amd64.AppImage`, `AgentTally_*_amd64.deb` or `AgentTally-*.x86_64.rpm` |

The builds are not code-signed yet. See the [install guide](https://github.com/kasuken/AgentTally#install) for how to open them on Windows and macOS.
