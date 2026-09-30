# AgentTally v0.2.2

## See what your sub-agents are doing

When an agent hands work to sub-agents (for example Claude Code background agents), the main agent can already be waiting for you while its sub-agents keep working. AgentTally now makes that visible:

- **Pixel world:** a working sub-agent drone flies to the station of its *own* activity (the Forge while writing, the Terminal while running commands, the Library while reading) with a dotted tether back to its parent. Idle drones return to orbit their parent. Drones have a new sprite with a rotor, agent colours and a status light, and the parent robot shows one pip per busy sub-agent.
- **Party list:** sub-agents are nested directly under their parent with a connector, a drone portrait, a SUB-AGENT tag and their role. The parent card says "2 sub-agents working". Session details show which agent a sub-agent belongs to, and how many sub-agents a parent has.
- **Pro view:** sub-agent rows are badged "Sub-agent · role" and parents show how many of their sub-agents are working.
- **Better names:** Claude Code sub-agents are named after their task ("Build backend foundation") instead of the first line of their prompt.

## Fixes

- Claude Code agents no longer jump back to the Core after every tool result; they stay at the tool's station until their next step.

**Supported agents:** Claude Code, Codex, GitHub Copilot CLI, GitHub Copilot Chat (VS Code, Insiders, Cursor, VSCodium), Gemini CLI, Antigravity, plus activity-only support for OpenCode. AgentTally only reads local log files and never sends anything anywhere.

## Downloads

| Platform | File |
|---|---|
| Windows | `AgentTally_*_x64-setup.exe` (installer) or `AgentTally_*_x64_en-US.msi` |
| macOS (Apple Silicon) | `AgentTally_*_aarch64.dmg` |
| macOS (Intel) | `AgentTally_*_x64.dmg` |
| Linux | `AgentTally_*_amd64.AppImage`, `AgentTally_*_amd64.deb` or `AgentTally-*.x86_64.rpm` |

The builds are not code-signed yet. See the [install guide](https://github.com/kasuken/AgentTally#install) for how to open them on Windows and macOS.
