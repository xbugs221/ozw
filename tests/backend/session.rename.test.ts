// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify Claude session rename persistence behavior for sidebar rename flows.
 * The tests append summary records to real JSONL session files and confirm refreshed reads use the new title.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  addProjectManually,
  clearProjectDirectoryCache,
  createManualSessionDraft,
  bindManualSessionProvider,
  deleteCodexSession,
  deleteSession,
  finalizeManualSessionRoute,
  getManualSessionRouteRuntime,
  getCodexSessions,
  getSessions,
  loadProjectConfig,
  renameCodexSession,
  renameSession,
  saveProjectConfig,
  searchChatHistory,
  initManualSessionRoute,
} from '../../backend/projects.ts';
import {
  createProjectWorkflow,
  listProjectWorkflows,
} from '../../backend/workflows.ts';
let homeIsolationQueue = Promise.resolve();

/**
 * Execute each test case under an isolated HOME directory.
 */
async function withTemporaryHome(testBody) {
  const run = async () => {
    const originalHome = process.env.HOME;
    const originalPath = process.env.PATH;
    const originalXdgStateHome = process.env.XDG_STATE_HOME;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-session-rename-test-'));
    const binDir = path.join(tempHome, 'bin');

    process.env.HOME = tempHome;
    process.env.XDG_STATE_HOME = path.join(tempHome, 'state');
    process.env.PATH = `${binDir}${path.delimiter}${originalPath || ''}`;
    clearProjectDirectoryCache();
    try {
      await writeFakeWorkflowTools(binDir);
      await testBody(tempHome);
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

      await fs.rm(tempHome, { recursive: true, force: true });
    }
  };

  const runPromise = homeIsolationQueue.then(run, run);
  homeIsolationQueue = runPromise.catch(() => {});
  return runPromise;
}

/**
 * Write fake oz flow commands so workflow child-session tests exercise the
 * current Go-backed contract without requiring machine-global binaries.
 */
async function writeFakeWorkflowTools(binDir) {
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, 'oz'),
    [
      '#!/bin/sh',
      'PATH="/usr/bin:/bin:$PATH"',
      'changes_dir="$PWD/docs/changes"',
      'case "$1" in',
      '  --version) echo "oz-session-test";;',
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
      '  status) if [ -d "$changes_dir/$2" ]; then printf \'{"name":"%s","status":"active"}\\n\' "$2"; else exit 1; fi;;',
      '  flow)',
      '    shift',
      '    run_id="session-test-run-$(date +%s%N)"',
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
      '  echo "session workflow log" > "$run_dir/logs/executor.log"',
      '  cat > "$run_dir/state.json" <<JSON',
      '{"run_id":"$run_id","change_name":"$change","status":"running","stage":"execution","stages":{"execution":"running"},"paths":{"executor_log":".wo/runs/$run_id/logs/executor.log"},"sessions":{},"error":""}',
      'JSON',
      '  printf \'{"run_id":"%s","change_name":"%s","status":"running","stage":"execution"}\\n\' "$run_id" "$change"',
      '  exit 0',
      '    fi',
      '    echo "usage: oz flow run resume status abort --json --run-id --change";;',
      '  *) echo \'{}\';;',
      'esac',
    ].join('\n'),
    { mode: 0o755 },
  );
}

/**
 * Create one active docs/ change before constructing a Go-backed workflow.
 */
async function createGoWorkflow(project, payload = {}) {
  const changeName = `go-${String(payload.title || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow'}`;
  const changeRoot = path.join(project.fullPath || project.path, 'docs', 'changes', changeName);
  await fs.mkdir(path.join(changeRoot, 'specs'), { recursive: true });
  await fs.writeFile(path.join(changeRoot, 'proposal.md'), '# proposal\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'design.md'), '# design\n', 'utf8');
  await fs.writeFile(path.join(changeRoot, 'tasks.md'), '- [ ] session workflow setup\n', 'utf8');
  return createProjectWorkflow(project, {
    ...payload,
    openspecChangeName: changeName,
  });
}

/**
 * Create a minimal Claude session JSONL file that the parser can list and rename.
 */
async function createClaudeSessionFile(projectName, sessionId, message = 'original session prompt', cwd = '/tmp/workspace') {
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);

  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        sessionId,
        type: 'user',
        timestamp: '2026-03-06T08:00:00.000Z',
        cwd,
        message: { role: 'user', content: message },
        parentUuid: null,
        uuid: 'user-1',
      }),
      JSON.stringify({
        sessionId,
        type: 'assistant',
        timestamp: '2026-03-06T08:00:05.000Z',
        cwd,
        message: { role: 'assistant', content: 'assistant reply' },
        parentUuid: 'user-1',
        uuid: 'assistant-1',
      }),
    ].join('\n') + '\n',
    'utf8',
  );

  return sessionPath;
}

