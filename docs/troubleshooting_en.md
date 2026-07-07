# Troubleshooting

English | [中文](./troubleshooting.md)

---

When something breaks, check in this order: runtime dependencies, workflow state, provider auth, ports, and login configuration.

### 1. `oz` is missing

If ozw will not start, double-check your tools:

```sh
oz --version
oz flow contract --json
```

Make sure it is on the service process `PATH`. systemd, containers, and reverse proxy launch scripts may not have the same `PATH` as your interactive terminal.

### 2. Workflows are not showing up

ozw uses `oz list --json` to discover active changes that can be adopted by workflows. First confirm that `oz` itself sees the project changes:

```sh
oz list --json
```

If your changes do not appear there, they will not appear in ozw either.

### 3. Workflow state looks stuck or wrong

The real source of truth is `oz flow` output and the local state files. If the UI seems out of sync, check the concrete run id:

```sh
oz flow status --run-id <run-id> --json
```

Then inspect the ozw server logs.

### 4. Chat provider (Codex/Pi) is not working

ozw does not authenticate providers for you. Codex requires a usable, authenticated local `codex app-server`; Pi requires the native Pi runtime to find its account auth.

- **Fix:** Log in through the selected provider's official flow, restart ozw, and check provider diagnostics in Settings.

### 5. Frontend will not open

Check your terminal logs for the correct URL.

| Mode | Default URL |
|---|---|
| `pnpm start` | `http://localhost:3001` |
| `pnpm dev` | `http://localhost:5173` |

If a port is taken, change `PORT` or `VITE_PORT` in `.env`.

### 6. Installation fails (native dependencies)

ozw uses some native packages such as `node-pty`. If `pnpm install` fails, make sure you have a C++ compiler and Node.js headers installed on your machine.

### 7. Login or first setup fails

Make sure `.env` sets `JWT_SECRET`. It is required for login tokens; deployed instances should use at least 32 random bytes.

### 8. Localhost bypass works, but public access still requires login

By default, `OZW_TRUST_LOCALHOST_AUTH=true`, so `localhost` access trusts the first existing local user. Public access is not automatically bypassed by this setting. To require login locally too, set:

```sh
OZW_TRUST_LOCALHOST_AUTH=false
```

---

## Need More Help?

Still stuck? Check the server logs in your terminal or [open an issue](https://github.com/xbugs221/ozw/issues).
