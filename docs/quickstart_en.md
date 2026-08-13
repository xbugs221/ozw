# Quick Start

English | [中文](./quickstart.md)

---

This guide separates the stable release, candidate-package acceptance, and source development paths. After publication, regular users should install ozw globally from NPM.

## 1. Choose an installation path

### Stable release (preferred after publication)

> **Current status:** `ozw` is the candidate package name. The public NPM package has not been published, and package ownership and release acceptance are still pending. The commands below are the post-release interface; do not install the same name from the public registry yet.

On a supported platform, only Node.js 24 (24.17.0 or newer) or Node.js 26 (26.4.0 or newer) is required:

```sh
npm install -g ozw
ozw --version
ozw
```

Git, pnpm, TypeScript, and frontend build tools are not required.

### Candidate-package acceptance (current release testing)

Install only a `.tgz` supplied by the maintainers or built from this repository. Do not download the same name from the public registry:

```sh
npm install -g ./ozw-VERSION.tgz
ozw --version
ozw
```

Replace `VERSION` with the actual version in the candidate tarball filename.

Candidate packages have not completed release acceptance. When testing an older candidate that predates first-run initialization, pass an explicit 32-character token to that process:

```sh
OZW_ACCESS_TOKEN="$(openssl rand -hex 16)" ozw
```

Include the operating system, architecture, Node.js version, and candidate version in test reports.

## 2. First run and sign-in

The stable release contract is:

1. `ozw` idempotently creates the private user directory `~/.ozw`.
2. When no access token exists, it generates an `OZW_ACCESS_TOKEN` containing exactly 32 characters and writes it to `~/.ozw/.env`.
3. It prints the login URL. An interactive terminal prints a newly generated token once; non-interactive runs never write it to logs, so read it from the private `~/.ozw/.env` file.
4. The server listens only on `127.0.0.1:3001` by default. Open `http://127.0.0.1:3001`, then enter the token; no account registration is required.

Subsequent runs must not replace an existing token, database, or internal JWT secret. Inspect the effective version, paths, and configuration with:

```sh
ozw status
```

Data is stored under `~/.ozw` by default, with SQLite at `~/.ozw/ozw.db`. Keep the database on local storage; do not place the SQLite database on NFS, SMB/CIFS, WebDAV, or another network filesystem.

## 3. Optional capabilities and diagnostics

The base Web workbench does not require `oz`, Codex, or Pi to start. A missing tool disables only its corresponding capability:

| Tool | Capability | Self-check |
|---|---|---|
| `oz` | `oz flow` workflows | `oz --version`, `oz flow contract --json` |
| Codex | Codex sessions | Install, authenticate, and run required services using the official Codex flow |
| Pi | Pi sessions | Install and authenticate using the official Pi flow |

ozw diagnoses these external tools but does not install, authenticate, upgrade, or manage their processes. After startup, use runtime diagnostics in Settings; each missing item affects only its own feature.

`node-pty` is an optional Web-terminal dependency: without it, the base HTTP/Web UI starts normally but terminals are unavailable; reinstall optional dependencies to restore them.

## 4. Configuration and remote access

Explicit environment variables take precedence over `~/.ozw/.env`. Common settings:

| Setting | Default | Purpose |
|---|---:|---|
| `HOST` | `127.0.0.1` | Server bind address |
| `PORT` | `3001` | Web UI, API, and WebSocket port |
| `DATABASE_PATH` | `~/.ozw/ozw.db` | SQLite database path |
| `OZW_HOME` | `~/.ozw` | User configuration and data root; set only in the parent process environment |
| `OZW_ACCESS_TOKEN` | generated on first run | 32-character browser access token |
| `JWT_EXPIRES_IN` | `24h` | Login-token lifetime |

Remote access is optional. When required, explicitly change the bind address and access ozw through a trusted HTTPS reverse proxy or tunnel:

```sh
HOST=0.0.0.0 ozw
```

ozw can read repositories, run shells, and access local provider configuration. Do not expose its port directly to the public Internet. Protect `OZW_ACCESS_TOKEN`, `~/.ozw`, and provider credentials, and restrict access at the reverse proxy. When using HTTPS, the PWA can be added to a phone's home screen.

## 5. Upgrade, rollback, and uninstall

After publication, upgrade to the latest version with:

```sh
npm update -g ozw
```

Install a specific version to roll back the program:

```sh
npm install -g ozw@VERSION
```

For a candidate build, install the newer `.tgz` over the previous version:

```sh
npm install -g ./ozw-NEW_VERSION.tgz
```

Uninstall the program with:

```sh
npm uninstall -g ozw
```

Upgrade, rollback, and uninstall preserve `~/.ozw` by default. To permanently remove all local configuration, tokens, and databases after uninstalling, back them up first and then explicitly delete that directory yourself; ozw never removes it automatically.

## 6. Source development

The source path is for contributors and is not the stable installation method. It requires Git, a Node.js version accepted by `engines.node`, and the pnpm version specified by the `packageManager` field in [package.json](../package.json).

```sh
git clone https://github.com/xbugs221/ozw.git
cd ozw
corepack enable
pnpm install
pnpm run hooks:install
pnpm dev
```

If your Node.js environment does not include Corepack, install it using the official Corepack instructions or install the pnpm version named in `package.json` directly. The first source run also initializes `~/.ozw/.env`. To isolate development data, set `OZW_HOME`:

```sh
OZW_HOME="$PWD/.tmp/ozw-home" pnpm dev
```

Individual settings can also be overridden through process environment variables. Source development normally uses frontend `http://127.0.0.1:5173` and backend `http://127.0.0.1:3001`; the Vite development server has separate bind settings and must not be exposed to the public Internet.

Build and verify the production output with:

```sh
pnpm run build
pnpm start
```

Build a candidate package for local acceptance:

```sh
npm pack
npm install -g ./ozw-VERSION.tgz
```

## 7. Verify and troubleshoot

```sh
ozw --version
ozw status
curl http://127.0.0.1:3001/health
```

Then open the browser, enter the access token, and verify project files, terminals, and any installed provider capabilities. See [Troubleshooting](./troubleshooting_en.md) for common installation, port, sign-in, and provider issues.