/**
 * Create a minimal Codex session JSONL file that project discovery can index.
 */
async function createCodexSessionFile(homeDir, projectPath, sessionId, options = {}) {
  /**
   * PURPOSE: Allow tests to model creation time separately from latest activity.
   */
  const sessionDir = path.join(homeDir, '.codex', 'sessions', '2026', '03', '06');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  const startedAt = options.startedAt || '2026-03-06T08:00:00.000Z';
  const messageAt = options.messageAt || '2026-03-06T08:00:01.000Z';
  const finalAt = options.finalAt || null;
  const message = options.message || '真实 Codex workflow 会话';

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: startedAt,
        payload: { id: sessionId, cwd: projectPath, model: 'gpt-5.4' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: messageAt,
        payload: { type: 'user_message', message },
      }),
      finalAt
        ? JSON.stringify({
          type: 'event_msg',
          timestamp: finalAt,
          payload: { type: 'agent_message', message: 'assistant follow-up' },
        })
        : null,
    ].filter(Boolean).join('\n') + '\n',
    'utf8',
  );

  return sessionPath;
}

/**
 * Create a minimal Pi JSONL transcript bound to a project path.
 */
async function createPiSessionFile(homeDir, projectPath, sessionId) {
  const sessionDir = path.join(homeDir, '.pi', 'agent', 'sessions', '2026', '05', '29');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: 'session',
        id: sessionId,
        cwd: projectPath,
        timestamp: '2026-05-29T08:00:00.000Z',
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-05-29T08:01:00.000Z',
        message: {
          role: 'user',
          content: 'hello pi',
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );

  return sessionPath;
}

/**
 * Create a Claude session fixture with custom user prompts for summary tests.
 */
async function createClaudeSessionFixture(projectName, sessionId, userPrompts) {
  const projectDir = path.join(process.env.HOME, '.claude', 'projects', projectName);
  const sessionPath = path.join(projectDir, `${sessionId}.jsonl`);

  await fs.mkdir(projectDir, { recursive: true });
  const lines = userPrompts.map((prompt, index) => JSON.stringify({
    sessionId,
    type: 'user',
    timestamp: `2026-03-06T08:00:0${index}.000Z`,
    cwd: '/tmp/workspace',
    message: { role: 'user', content: prompt },
    parentUuid: index === 0 ? null : `user-${index}`,
    uuid: `user-${index + 1}`,
  }));
  await fs.writeFile(sessionPath, `${lines.join('\n')}\n`, 'utf8');

  return sessionPath;
}

test('Claude session rename is rejected after provider removal', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-demo');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Demo');
    const sessionPath = await createClaudeSessionFile(project.name, 'session-1');

    await assert.rejects(
      () => renameSession(project.name, 'session-1', 'Renamed Session'),
      /Claude sessions are no longer supported/,
    );

    const sessionsResult = await getSessions(project.name, 5, 0, { includeHidden: true });
    assert.equal(sessionsResult.sessions.length, 0);

    const persistedContent = await fs.readFile(sessionPath, 'utf8');
    assert.doesNotMatch(persistedContent, /"type":"summary"/);
    assert.doesNotMatch(persistedContent, /"summary":"Renamed Session"/);
  });
});

test('Codex session rename persists project-local conf title', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-rename-title');
    await fs.mkdir(projectPath, { recursive: true });

    await addProjectManually(projectPath, 'Codex Rename Title Demo');
    await createCodexSessionFile(tempHome, projectPath, 'codex-rename-real');
    const config = await loadProjectConfig(projectPath);
    config.chat = {
      1: {
        sessionId: 'codex-rename-real',
        title: '旧 Codex 标题',
        ui: {},
      },
    };
    await saveProjectConfig(config, projectPath);

    await renameCodexSession('codex-rename-real', '新 Codex 标题', projectPath);

    const nextConfig = await loadProjectConfig(projectPath);
    assert.equal(nextConfig.chat[1].title, '新 Codex 标题');
  });
});

test('Claude session rename rejects blank summaries', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-demo-empty');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Demo Empty');
    await createClaudeSessionFile(project.name, 'session-blank');

    await assert.rejects(
      () => renameSession(project.name, 'session-blank', '   '),
      /Session summary is required/,
    );
  });
});

test('Claude session summaries are not exposed after provider removal', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-demo-bootstrap');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Demo Bootstrap');
    await createClaudeSessionFixture(project.name, 'session-bootstrap', ['ping', '真正的业务问题']);

    const sessionsResult = await getSessions(project.name, 5, 0, { includeHidden: true });
    assert.equal(sessionsResult.sessions.length, 0);
  });
});

