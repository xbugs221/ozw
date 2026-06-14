// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Start and stop isolated local CCUI processes for Playwright e2e.
 * This bypasses Playwright's built-in webServer health probe because on this
 * machine a TCP connect to an unused localhost port can hang instead of failing fast.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Create a fake oz binary for the isolated Playwright server process.
 * The script operates on real fixture docs/changes and workflow user-state files.
 * @param {string} cwd - Repository root.
 * @returns {string} Directory to prepend to PATH.
 */
function ensureWorkflowToolFixtures(cwd) {
  const binDir = path.join(cwd, '.tmp', 'playwright-workflow-bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, 'oz'),
    [
      '#!/bin/sh',
      'PATH="/usr/bin:/bin:$PATH"',
      'changes_dir="$PWD/docs/changes"',
      'case "$1" in',
      '  --version) echo "oz-playwright";;',
      '  list)',
      "    printf '{\"changes\":['",
      '    first=1',
      '    if [ -d "$changes_dir" ]; then',
      '      for entry in "$changes_dir"/*; do',
      '        [ -d "$entry" ] || continue',
      '        [ "$(basename "$entry")" = "archive" ] && continue',
      '        if [ "$first" -eq 0 ]; then printf ","; fi',
      '        first=0',
      "        printf '{\"name\":\"%s\"}' \"$(basename \"$entry\")\"",
      '      done',
      '    fi',
      "    printf ']}\\n';;",
      '  status)',
      '    if [ -d "$changes_dir/$2" ]; then printf \'{"name":"%s","status":"active"}\\n\' "$2"; else exit 1; fi;;',
      '  instructions) echo \'{"schemaName":"spec-driven","state":"ready","contextFiles":[],"progress":{"total":0,"completed":0,"remaining":0},"tasks":[]}\';;',
      '  validate) echo \'{"ok":true}\';;',
      '  archive) mkdir -p "$changes_dir/archive"; mv "$changes_dir/$2" "$changes_dir/archive/2026-05-06-$2"; echo \'{"ok":true}\';;',
      '  flow)',
      '    shift',
      '    run_id="playwright-run-$(date +%s%N)"',
      '    if [ "$1" = "contract" ]; then echo \'{"version":"oz-flow-playwright","json":true,"capabilities":["list-changes","run","resume","status","abort","graph"]}\'; exit 0; fi',
      '    if [ "$1" = "list-changes" ]; then oz list --json; exit 0; fi',
      '    if [ "$1" = "run" ]; then',
      '  change=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--change" ]; then shift; change="$1"; fi',
      '    shift || break',
      '  done',
      '  repo_path="$(pwd -P)"',
      '  repo_base="$(basename "$repo_path" | tr "[:upper:]" "[:lower:]" | sed -E "s/[^a-z0-9]+/-/g; s/^-+//; s/-+$//")"',
      '  if [ -z "$repo_base" ]; then repo_base="repo"; fi',
      '  repo_hash="$(printf "%s" "$repo_path" | sha1sum | cut -c1-10)"',
      '  run_dir="${XDG_STATE_HOME}/oz/flow/repos/${repo_base}-${repo_hash}/runs/$run_id"',
      '  mkdir -p "$run_dir/logs"',
      '  echo "playwright runner log" > "$run_dir/logs/executor.log"',
      '  cat > "$run_dir/state.json" <<JSON',
      '{"run_id":"$run_id","change_name":"$change","status":"running","stage":"execution","stages":{"execution":"running"},"paths":{"executor_log":".wo/runs/$run_id/logs/executor.log"},"sessions":{"execution":"codex-exec-thread"},"error":""}',
      'JSON',
      '  printf \'{"run_id":"%s","change_name":"%s","status":"running","stage":"execution"}\\n\' "$run_id" "$change"',
      '  (',
      '    sleep 2',
      '    echo "playwright review log" > "$run_dir/logs/reviewer.log"',
      '    cat > "$run_dir/state.json" <<JSON',
      '{"run_id":"$run_id","change_name":"$change","status":"running","stage":"review_1","stages":{"execution":"completed","review_1":"running"},"paths":{"executor_log":".wo/runs/$run_id/logs/executor.log","reviewer_log":".wo/runs/$run_id/logs/reviewer.log"},"sessions":{"execution":"codex-exec-thread","review_1":"codex-review-thread"},"error":""}',
      'JSON',
      '  ) >/dev/null 2>&1 &',
      '  exit 0',
      '    fi',
      '    if [ "$1" = "graph" ]; then',
      '  change=""',
      '  fmt=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--change" ]; then shift; change="$1"; fi',
      '    if [ "$1" = "--format" ]; then shift; fmt="$1"; fi',
      '    shift || break',
      '  done',
      '  if [ "$fmt" = "json" ]; then',
      '    printf \'{"change_name":"%s","display":{"title":"wo workflow: %s"},"nodes":[{"id":"execution","name":"execution","type":"main_stage","stage":"execution"},{"id":"review_1","name":"review_1","type":"main_stage","stage":"review_1","iteration":1},{"id":"gate_review_1","name":"review gate","type":"gate","stage":"review_1","iteration":1},{"id":"qa_1","name":"qa_1","type":"main_stage","stage":"qa_1","iteration":1},{"id":"gate_qa_1","name":"QA gate","type":"gate","stage":"qa_1","iteration":1},{"id":"fix_1","name":"fix_1","type":"main_stage","stage":"fix_1","iteration":1},{"id":"archive","name":"archive","type":"main_stage","stage":"archive"}],"edges":[{"from":"execution","to":"review_1"},{"from":"review_1","to":"gate_review_1"},{"from":"gate_review_1","to":"qa_1","label":"review clean"},{"from":"qa_1","to":"gate_qa_1"},{"from":"gate_qa_1","to":"fix_1","label":"QA needs_fix"},{"from":"fix_1","to":"archive"}],"artifacts":[{"id":"planning_context_fanin_artifact","path":"parallel-planning_context.json","node_id":"planning_context_fanin"},{"id":"review_gate_artifact","path":"review-1.json","node_id":"gate_review_1"},{"id":"review_gate_graph_only_artifact","path":"graph-only-extra.json","node_id":"gate_review_1"},{"id":"qa_gate_artifact","path":"qa-1.json","node_id":"gate_qa_1"},{"id":"fix_summary_artifact","path":"fix-1-summary.md","node_id":"fix_1"},{"id":"archive_artifact","path":"delivery-summary.md","node_id":"archive"}],"gates":[{"id":"gate_review_1","name":"review gate","stage":"review_1","iteration":1},{"id":"gate_qa_1","name":"QA gate","stage":"qa_1","iteration":1}]}\\n\' "$change" "$change"',
      '  fi',
      '  exit 0',
      '    fi',
      '    if [ "$1" = "status" ]; then',
      '  run=""',
      '  json=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--run-id" ]; then shift; run="$1"; fi',
      '    if [ "$1" = "--json" ]; then json="1"; fi',
      '    shift || break',
      '  done',
      '  if [ -n "$run" ] && [ "$json" = "1" ]; then',
      '    state_file="$(find "$XDG_STATE_HOME/oz/flow" -path "*/runs/$run/state.json" -type f -print -quit 2>/dev/null)"',
      '    if [ -n "$state_file" ]; then',
      '      cat "$state_file"',
      '      exit 0',
      '    fi',
      '    printf \'{"run_id":"%s","status":"running","stage":"execution","stages":{"execution":"running"},"paths":{},"sessions":{},"error":""}\\n\' "$run"',
      '    exit 0',
      '  fi',
      '  echo "usage: oz flow status --run-id <run-id> --json"',
      '  exit 0',
      '    fi',
      '    if [ "$1" = "resume" ] || [ "$1" = "abort" ]; then echo "usage: oz flow $1 --json --run-id"; exit 0; fi',
      '    echo "usage: oz flow run resume status abort graph --json --run-id --change";;',
      '  *) echo \'{}\';;',
      'esac',
    ].join('\n'),
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(binDir, 'co'),
    [
      '#!/bin/sh',
      'if [ "$1" = "doctor" ] && [ "$2" = "--json" ]; then',
      '  printf \'{"ok":true,"contract":"co-request-v1","version":"playwright","home":"%s","providers":{"codex":true,"pi":true}}\\n\' "${CCFLOW_CO_HOME:-$HOME/.local/state/ozw/co}"',
      '  exit 0',
      'fi',
      'echo "usage: co doctor --json" >&2',
      'exit 1',
    ].join('\n'),
    { mode: 0o755 },
  );
  return binDir;
}

