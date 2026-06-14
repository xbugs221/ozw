# Contributing

English | [中文](./CONTRIBUTING.md)

---

Thanks for helping out! **ozw** is a focused workbench for agentic coding, so we like to keep things simple, testable, and reliable.

### Before you start
- **Open an Issue:** If you are planning a big change or refactor, let's talk about it in an issue first.
- **Keep it Small:** Smaller PRs are much easier to review and merge.
- **Do not break state:** Make sure your changes do not break existing user data or workflow states.

### Development Setup
```sh
pnpm install
pnpm dev
```
You will need Node 22, pnpm 10.33+, and the `oz` tool installed.

### Testing
We value tests. Please add tests that describe **real user behavior**, not just checks that a button exists.
- `pnpm typecheck` - Run this every time.
- `pnpm test:server` - For backend logic.
- `pnpm test:e2e` - For UI and full-flow changes.

---

## 💡 Code Style
- Follow existing TypeScript and React patterns.
- Keep it simple, avoid over-abstraction.
- Add comments only to explain "why", not "what".
