# AgentTally v0.2.4

## Robots on "Your turn" take a break too

In v0.2.3 only idle robots went off to fish, relax on the beach or read. Now a robot whose turn is done ("Your turn") does the same after about 30 seconds. It keeps its yellow "!" bubble while it is out, so you can still see that it is waiting for you. A robot asking for approval stays at the Core, and every robot walks straight back to its station as soon as its session is busy again.

## Fixes

- **Copilot Chat (VS Code):** a finished chat could keep showing "Working" for up to 20 minutes. VS Code writes the end of a reply after marking the request as finished, and that last part can include one more tool call, which AgentTally mistook for new work. A finished request now stays finished.

**Supported agents:** Claude Code, Codex, GitHub Copilot CLI, GitHub Copilot Chat (VS Code, Insiders, Cursor, VSCodium), Gemini CLI, Antigravity, plus activity-only support for OpenCode. AgentTally only reads local log files and never sends anything anywhere.

## Downloads

| Platform | File |
|---|---|
| Windows | `AgentTally_*_x64-setup.exe` (installer) or `AgentTally_*_x64_en-US.msi` |
| macOS (Apple Silicon) | `AgentTally_*_aarch64.dmg` |
| macOS (Intel) | `AgentTally_*_x64.dmg` |
| Linux | `AgentTally_*_amd64.AppImage`, `AgentTally_*_amd64.deb` or `AgentTally-*.x86_64.rpm` |

The builds are not code-signed yet. See the [install guide](https://github.com/kasuken/AgentTally#install) for how to open them on Windows and macOS.