/**
 * Start a tiny fake co daemon for browser specs. It owns only the external co
 * contract boundary: pending request files in, conversation state/events out.
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} childEnv
 * @returns {import('node:child_process').ChildProcess}
 */
function startFakeCoDaemon(cwd, childEnv) {
  const scriptPath = path.join(cwd, '.tmp', 'playwright-fake-co-daemon.mjs');
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(
    scriptPath,
    [
      "import fs from 'node:fs';",
      "import path from 'node:path';",
      "const coHome = process.env.CCFLOW_CO_HOME;",
      "const seen = new Set();",
      "const seenRequestIds = new Set();",
      "const queues = new Map();",
      "const active = new Set();",
      "const cancelledTurns = new Set();",
      "const delayMs = Number.parseInt(process.env.CCFLOW_FAKE_CO_DELAY_MS || '5000', 10);",
      "function writeJson(filePath, value) {",
      "  fs.mkdirSync(path.dirname(filePath), { recursive: true });",
      "  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\\n`, 'utf8');",
      "}",
      "function appendEvent(turnId, event) {",
      "  const eventPath = path.join(coHome, 'turns', turnId, 'events.jsonl');",
      "  fs.mkdirSync(path.dirname(eventPath), { recursive: true });",
      "  fs.appendFileSync(eventPath, `${JSON.stringify(event)}\\n`, 'utf8');",
      "}",
      "function finishTurn(request, turnId) {",
      "  if (cancelledTurns.has(turnId)) return;",
      "  const conversationDir = path.join(coHome, 'conversations', request.conversation_id);",
      "  const turnDir = path.join(coHome, 'turns', turnId);",
      "  appendEvent(turnId, { type: `${request.provider}-response`, provider: request.provider, turn_id: turnId, conversation_id: request.conversation_id, session_id: `provider_${request.conversation_id}`, data: { type: 'item', itemType: 'agent_message', message: { content: `fake co response: ${request.text}` } } });",
      "  appendEvent(turnId, { type: `${request.provider}-complete`, provider: request.provider, turn_id: turnId, conversation_id: request.conversation_id, session_id: `provider_${request.conversation_id}` });",
      "  writeJson(path.join(turnDir, 'state.json'), { contract: 'co-turn-v1', turn_id: turnId, conversation_id: request.conversation_id, provider: request.provider, status: 'completed' });",
      "  writeJson(path.join(conversationDir, 'state.json'), { contract: 'co-conversation-v1', conversation_id: request.conversation_id, project_path: request.project_path, provider: request.provider, provider_session_id: `provider_${request.conversation_id}`, active_turn_id: '', status: 'completed', updated_at: new Date().toISOString(), turns: [turnId] });",
      "  active.delete(request.conversation_id);",
      "  processNext(request.conversation_id);",
      "}",
      "function startTurn(request) {",
      "  const turnId = `turn_${request.request_id}`;",
      "  const conversationDir = path.join(coHome, 'conversations', request.conversation_id);",
      "  const turnDir = path.join(coHome, 'turns', turnId);",
      "  fs.mkdirSync(conversationDir, { recursive: true });",
      "  fs.mkdirSync(turnDir, { recursive: true });",
      "  if (request.op === 'abort') {",
      "    writeJson(path.join(turnDir, 'request.json'), request);",
      "    const statePath = path.join(conversationDir, 'state.json');",
      "    const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;",
      "    const activeTurnId = state?.active_turn_id || '';",
      "    if (activeTurnId && activeTurnId === request.target_turn_id) {",
      "      cancelledTurns.add(activeTurnId);",
      "      appendEvent(activeTurnId, { type: 'session-aborted', provider: request.provider, turn_id: activeTurnId, conversation_id: request.conversation_id, session_id: `provider_${request.conversation_id}` });",
      "      writeJson(path.join(coHome, 'turns', activeTurnId, 'state.json'), { contract: 'co-turn-v1', turn_id: activeTurnId, conversation_id: request.conversation_id, provider: request.provider, status: 'aborted' });",
      "      writeJson(statePath, { ...(state || {}), active_turn_id: '', status: 'aborted', updated_at: new Date().toISOString() });",
      "    }",
      "    writeJson(path.join(turnDir, 'state.json'), { contract: 'co-turn-v1', turn_id: turnId, conversation_id: request.conversation_id, provider: request.provider, status: activeTurnId === request.target_turn_id ? 'completed' : 'ignored' });",
      "    active.delete(request.conversation_id);",
      "    processNext(request.conversation_id);",
      "    return;",
      "  }",
      "  writeJson(path.join(turnDir, 'request.json'), request);",
      "  writeJson(path.join(turnDir, 'state.json'), { contract: 'co-turn-v1', turn_id: turnId, conversation_id: request.conversation_id, provider: request.provider, status: 'running' });",
      "  writeJson(path.join(conversationDir, 'state.json'), { contract: 'co-conversation-v1', conversation_id: request.conversation_id, project_path: request.project_path, provider: request.provider, provider_session_id: `provider_${request.conversation_id}`, active_turn_id: turnId, status: 'running', updated_at: new Date().toISOString(), turns: [turnId] });",
      "  appendEvent(turnId, { type: 'session-created', provider: request.provider, turn_id: turnId, conversation_id: request.conversation_id, session_id: `provider_${request.conversation_id}` });",
      "  setTimeout(() => finishTurn(request, turnId), delayMs);",
      "}",
      "function processNext(conversationId) {",
      "  if (active.has(conversationId)) return;",
      "  const queue = queues.get(conversationId) || [];",
      "  const request = queue.shift();",
      "  if (!request) return;",
      "  active.add(conversationId);",
      "  startTurn(request);",
      "}",
      "function handleRequest(request) {",
      "  if (request.request_id && seenRequestIds.has(request.request_id)) return;",
      "  if (request.request_id) seenRequestIds.add(request.request_id);",
      "  const queue = queues.get(request.conversation_id) || [];",
      "  queue.push(request);",
      "  queues.set(request.conversation_id, queue);",
      "  processNext(request.conversation_id);",
      "}",
      "setInterval(() => {",
      "  const pendingDir = path.join(coHome, 'requests', 'pending');",
      "  if (!fs.existsSync(pendingDir)) return;",
      "  for (const fileName of fs.readdirSync(pendingDir)) {",
      "    if (!fileName.endsWith('.json') || seen.has(fileName)) continue;",
      "    seen.add(fileName);",
      "    const request = JSON.parse(fs.readFileSync(path.join(pendingDir, fileName), 'utf8'));",
      "    handleRequest(request);",
      "  }",
      "}, 100);",
    ].join('\n'),
    'utf8',
  );
  return spawn(process.execPath, [scriptPath], {
    cwd,
    env: childEnv,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

/**
 * Sleep synchronously during one-time global setup cleanup.
 * @param {number} ms - Milliseconds to wait.
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Stop any stale local process already listening on a Playwright-managed port.
 * @param {string} port - TCP port owned by the isolated Playwright run.
 */
function stopPortListeners(port) {
  let pidOutput = '';
  try {
    pidOutput = execFileSync('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return;
  }

  const pids = pidOutput.split('\n').map((entry) => entry.trim()).filter(Boolean);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
    } catch {
      // Process exited between lsof and kill.
    }
  }
  sleepSync(300);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch {
      // Process already exited after SIGTERM.
    }
  }
}

/**
 * Apply watcher defaults for Playwright-managed dev servers.
 * The e2e suite starts Vite in short-lived isolated runs where reliability is
 * more important than live-edit latency, so polling avoids host fs watcher
 * exhaustion while still allowing callers to override the strategy explicitly.
 * @param {NodeJS.ProcessEnv} env - Child process environment to mutate.
 */
function applyPlaywrightWatcherDefaults(env) {
  env.CHOKIDAR_USEPOLLING = env.CHOKIDAR_USEPOLLING || '1';
  env.CHOKIDAR_INTERVAL = env.CHOKIDAR_INTERVAL || '1000';
}

/**
 * Check whether a URL responds successfully with a short hard timeout.
 * @param {string} url - URL to probe.
 * @returns {boolean} True when curl receives a successful response.
 */
function isUrlReady(url) {
  try {
    execFileSync(
      'curl',
      ['--silent', '--show-error', '--fail', '--noproxy', '*', '--max-time', '1', url],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait until a URL becomes reachable or throw after timeout.
 * @param {string} url - URL to wait for.
 * @param {number} timeoutMs - Maximum wait time.
 * @param {{ label?: string, child?: import('node:child_process').ChildProcess, stdout?: () => string, stderr?: () => string }} [options]
 */
async function waitForUrl(url, timeoutMs, options = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (isUrlReady(url)) {
      return;
    }

    if (options.child && options.child.exitCode !== null) {
      const stdout = options.stdout?.() || '';
      const stderr = options.stderr?.() || '';
      throw new Error(
        `${options.label || 'Child process'} exited before ${url} became ready.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const stdout = options.stdout?.() || '';
  const stderr = options.stderr?.() || '';
  throw new Error(`Timed out waiting for ${url}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

/**
 * Terminate a spawned process with escalation.
 * @param {import('node:child_process').ChildProcess} child - Spawned process.
 */
async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);

  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
}

/**
 * Bootstrap the isolated API server and Vite dev server before tests.
 */
export default async function globalSetup() {
  const cwd = process.cwd();
  const host = process.env.PLAYWRIGHT_HOST || '127.0.0.1';
  const serverPort = process.env.PLAYWRIGHT_SERVER_PORT || '4101';
  const vitePort = process.env.PLAYWRIGHT_VITE_PORT || '6174';
  const serverUrl = `http://${host}:${serverPort}/api/auth/status`;
  const viteUrl = `http://${host}:${vitePort}/`;
  const childEnv = {
    ...process.env,
    PORT: serverPort,
    VITE_PORT: vitePort,
    CCFLOW_CO_HOME: process.env.CCFLOW_CO_HOME || path.join(cwd, '.tmp', 'playwright-co-home'),
    XDG_STATE_HOME: process.env.XDG_STATE_HOME || path.join(cwd, '.tmp', 'playwright-state-home'),
    CCFLOW_FAKE_RUNNER: process.env.CCFLOW_FAKE_RUNNER || '1',
    CCFLOW_FAKE_RUNNER_DELAY_MS: process.env.CCFLOW_FAKE_RUNNER_DELAY_MS || '8000',
    CCFLOW_FAKE_CO_DELAY_MS: process.env.CCFLOW_FAKE_CO_DELAY_MS || '8000',
  };
  applyPlaywrightWatcherDefaults(childEnv);
  childEnv.PATH = `${ensureWorkflowToolFixtures(cwd)}:${childEnv.PATH || ''}`;

  let serverProcess = null;
  let viteProcess = null;
  let serverSpawnError = null;
  let viteSpawnError = null;
  let serverStdout = '';
  let serverStderr = '';
  let viteStdout = '';
  let viteStderr = '';
  let fakeCoProcess = null;

  stopPortListeners(serverPort);
  stopPortListeners(vitePort);
  fs.rmSync(childEnv.CCFLOW_CO_HOME, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  fakeCoProcess = startFakeCoDaemon(cwd, childEnv);

  if (!isUrlReady(serverUrl)) {
    serverProcess = spawn('pnpm', ['run', 'server'], {
      cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    serverProcess.on('error', (error) => { serverSpawnError = error; });
    serverProcess.stdout?.on('data', (chunk) => { serverStdout += chunk.toString(); });
    serverProcess.stderr?.on('data', (chunk) => { serverStderr += chunk.toString(); });
  }

  await waitForUrl(serverUrl, 30_000, {
    label: 'Server process',
    child: serverProcess,
    stdout: () => serverStdout,
    stderr: () => [serverStderr, serverSpawnError?.stack || serverSpawnError?.message || ''].filter(Boolean).join('\n'),
  });

  if (!isUrlReady(viteUrl)) {
    viteProcess = spawn('pnpm', ['exec', 'vite', '--host', host, '--port', vitePort], {
      cwd,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    viteProcess.on('error', (error) => { viteSpawnError = error; });
    viteProcess.stdout?.on('data', (chunk) => { viteStdout += chunk.toString(); });
    viteProcess.stderr?.on('data', (chunk) => { viteStderr += chunk.toString(); });
  }

  await waitForUrl(viteUrl, 30_000, {
    label: 'Vite process',
    child: viteProcess,
    stdout: () => viteStdout,
    stderr: () => [viteStderr, viteSpawnError?.stack || viteSpawnError?.message || ''].filter(Boolean).join('\n'),
  });

  return async () => {
    await stopProcess(viteProcess);
    await stopProcess(serverProcess);
    await stopProcess(fakeCoProcess);
    stopPortListeners(vitePort);
    stopPortListeners(serverPort);
  };
}