test('Rejected Claude rename leaves history filename and summary unchanged', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-demo-rename-file');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Demo Rename File');
    const sessionPath = await createClaudeSessionFile(project.name, 'session-stable-file');

    await assert.rejects(
      () => renameSession(project.name, 'session-stable-file', '新的会话名称'),
      /Claude sessions are no longer supported/,
    );

    const sessionsResult = await getSessions(project.name, 5, 0, { includeHidden: true });
    assert.equal(sessionsResult.sessions.length, 0);
    await assert.doesNotReject(fs.access(sessionPath));
    assert.equal(path.basename(sessionPath), 'session-stable-file.jsonl');
  });
});

test('manual Claude draft sessions are rejected by the provider contract', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-manual-rejected');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Draft Rejected Demo');
    await assert.rejects(
      () => createManualSessionDraft(project.name, projectPath, 'claude', '会话1'),
      /provider must be "codex" or "pi"/,
    );
  });
});

test('manual Codex draft sessions are visible before the first provider message', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-manual-draft');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Draft Demo');
    const draftSession = await createManualSessionDraft(project.name, projectPath, 'codex', '会话2');

    const sessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, draftSession.id);
    assert.equal(sessions[0].summary, '会话2');
    assert.equal(sessions[0].status, 'draft');
  });
});

test('rebuilt Codex route numbers follow creation time instead of latest activity', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-route-rebuild');
    await fs.mkdir(projectPath, { recursive: true });

    await addProjectManually(projectPath, 'Codex Route Rebuild');
    await createCodexSessionFile(tempHome, projectPath, 'older-updated-later', {
      startedAt: '2026-03-06T08:00:00.000Z',
      messageAt: '2026-03-06T08:01:00.000Z',
      finalAt: '2026-03-06T10:00:00.000Z',
      message: 'older session updated later',
    });
    await createCodexSessionFile(tempHome, projectPath, 'newer-updated-earlier', {
      startedAt: '2026-03-06T09:00:00.000Z',
      messageAt: '2026-03-06T09:05:00.000Z',
      message: 'newer session updated earlier',
    });

    const sessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    const olderSession = sessions.find((session) => session.id === 'older-updated-later');
    const newerSession = sessions.find((session) => session.id === 'newer-updated-earlier');
    assert.equal(olderSession?.routeIndex, 1);
    assert.equal(newerSession?.routeIndex, 2);

    const config = await loadProjectConfig(projectPath);
    assert.equal(config.chat?.['1']?.sessionId, 'older-updated-later');
    assert.equal(config.chat?.['2']?.sessionId, 'newer-updated-earlier');
  });
});

test('manual Codex route hides the bound provider session after first message', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-manual-bound');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Bound Demo');
    const draftSession = await createManualSessionDraft(project.name, projectPath, 'codex', '会话3');
    await createCodexSessionFile(tempHome, projectPath, 'codex-real-session');
    await initManualSessionRoute(project.name, projectPath, draftSession.id, 'codex');
    await bindManualSessionProvider(
      project.name,
      projectPath,
      draftSession.id,
      'codex-real-session',
    );

    const sessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, draftSession.id);
    assert.equal(sessions[0].providerSessionId, 'codex-real-session');
  });
});

test('manual draft start request cannot be overwritten by another tab', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'manual-start-request-lock');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Manual Start Lock Demo');
    const draftSession = await createManualSessionDraft(project.name, projectPath, 'codex', '会话锁');

    assert.deepEqual(
      await initManualSessionRoute(project.name, projectPath, draftSession.id, 'codex'),
      {
        started: true,
        record: {
          sessionId: draftSession.id,
          title: '会话锁',
          provider: 'codex',
          origin: 'manual',
        },
      },
    );

    const secondStart = await initManualSessionRoute(project.name, projectPath, draftSession.id, 'codex');
    assert.equal(secondStart.started, true);
    assert.equal(secondStart.record.sessionId, draftSession.id);
  });
});

test('workflow-owned Codex drafts stay out of the standalone manual-session collection', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-workflow-draft');
    await fs.mkdir(projectPath, { recursive: true });

      const project = await addProjectManually(projectPath, 'Codex Workflow Draft Demo');
      await createManualSessionDraft(project.name, projectPath, 'codex', '规划提案：隐藏草稿', {
        workflowId: 'workflow-hidden-draft',
        stageKey: 'planning',
      });

    const sessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    assert.equal(sessions.length, 0);
  });
});

