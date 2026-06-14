# Contributing

English | [中文](./CONTRIBUTING_zh.md)

---

Thanks for helping out! **ozw** is a focused workbench for agentic coding, so we like to keep things simple, testable, and reliable.

### Before you start
- **Open an Issue:** If you're planning a big change or refactor, let's talk about it in an issue first.
- **Keep it Small:** Smaller PRs are much easier to review and merge.
- **Don't break state:** Make sure your changes don't break existing user data or workflow states.

### Development Setup
```sh
pnpm install
pnpm dev
```
You'll need Node 22, pnpm 10.33+, and the `oz` tool installed.

### Testing
We love tests! Please add tests that describe **real user behavior**, not just checking if a button exists.
- `pnpm typecheck` - Run this every time.
- `pnpm test:server` - For backend logic.
- `pnpm test:e2e` - For UI and full-flow changes.

---

## 💡 Code Style
- Follow existing TypeScript and React patterns.
- Keep it simple, avoid over-abstraction.
- Add comments only to explain "why", not "what".
