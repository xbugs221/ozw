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

![Main interface](assets/1.png)

![File manager, terminal, and main interface](assets/2.png)

### Current Capabilities

| Area | What it does |
|---|---|
| Manual sessions | Create, continue, and inspect Codex/Pi sessions in the browser |
| Workflows | Read, start, resume, and abort `oz flow` runs |
| Project workbench | File tree, code editor, terminal, and project overview |
| Realtime sync | Stream session output, tool calls, and workflow state over WebSocket |
| Self-hosting | Supports local use, servers, reverse proxies, and PWA installation |

### Quick Start

> **Release status:** `ozw` is the current candidate package name. The public NPM package has not been published, and package ownership and release acceptance are still pending. The registry commands below are the **post-release interface**; do not install the same name from the public registry yet.

After publication, use the global install path:

```sh
npm install -g ozw
ozw
```

Before publication, install only a candidate tarball supplied by the maintainers:

```sh
npm install -g ./ozw-VERSION.tgz
ozw
```

The first run creates `~/.ozw`, generates a 32-character `OZW_ACCESS_TOKEN`, and prints the login URL. An interactive terminal prints a newly generated token once; non-interactive runs such as systemd or redirected output never write it to logs. Read it from `~/.ozw/.env`. The default URL is `http://127.0.0.1:3001` and is local-only.

`oz`, Codex, and Pi are optional, capability-specific dependencies. Missing tools do not prevent the workbench from starting; they disable only the corresponding workflows or sessions. Check runtime diagnostics in Settings after startup.

`node-pty` is an optional Web-terminal dependency: without it, the base HTTP/Web UI starts normally but terminals are unavailable; reinstall optional dependencies to restore them.

Remote access requires an explicit bind-address change and a trusted HTTPS reverse proxy or tunnel. Never expose ozw directly to the public Internet: it can access repositories, terminals, and provider credentials.

Upgrade and uninstall with:

```sh
npm update -g ozw
npm uninstall -g ozw
```

Both upgrade and uninstall preserve configuration and databases under `~/.ozw`. See the [Quick Start](docs/quickstart_en.md) for source development, candidate-package acceptance, remote access, and data removal; see [Troubleshooting](docs/troubleshooting_en.md) for common failures and [CHANGELOG.md](CHANGELOG.md) for release changes.

When accessed over HTTPS, the PWA can be added to a phone's home screen.

---

## ⚖️ License

ozw is distributed under the **GPL-3.0** license. See [LICENSE](LICENSE).
