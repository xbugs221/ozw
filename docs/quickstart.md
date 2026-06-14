# Quick Start

English | [中文](./quickstart_zh.md)

---

This guide will get **ozw** up and running on your local machine or server.

### 1. Prerequisites
- **Node.js 22+** and **pnpm 10.33+**.
- **oz**: Must be installed on your system `PATH`. ozw relies on it for `openspec` proposals and workflow execution.

### 2. Setup and Run
```sh
git clone https://github.com/xbugs221/ozw.git
cd ozw
pnpm install
pnpm start
```
`pnpm start` builds both frontend and backend and launches the service.

### 3. Enable "Relay Coding" (Recommended)
To fully leverage the cross-device benefits, run ozw in a web-accessible environment:
- **Cloud Server:** Run it directly on your remote VPS.
- **Local Workstation:** Use a reverse proxy like `frp`, `nps`, or `Cloudflare Tunnel`.

**Example (frp):**
Map your local 5173 (frontend) and 3001 (backend) ports to a public domain.

### 4. Verification
Open ozw in your browser.
1. Confirm the file tree loads your project correctly.
2. Go to the Workflows view and ensure you see active changes listed by `oz`.
3. Start an `oz` run and check if you can monitor its progress from another device.

---

## 🚀 Useful Commands

```sh
pnpm typecheck      # Check for type errors
pnpm test:server    # Run backend tests
pnpm test:e2e       # Run browser tests
```