test('manual Codex draft numbering skips workflow child route buckets', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-workflow-route-bucket');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Workflow Route Demo');
    await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await createCodexSessionFile(tempHome, projectPath, 'codex-workflow-child-real');

    const config = await loadProjectConfig(projectPath);
    config.chat = {
      ...(config.chat || {}),
      2: {
        sessionId: 'codex-workflow-child-real',
        provider: 'codex',
        title: '工作流子代理',
        stageKey: 'execution',
        workflowId: 'workflow-route-demo',
        origin: 'workflow',
      },
    };
    await saveProjectConfig(config, projectPath);

    const nextManualDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话3');
    const sessions = await getCodexSessions(projectPath, {
      limit: 0,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });

    assert.equal(nextManualDraft.routeIndex, 3);
    assert.equal(nextManualDraft.id, 'c3');
    assert.ok(sessions.some((session) => session.id === nextManualDraft.id));
    assert.equal(sessions.some((session) => session.id === 'codex-workflow-child-real'), false);
  });
});

test('manual Codex draft numbering skips terminal-created standalone route indices', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-terminal-route-bucket');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Terminal Route Demo');
    await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await createCodexSessionFile(tempHome, projectPath, 'codex-terminal-real-18');
    await createCodexSessionFile(tempHome, projectPath, 'codex-terminal-real-19');

    const config = await loadProjectConfig(projectPath);
    config.chat = {
      ...(config.chat || {}),
      18: { sessionId: 'codex-terminal-real-18', provider: 'codex', title: '终端会话18' },
      19: { sessionId: 'codex-terminal-real-19', provider: 'codex', title: '终端会话19' },
    };
    await saveProjectConfig(config, projectPath);

    const nextManualDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话20');

    assert.equal(nextManualDraft.routeIndex, 20);
    assert.equal(nextManualDraft.id, 'c20');
  });
});

test('manual Codex draft numbering does not recycle after a manual draft is removed', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-manual-delete-counter');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Manual Delete Counter Demo');
    const firstManualDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    const secondManualDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话2');

    const config = await loadProjectConfig(projectPath);
    delete config.chat[String(firstManualDraft.routeIndex)];
    await saveProjectConfig(config, projectPath);

    const thirdManualDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话3');

    assert.equal(secondManualDraft.routeIndex, 2);
    assert.equal(thirdManualDraft.routeIndex, 3);
  });
});

test('manual Codex sessions expose provider JSONL regardless of ozw origin tags', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-origin-filter');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Origin Filter Demo');
    const draftSession = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await createCodexSessionFile(tempHome, projectPath, 'codex-manual-real', {
      message: '真实手动会话',
    });
    await finalizeManualSessionRoute(project.name, draftSession.id, 'codex-manual-real', 'codex', projectPath);
    await createCodexSessionFile(tempHome, projectPath, 'codex-wo-clean-orphan', {
      message: '提案落地：wo clean 后残留的内部会话',
    });
    await createCodexSessionFile(tempHome, projectPath, 'codex-untagged-provider-session', {
      message: '未标记 origin 的 Codex provider 会话仍可搜索',
    });

    const config = await loadProjectConfig(projectPath);
    const manualRecord = Object.values(config.chat || {}).find((record) => record?.sessionId === 'codex-manual-real');
    assert.equal(manualRecord?.origin, 'manual');
    config.chat[99] = {
      sessionId: 'codex-auto-import-polluted',
      title: '旧索引导入污染出的 Codex 会话',
      provider: 'codex',
      titleSource: 'auto-import',
      origin: 'manual',
    };
    await saveProjectConfig(config, projectPath);
    await createCodexSessionFile(tempHome, projectPath, 'codex-auto-import-polluted', {
      message: '旧索引导入污染出的 Codex 会话',
    });

    const sessions = await getCodexSessions(projectPath, {
      limit: 0,
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    const sessionIds = sessions.map((session) => session.id);

    // Bound manual draft still visible via cN route.
    assert.equal(sessionIds.includes('codex-manual-real'), true);
    // CLI provider JSONL session without ozw origin tag is now visible.
    assert.equal(sessionIds.includes('codex-wo-clean-orphan'), true);
    // Untagged provider session is visible because it is not workflow-internal.
    assert.equal(sessionIds.includes('codex-untagged-provider-session'), true);
    // Auto-imported provider session is visible; origin=manual is not 'workflow'.
    assert.equal(sessionIds.includes('codex-auto-import-polluted'), true);

    const searchResults = await searchChatHistory('未标记 origin 的 Codex provider 会话仍可搜索');
    assert.equal(searchResults.some((result) => result.sessionId === 'codex-untagged-provider-session'), true);
  });
});

