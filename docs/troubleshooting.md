# Troubleshooting

English | [中文](./troubleshooting_zh.md)

---

Something not working? Here are the most common hiccups and how to fix them.

### 1. `oz` is missing
If ozw won't start, double-check your tools:
```sh
oz --version
```
Make sure it is in your `PATH`. ozw needs to find it exactly as you do in your terminal.

### 2. Workflows aren't showing up
ozw only shows active changes that `oz` knows about. Run this to check:
```sh
oz list --json
```
If your changes don't appear there, they won't appear in ozw either.

### 3. Workflow state looks "stuck" or wrong
The real source of truth for workflow execution comes from `oz`. If the UI seems out of sync, check the `oz` status output or peek at the server logs.

### 4. Chat provider (Codex/Pi) isn't working
ozw doesn't log you in; it just reads your existing session.
- **Fix:** Log in via the provider's own CLI or website, then restart ozw.

### 5. Frontend won't open
Check your terminal logs for the correct URL. Usually it's:
**http://localhost:5173**
If the port is taken, you can change it by setting the `PORT` or `VITE_PORT` environment variable.

### 6. Installation fails (Native dependencies)
ozw uses some "native" parts (like `node-pty`). If `pnpm install` fails, make sure you have a C++ compiler and Node.js headers installed on your machine.

---

## 🛠 Need More Help?

Still stuck? Check the server logs in your terminal or [open an issue](https://github.com/xbugs221/ozw/issues).
