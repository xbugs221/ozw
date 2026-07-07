# ozw - Local AI Coding Relay Station

English | [中文](./README.md)

---

**ozw** is a local Web workbench for Codex, Pi, and [oz](https://github.com/xbugs221/oz) workflows. It evolved from [claudecodeui](https://github.com/siteboon/claudecodeui) and now focuses on putting agent coding sessions, `oz flow` workflows, project files, terminals, and cross-device access into one browser UI.

### The Problem We Solve (Core Benefit)

Traditional agentic coding is usually tethered to a single machine: locked inside a terminal session or a specific IDE plugin. If you leave your desk, switch laptops, or want to check progress on your phone, you're out of luck.

**The biggest win with ozw: Agentic coding is no longer bound to a single terminal or IDE.**

ozw turns your coding tasks into persistent, resumable Web sessions. When combined with reverse proxies like `frp`, `nps`, or Cloudflare Tunnel, it enables **Relay Coding**:

1. **At the Office:** Start a long-running `oz` task on your workstation or server.
2. **On the Move:** Check the agent's real-time logs and tool calls via your phone's browser.
3. **At Home:** Pick up exactly where you left off on your laptop, review the code, and finalize the PR.

### Current Capabilities

| Area | What it does |
|---|---|
| Manual sessions | Create, continue, and inspect Codex/Pi sessions in the browser |
| Workflows | Read, start, resume, and abort `oz flow` runs |
| Project workbench | File tree, code editor, terminal, and project overview |
| Realtime sync | Stream session output, tool calls, and workflow state over WebSocket |
| Self-hosting | Supports local use, servers, reverse proxies, and PWA installation |

### Quick Start

1. **Prepare the base runtime:** Node.js 22+ and pnpm 11.10.0 are required, matching the `packageManager` field in `package.json`.

   ```sh
   corepack enable
   corepack prepare pnpm@11.10.0 --activate
   node --version
   pnpm --version
   ```

2. **Install `oz`:** ozw checks `oz flow contract --json` during startup, uses `oz list` to discover active changes, and uses `oz flow` to run workflows, so `oz` must be available on the service process `PATH`.

   Option A: download the binary for your OS and architecture from [oz Releases](https://github.com/xbugs221/oz/releases), then make it executable:

   ```sh
   mkdir -p ~/.local/bin
   mv ~/Downloads/oz ~/.local/bin/oz
   chmod +x ~/.local/bin/oz
   oz --version
   ```

   If your shell still cannot find `oz`, add `~/.local/bin` to `PATH`.

   Option B: install directly with Go:

   ```sh
   go install github.com/xbugs221/oz@latest
   oz --version
   ```

3. **Prepare chat providers:** ozw only requires `oz` to start. To use Codex or Pi manual chat, install and authenticate the selected provider on the same machine using that provider's official flow. Codex sessions run through `codex app-server`; Pi sessions run through the native Pi runtime.

4. **Launch ozw:**

   ```sh
   pnpm install
   cp .env.example .env
   # set JWT_SECRET at minimum; set CREDENTIAL_ENCRYPTION_KEY for deployed use
   pnpm start
   ```

   `pnpm start` builds the frontend and backend, then serves the Web UI, API, and WebSocket from `PORT=3001` by default. On first visit, create the single local user. Localhost access trusts the first existing user by default; set `OZW_TRUST_LOCALHOST_AUTH=false` to require login locally.

   For development, run the split dev servers:

   ```sh
   pnpm dev
   ```

   Development mode defaults to frontend `5173` and backend `3001`; production mode usually only needs `3001` exposed.

5. **Go Global (Recommended):** Map the service port to an HTTPS domain with `frp`, `nps`, or Cloudflare Tunnel to enable cross-device relay.

See [docs/quickstart_en.md](docs/quickstart_en.md) for more details.

---

## ⚖️ License

ozw is distributed under the **GPL-3.0** license. See [LICENSE](LICENSE).