test('generic delete no longer removes Claude JSONL history', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'claude-delete-real-file');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Claude Delete Real File Demo');
    const sessionPath = await createClaudeSessionFile(project.name, 'claude-delete-real');

    await assert.rejects(
      () => deleteSession(project.name, 'claude-delete-real'),
      /Codex session file not found/,
    );

    await assert.doesNotReject(fs.access(sessionPath));
  });
});

test('deleting a Codex session removes its JSONL file', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-delete-real-file');
    await fs.mkdir(projectPath, { recursive: true });

    await addProjectManually(projectPath, 'Codex Delete Real File Demo');
    const sessionPath = await createCodexSessionFile(tempHome, projectPath, 'codex-delete-real');

    await deleteCodexSession('codex-delete-real');

    await assert.rejects(fs.access(sessionPath));
  });
});

test('deleting a stale Codex chat record removes the local route entry', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-delete-stale-chat');
    await fs.mkdir(projectPath, { recursive: true });

    await addProjectManually(projectPath, 'Codex Delete Stale Chat Demo');
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        77: {
          sessionId: 'c78b7c1c-5ec0-4722-981f-e7442264a3bc',
          title: 'Stale Codex Chat',
          provider: 'codex',
        },
      },
    }, projectPath);

    await deleteCodexSession('c78b7c1c-5ec0-4722-981f-e7442264a3bc', projectPath);

    const config = await loadProjectConfig(projectPath);
    assert.equal(config.chat, undefined);
  });
});

test('deleting a Pi manual route removes its chat route and provider JSONL file', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'pi-delete-manual-route');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Pi Delete Manual Route Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'pi', 'Pi 手动会话');
    const sessionPath = await createPiSessionFile(tempHome, projectPath, 'pi-delete-real');
    await finalizeManualSessionRoute(project.name, draft.id, 'pi-delete-real', 'pi', projectPath);

    await deleteSession(project.name, draft.id, 'pi');

    const config = await loadProjectConfig(projectPath);
    assert.equal(config.chat, undefined);
    await assert.rejects(fs.access(sessionPath));
  });
});

test('finalizing a manual Codex draft keeps the original route slot', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const projectPath = path.join(tempHome, 'workspace', 'codex-manual-finalize');
    await fs.mkdir(projectPath, { recursive: true });

    const project = await addProjectManually(projectPath, 'Codex Finalize Demo');
    const draftSession = await createManualSessionDraft(project.name, projectPath, 'codex', '会话4');
    await createCodexSessionFile(tempHome, projectPath, 'codex-session-real');

    const finalized = await finalizeManualSessionRoute(
      project.name,
      draftSession.id,
      'codex-session-real',
      'codex',
      projectPath,
    );

    assert.equal(finalized, true);

    const sessions = await getCodexSessions(projectPath, { limit: 0, includeHidden: true });
    const finalizedSession = sessions.find((session) => session.id === 'codex-session-real');
    assert.equal(finalizedSession?.summary, '会话4');
    assert.equal(finalizedSession?.routeIndex, draftSession.routeIndex);
    assert.equal(sessions.some((session) => session.id === draftSession.id), false);

    const config = await loadProjectConfig(projectPath);
    const finalizedChat = Object.values(config.chat || {}).find((record) => record.sessionId === 'codex-session-real');
    assert.equal(finalizedChat?.title, '会话4');
    assert.equal('manualSessionDrafts' in config, false);
  });
});

test('Rejected Claude rename with projectPath does not write project-local config', { concurrency: false }, async () => {
  await withTemporaryHome(async (tempHome) => {
    const externalProjectPath = path.join(tempHome, 'workspace', 'claude-demo-path');
    await fs.mkdir(externalProjectPath, { recursive: true });

    const project = await addProjectManually(externalProjectPath, 'Claude Demo Path');
    const sessionPath = await createClaudeSessionFile(project.name, 'session-with-path');

    await assert.rejects(
      () => renameSession(project.name, 'session-with-path', '带路径的改名', externalProjectPath),
      /Claude sessions are no longer supported/,
    );

    const sessionsResult = await getSessions(project.name, 5, 0, { includeHidden: true });
    assert.equal(sessionsResult.sessions.length, 0);

    const persistedContent = await fs.readFile(sessionPath, 'utf8');
    assert.doesNotMatch(persistedContent, /"type":"summary"/);
    assert.doesNotMatch(persistedContent, /"summary":"带路径的改名"/);

    const projectLocalConfig = await loadProjectConfig(externalProjectPath);
    assert.equal(projectLocalConfig.chat?.['1']?.title, undefined);
  });
});
