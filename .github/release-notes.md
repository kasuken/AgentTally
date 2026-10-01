# AgentTally v0.2.6

## One desktop buddy for all your agents

The desktop buddy from v0.2.5 showed one agent at a time. Now it is AgentTally's own robot, pink with a gold crown, and it reports on all your agents at once while AgentTally is minimized.

- **The cloud** starts with a count of your agents by state (needs OK, your turn, working, idle), then lists what each busy agent is doing right now, with its project: "AgentTally · Edit: src/lib.rs", "shop-api · your turn". Agents that need you come first, up to four lines, then "+N more busy". A line flashes when its agent moves on to something new.
- **The robot** acts out the overall picture: it waves and hops when any agent needs you, plays the tool animation of whichever agent acted last while any are working, reads or relaxes on the beach when they are all idle, and shows `Zzz` when they are all asleep.
- Click the cloud or double-click the robot to bring AgentTally back. Drag the robot to move it. Clicks on the empty space around it still go through to the windows underneath.

The buddy is tested on Windows; on macOS and Linux the transparent window depends on the system, so please report anything that looks off.

**Supported agents:** Claude Code, Codex, GitHub Copilot CLI, GitHub Copilot Chat (VS Code, Insiders, Cursor, VSCodium), Gemini CLI, Antigravity, plus activity-only support for OpenCode. AgentTally only reads local log files and never sends anything anywhere.

## Downloads

| Platform | File |
|---|---|
| Windows | `AgentTally_*_x64-setup.exe` (installer) or `AgentTally_*_x64_en-US.msi` |
| macOS (Apple Silicon) | `AgentTally_*_aarch64.dmg` |
| macOS (Intel) | `AgentTally_*_x64.dmg` |
| Linux | `AgentTally_*_amd64.AppImage`, `AgentTally_*_amd64.deb` or `AgentTally-*.x86_64.rpm` |

The builds are not code-signed yet. See the [install guide](https://github.com/kasuken/AgentTally#install) for how to open them on Windows and macOS.
