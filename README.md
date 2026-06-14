# ozw - AI Coding Relay Station (based on ccui)

English | [中文](./README_zh.md)

---

**ozw** is a Web-based workbench evolved from `ccui`. It deeply integrates the `openspec` / `oz` ecosystem for proposal-driven automated coding tasks.

### The Problem We Solve (Core Benefit)

Traditional agentic coding is usually tethered to a single machine—locked inside a terminal session or a specific IDE plugin. If you leave your desk, switch laptops, or want to check progress on your phone, you're out of luck.

**The biggest win with ozw: Agentic coding is no longer bound to a single terminal or IDE.**

ozw turns your coding tasks into persistent, resumable Web sessions. When combined with reverse proxies like `frp` or `Cloudflare Tunnel`, it enables **Relay Coding**:

1. **At the Office:** Start a long-running `oz` task on your workstation or server.
2. **On the Move:** Check the agent's real-time logs and tool calls via your phone's browser.
3. **At Home:** Pick up exactly where you left off on your laptop, review the code, and finalize the PR.

### Quick Start

1. **Prerequisites:** Node.js 22+, pnpm 10.33+, and `oz` installed on your `PATH`.
2. **Launch:**

   ```sh
   pnpm install
   pnpm start
   ```

3. **Go Global (Recommended):** Map your local ports (default 5173/3001) to the public web using `frp` to enable cross-device relay.

See [docs/quickstart.md](docs/quickstart.md) for more details.

---

## ⚖️ License

ozw is distributed under the **GPL-3.0** license. See [LICENSE](LICENSE).
