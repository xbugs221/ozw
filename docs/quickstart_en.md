# Quick Start

English | [中文](./quickstart.md)

---

This guide will get **ozw** up and running on your local machine or server.

### 1. Prerequisites

- **Node.js 24.17.0**: match `.nvmrc`.
- **pnpm 11.10.0**: match the `packageManager` field in `package.json`; Corepack is recommended.
- **oz**: must be available on the service process `PATH`. ozw checks `oz flow contract --json` during startup, uses `oz list` to discover active changes, and uses `oz flow` to run workflows.
- **Codex/Pi**: not required for the server to start; install and authenticate the selected provider only when you use that chat provider.

```sh
corepack enable
corepack prepare pnpm@11.10.0 --activate
node --version
pnpm --version
oz --version
oz flow contract --json
```

### 2. Clone and Configure

```sh
git clone https://github.com/xbugs221/ozw.git
cd ozw
pnpm install
pnpm run hooks:install
cp .env.example .env
```

Set `JWT_SECRET` in `.env` at minimum. For deployed use, also set `CREDENTIAL_ENCRYPTION_KEY` and confirm `HOST`, `PORT`, and reverse proxy settings.

| Setting | Default | Purpose |
|---|---:|---|
| `PORT` | `3001` | Production Web UI, API, and WebSocket port |
| `VITE_PORT` | `5173` | Frontend dev-server port |
| `HOST` | `0.0.0.0` | Bind address |
| `JWT_EXPIRES_IN` | `24h` | Login token lifetime |
| `OZW_TRUST_LOCALHOST_AUTH` | `true` | Trust the first local user for localhost access |
| `CODEX_SANDBOX_MODE` | `danger-full-access` | Default Codex sandbox policy |
| `CODEX_APPROVAL_POLICY` | `never` | Default Codex approval policy |

### 3. Run

Production or server mode:

```sh
pnpm start
```

`pnpm start` builds the frontend and backend, then serves the static Web UI, API, and WebSocket from `PORT`. Default URL:

```text
http://localhost:3001
```

Development mode:

```sh
pnpm dev
```

Default development URL:

```text
http://localhost:5173
```

On first visit, create the single local user. Once a user exists, localhost access trusts the first local user by default. Set `OZW_TRUST_LOCALHOST_AUTH=false` to require login locally.

### 4. Enable "Relay Coding" (Recommended)

To fully leverage the cross-device benefits, run ozw in a web-accessible environment:

- **Cloud Server:** Run it directly on your remote VPS.
- **Local Workstation:** Use a reverse proxy like `frp`, `nps`, or Cloudflare Tunnel.

Production mode usually only needs `PORT=3001` exposed. Development mode is the case where both frontend `5173` and backend `3001` matter.

Deployment checklist:

| Item | Recommendation |
|---|---|
| Protocol | Use HTTPS for PWA and mobile access |
| Auth | Set a strong `JWT_SECRET`; disable localhost trust when not needed |
| Providers | Make sure the service process can access `oz`, `codex`, and provider auth files |
| Data | Default database path is `~/.ozw/ozw.db`; override with `DATABASE_PATH` |

### 5. Verification

Open ozw in your browser.

1. Confirm the file tree loads your project correctly.
2. Go to the Workflows view and ensure you see active changes read from `oz list --json`.
3. Start an `oz` run and check if you can monitor its progress from another device.
4. If you use Codex/Pi chat, create one manual session for each provider and confirm auth and model discovery work.

---

## Useful Commands

```sh
pnpm run typecheck          # Check frontend, backend, and test types
pnpm run test:fast          # Fast gate: types, unit tests, backend smoke tests
pnpm run test:server        # Backend tests
pnpm run test:e2e:smoke     # Browser smoke tests
pnpm run build              # Production frontend/backend build
```
