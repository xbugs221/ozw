# ozw - AI Coding Relay Station (based on ccui)

English | [中文](./README.md)

---

**ozw** is a Web-based workbench evolved from `ccui`. It deeply integrates the `openspec` / `oz` ecosystem for proposal-driven automated coding tasks.

### The Problem We Solve (Core Benefit)

Traditional agentic coding is usually tethered to a single machine: locked inside a terminal session or a specific IDE plugin. If you leave your desk, switch laptops, or want to check progress on your phone, you're out of luck.

**The biggest win with ozw: Agentic coding is no longer bound to a single terminal or IDE.**

ozw turns your coding tasks into persistent, resumable Web sessions. When combined with reverse proxies like `frp` or `Cloudflare Tunnel`, it enables **Relay Coding**:

1. **At the Office:** Start a long-running `oz` task on your workstation or server.
2. **On the Move:** Check the agent's real-time logs and tool calls via your phone's browser.
3. **At Home:** Pick up exactly where you left off on your laptop, review the code, and finalize the PR.

### Quick Start

1. **Prepare the base runtime:** Node.js 22+ and pnpm 10.33+ are required.

2. **Install `oz`:** ozw depends on `oz flow` for workflow discovery and execution, so `oz` must be available on your `PATH`.

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

3. **Install and log in to the Codex / Pi CLIs:** ozw reuses existing local provider sessions. It does not log in to providers for you. Before starting ozw, install both CLIs and log in on the same machine:

   ```sh
   codex login
   pi login
   codex --version
   pi --version
   ```

4. **Launch ozw:**

   ```sh
   pnpm install
   cp .env.example .env
   # change JWT_SECRET there
   pnpm start
   ```

5. **Go Global (Recommended):** Map your local ports (default 5173/3001) to the public web using `frp` to enable cross-device relay.

See [docs/quickstart_en.md](docs/quickstart_en.md) for more details.

---

## ⚖️ License

ozw is distributed under the **GPL-3.0** license. See [LICENSE](LICENSE).
