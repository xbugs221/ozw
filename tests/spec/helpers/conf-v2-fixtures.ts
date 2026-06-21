// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Provide isolated filesystem fixtures for conf.json v2 acceptance tests.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let homeIsolationQueue = Promise.resolve();
let projectApiPromise = null;
let originalDatabasePath;
let originalDatabasePathDefaulted;
let isolatedDatabaseDir = '';

/**
 * Load project-domain APIs only after DATABASE_PATH points at an isolated DB.
 */
export async function loadConfV2ProjectApi() {
  if (!projectApiPromise) {
    originalDatabasePath = process.env.DATABASE_PATH;
    originalDatabasePathDefaulted = process.env.OZW_DATABASE_PATH_DEFAULTED;
    isolatedDatabaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-conf-v2-db-'));
    process.env.DATABASE_PATH = path.join(isolatedDatabaseDir, 'ozw.db');
    delete process.env.OZW_DATABASE_PATH_DEFAULTED;
    projectApiPromise = import(`../../../backend/projects.ts?conf-v2=${Date.now()}-${Math.random()}`);
  }
  return projectApiPromise;
}

/**
 * Restore process environment after this spec's isolated project API is done.
 */
export async function cleanupConfV2ProjectApi() {
  if (originalDatabasePath) {
    process.env.DATABASE_PATH = originalDatabasePath;
  } else {
    delete process.env.DATABASE_PATH;
  }
  if (originalDatabasePathDefaulted) {
    process.env.OZW_DATABASE_PATH_DEFAULTED = originalDatabasePathDefaulted;
  } else {
    delete process.env.OZW_DATABASE_PATH_DEFAULTED;
  }
  if (isolatedDatabaseDir) {
    await fs.rm(isolatedDatabaseDir, { recursive: true, force: true });
  }
}

/**
 * Run one acceptance test with an isolated HOME and project directory.
 * @param {(ctx: {homeDir: string, projectPath: string}) => Promise<void>} testBody
 * @returns {Promise<void>}
 */
export async function withIsolatedProject(testBody) {
  const run = async () => {
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;
    const originalXdgStateHome = process.env.XDG_STATE_HOME;
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-conf-v2-'));
    const binDir = path.join(homeDir, 'bin');
    const projectPath = path.join(homeDir, 'workspace', 'project');

    process.env.HOME = homeDir;
    process.env.XDG_STATE_HOME = path.join(homeDir, 'state');
    process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
    const { clearProjectDirectoryCache } = await loadConfV2ProjectApi();
    clearProjectDirectoryCache();
    await fs.mkdir(projectPath, { recursive: true });
    await writeFakeGoWorkflowTools(binDir);

    try {
      await testBody({ homeDir, projectPath });
    } finally {
      clearProjectDirectoryCache();
      process.env.PATH = originalPath || '';
      if (originalHome) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }
      if (originalXdgStateHome) {
        process.env.XDG_STATE_HOME = originalXdgStateHome;
      } else {
        delete process.env.XDG_STATE_HOME;
      }
      await fs.rm(homeDir, { recursive: true, force: true });
    }
  };

  const runPromise = homeIsolationQueue.then(run, run);
  homeIsolationQueue = runPromise.catch(() => {});
  return runPromise;
}

/**
 * Write fake Go workflow CLIs for conf-v2 tests that create workflows.
 */
async function writeFakeGoWorkflowTools(binDir) {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'oz'),
    [
      '#!/bin/sh',
      'PATH="/usr/bin:/bin:$PATH"',
      'changes_dir="$PWD/docs/changes"',
      'if [ "$1" = "--version" ]; then echo oz-conf-test; exit 0; fi',
      'if [ "$1" = "list" ]; then',
      "  printf '{\"changes\":['",
      '  first=1',
      '  if [ -d "$changes_dir" ]; then',
      '    for entry in "$changes_dir"/*; do',
      '      [ -d "$entry" ] || continue',
      '      [ "$(basename "$entry")" = "archive" ] && continue',
      '      if [ "$first" -eq 0 ]; then printf ","; fi',
      '      first=0',
      "      printf '{\"name\":\"%s\"}' \"$(basename \"$entry\")\"",
      '    done',
      '  fi',
      "  printf ']}\\n'",
      '  exit 0',
      'fi',
      'if [ "$1" = "status" ]; then',
      '  if [ -d "$changes_dir/$2" ]; then printf \'{"name":"%s","status":"active"}\\n\' "$2"; else exit 1; fi',
      '  exit 0',
      'fi',
      'if [ "$1" = "flow" ] && [ "$2" = "run" ]; then',
      '  shift',
      '  run_id="conf-test-run-$(date +%s%N)"',
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
      '  echo log > "$run_dir/logs/executor.log"',
      '  cat > "$run_dir/state.json" <<JSON',
      '{"run_id":"$run_id","change_name":"$change","status":"running","stage":"execution","stages":{"execution":"running"},"paths":{"executor_log":".wo/runs/$run_id/logs/executor.log"},"sessions":{},"error":""}',
      'JSON',
      '  printf \'{"run_id":"%s","change_name":"%s","status":"running","stage":"execution"}\\n\' "$run_id" "$change"',
      '  exit 0',
      'fi',
      'echo \'{}\'',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/**
 * Create a valid docs/ OpenSpec change for Go-backed workflow tests.
 */
export async function writeActiveOpenSpecChange(projectPath, changeName = 'conf-v2-change') {
  const changeRoot = path.join(projectPath, 'docs', 'changes', changeName);
  await fs.mkdir(path.join(changeRoot, 'specs'), { recursive: true });
  await fs.writeFile(path.join(changeRoot, 'proposal.md'), '# proposal\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'design.md'), '# design\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'tasks.md'), '- [ ] conf v2 workflow\n', 'utf8');
  return changeName;
}

/**
 * Read the project-local ozw config JSON from the XDG state directory.
 * @param {string} projectPath - Project root path.
 * @returns {Promise<object>} Parsed config.
 */
export async function readProjectConf(projectPath) {
  const { getProjectLocalConfigPath } = await import('../../../backend/project-config-store.ts');
  const confPath = getProjectLocalConfigPath(projectPath);
  return JSON.parse(await fs.readFile(confPath, 'utf8'));
}

/**
 * Create a minimal Codex transcript with a real first user instruction.
 * @param {string} homeDir - Test HOME directory.
 * @param {string} projectPath - Project root path.
 * @param {string} sessionId - Codex session id.
 * @param {string} firstInstruction - First user instruction.
 * @returns {Promise<string>} Transcript path.
 */
export async function createCodexTranscript(homeDir, projectPath, sessionId, firstInstruction) {
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '04', '25');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-25T08:00:00.000Z',
        payload: { id: sessionId, cwd: projectPath },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-25T08:00:01.000Z',
        payload: { type: 'user_message', message: firstInstruction },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
  return sessionPath;
}
