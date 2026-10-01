# AgentTally v0.2.3

## Idle robots take a break

In the Pixel world, idle agents no longer stand still at the dock. After about 30 seconds of being idle, a robot heads out to the coast of its island and picks a pastime:

- **Fishing** from the side of the island, with a rod, a bobber in the water and the occasional fish jumping out.
- **The beach:** relaxing on a towel under an umbrella with a cold drink, eyes closed in the sun now and then.
- **Reading** a book in the shade of a tree.

Every 40 to 80 seconds a robot moves on to another pastime. As soon as its session is busy again, it walks straight back to its station. Agents that need you (waiting or asking for approval) stay at the Core where you can see them, sleeping and offline agents stay at the dock, and islands still disappear after inactivity exactly as before. With motion paused, robots stay where they are.

**Supported agents:** Claude Code, Codex, GitHub Copilot CLI, GitHub Copilot Chat (VS Code, Insiders, Cursor, VSCodium), Gemini CLI, Antigravity, plus activity-only support for OpenCode. AgentTally only reads local log files and never sends anything anywhere.

## Downloads

| Platform | File |
|---|---|
| Windows | `AgentTally_*_x64-setup.exe` (installer) or `AgentTally_*_x64_en-US.msi` |
| macOS (Apple Silicon) | `AgentTally_*_aarch64.dmg` |
| macOS (Intel) | `AgentTally_*_x64.dmg` |
| Linux | `AgentTally_*_amd64.AppImage`, `AgentTally_*_amd64.deb` or `AgentTally-*.x86_64.rpm` |

The builds are not code-signed yet. See the [install guide](https://github.com/kasuken/AgentTally#install) for how to open them on Windows and macOS.
