// @ts-nocheck -- Provider fixture tests use runtime-shaped session payloads.
/**
 * PURPOSE: Verify lightweight provider discovery uses Codex/Pi JSONL headers
 * and OpenCode SQLite rows for project/session overview without deep history reads.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildCodexSessionsIndex,
  buildPiSessionsIndex,
  clearProjectDirectoryCache,
  addProjectManually,
  getCodexSessionMessages,
  getPiSessions,
  getProjects,
  parseCodexSessionHeader,
} from '../../backend/projects.ts';
import { resolveFlowRunsRoot } from '../../backend/domains/workflows/flow-runtime-paths.ts';
import { reconcileProjectIndex } from '../../backend/domains/projects/project-index-sync-service.ts';
import { getProjectLocalConfigPath } from '../../backend/project-config-store.ts';

const REPO_ROOT = process.cwd();

/**
 * Run DB-bound project list checks in a fresh process after env isolation.
 */
function runTsxEval(source, env) {
  /**
   * PURPOSE: Avoid reusing the parent test worker's already-imported database
   * connection when a case must validate SQLite-backed project list behavior.
   */
  const result = spawnSync('pnpm', ['exec', 'tsx', '-e', source], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

/**
 * Run provider discovery with an isolated HOME so real user histories are not scanned.
 */
async function withTemporaryHome(testBody) {
  const originalHome = process.env.HOME;
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-provider-fast-'));

  process.env.HOME = homeDir;
  process.env.XDG_STATE_HOME = path.join(homeDir, '.local', 'state');
  clearProjectDirectoryCache();
  try {
    await testBody(homeDir);
  } finally {
    clearProjectDirectoryCache();
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
    try {
      await reconcileProjectIndex();
    } catch {
      // Cleanup is best-effort; individual tests assert their own behavior.
    }
  }
}

/**
 * Write one provider JSONL session under the given HOME-relative path.
 */
async function writeJsonl(filePath, records) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${records.join('\n')}\n`, 'utf8');
}

test('Codex project discovery uses session_meta header and ignores malformed later content', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'codex-project');
    const sessionPath = path.join(homeDir, '.codex', 'sessions', '2026', '05', '18', 'rollout-2026-05-18T01-02-03-codex-fast.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(sessionPath, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-18T01:02:03.000Z',
        payload: { id: 'source-codex-fast', cwd: projectPath, model: 'gpt-5' },
      }),
      '{"this later line is intentionally malformed"',
    ]);

    const header = await parseCodexSessionHeader(sessionPath);
    assert.equal(header.id, 'codex-fast');
    assert.equal(header.cwd, projectPath);

    const index = await buildCodexSessionsIndex();
    const sessions = index.get(path.resolve(projectPath)) || [];
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].provider, 'codex');
    assert.equal(sessions[0].messageCount, null);
  });
});

test('Codex old-format fixture falls back to deep parse for cwd discovery', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'codex-old');
    const sessionPath = path.join(homeDir, '.codex', 'sessions', '2026', '05', '18', 'old-codex.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(sessionPath, [
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-05-18T02:00:00.000Z',
        cwd: projectPath,
        payload: { type: 'user_message', message: '旧格式仍应归属到项目' },
      }),
    ]);

    const index = await buildCodexSessionsIndex();
    const sessions = index.get(path.resolve(projectPath)) || [];
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'old-codex');
    assert.match(sessions[0].summary, /旧格式/);
  });
});

test('lightweight getProjects keeps indexed provider-only projects beside manual notes project', async () => {
  await withTemporaryHome(async (homeDir) => {
    const notesPath = path.join(homeDir, 'work', 'notes');
    const providerProjectPath = path.join(homeDir, 'work', 'codex-provider-only');
    const sessionPath = path.join(homeDir, '.codex', 'sessions', '2026', '05', '18', 'rollout-2026-05-18T02-30-00-codex-provider-only.jsonl');

    await fs.mkdir(notesPath, { recursive: true });
    await fs.mkdir(providerProjectPath, { recursive: true });
    await addProjectManually(notesPath, 'notes');
    await writeJsonl(sessionPath, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-18T02:30:00.000Z',
        payload: { id: 'source-provider-only', cwd: providerProjectPath, model: 'gpt-5' },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-05-18T02:30:01.000Z',
        payload: { type: 'user_message', message: 'provider-only project should appear in nav' },
      }),
    ]);

    const output = runTsxEval(`
      import { addProjectManually, getProjects } from './backend/projects.ts';
      import { backfillProjectIndex } from './backend/domains/projects/project-index-sync-service.ts';
      (async () => {
        await addProjectManually(process.env.NOTES_PATH, 'notes');
        await backfillProjectIndex();
        const projects = await getProjects(null, { lightweightList: true });
        console.log(JSON.stringify(projects.map((project) => ({
          fullPath: project.fullPath || project.path,
          hasCodexSessions: 'codexSessions' in project,
          hasPiSessions: 'piSessions' in project,
        }))));
      })();
    `, {
      ...process.env,
      HOME: homeDir,
      XDG_STATE_HOME: path.join(homeDir, '.local', 'state'),
      DATABASE_PATH: path.join(homeDir, '.ozw', 'ozw.db'),
      NOTES_PATH: notesPath,
    });
    const projects = JSON.parse(output.split('\n').filter(Boolean).at(-1) || '[]');
    const projectPaths = projects.map((project) => project.fullPath);
    const providerProject = projects.find((project) => project.fullPath === providerProjectPath);

    assert.equal(projectPaths.includes(notesPath), true);
    assert.equal(projectPaths.includes(providerProjectPath), true);
    assert.equal(providerProject.hasCodexSessions, false);
    assert.equal(providerProject.hasPiSessions, false);
  });
});

test('lightweight getProjects excludes indexed ephemeral ozw-pi temporary projects', async () => {
  await withTemporaryHome(async (homeDir) => {
    const tempPiProjectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-pi-send-'));
    const realProjectPath = path.join(homeDir, 'work', 'real-provider-project');
    const tempSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'tmp', 'pi-temp.jsonl');
    const realSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'real', 'pi-real-provider.jsonl');

    await fs.mkdir(realProjectPath, { recursive: true });
    await writeJsonl(tempSessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-temp',
        timestamp: '2026-05-18T02:40:00.000Z',
        cwd: tempPiProjectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-temp-user',
        timestamp: '2026-05-18T02:40:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'temporary project should not enter nav' }] },
      }),
    ]);
    await writeJsonl(realSessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-real-provider',
        timestamp: '2026-05-18T02:41:00.000Z',
        cwd: realProjectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-real-provider-user',
        timestamp: '2026-05-18T02:41:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'real provider project should enter nav' }] },
      }),
    ]);

    try {
      const output = runTsxEval(`
        import { getProjects } from './backend/projects.ts';
        import { backfillProjectIndex } from './backend/domains/projects/project-index-sync-service.ts';
        (async () => {
          await backfillProjectIndex();
          const projects = await getProjects(null, { lightweightList: true });
          console.log(JSON.stringify(projects.map((project) => project.fullPath || project.path)));
        })();
      `, {
        ...process.env,
        HOME: homeDir,
        XDG_STATE_HOME: path.join(homeDir, '.local', 'state'),
        DATABASE_PATH: path.join(homeDir, '.ozw', 'ozw.db'),
      });
      const projectPaths = JSON.parse(output.split('\n').filter(Boolean).at(-1) || '[]');

      assert.equal(projectPaths.includes(tempPiProjectPath), false);
      assert.equal(projectPaths.includes(realProjectPath), true);
    } finally {
      await fs.rm(tempPiProjectPath, { recursive: true, force: true });
    }
  });
});

test('Pi project discovery uses first type=session JSONL record', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'pi-project');
    const sessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'encoded-project', 'pi-fast.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(sessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-fast',
        timestamp: '2026-05-18T03:00:00.000Z',
        cwd: projectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-fast-user',
        timestamp: '2026-05-18T03:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: '真实 Pi 会话内容' }],
        },
      }),
      '{"later":"content that project discovery must not need"',
    ]);

    const index = await buildPiSessionsIndex();
    const sessions = index.get(path.resolve(projectPath)) || [];
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'pi-fast');
    assert.equal(sessions[0].provider, 'pi');

    const piSessions = await getPiSessions(projectPath, { includeHidden: true });
    assert.equal(piSessions.some((session) => session.id === 'pi-fast'), true);
  });
});

test('Pi project discovery ignores header-only sessions with no renderable messages', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'pi-empty-project');
    const emptySessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'empty-project', 'pi-empty.jsonl');
    const realSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'empty-project', 'pi-real.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(emptySessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-empty',
        timestamp: '2026-05-18T03:05:00.000Z',
        cwd: projectPath,
      }),
    ]);
    await writeJsonl(realSessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-real',
        timestamp: '2026-05-18T03:06:00.000Z',
        cwd: projectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-real-user',
        timestamp: '2026-05-18T03:06:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Pi real user request' }],
        },
      }),
    ]);

    const index = await buildPiSessionsIndex();
    const sessions = index.get(path.resolve(projectPath)) || [];
    const sessionIds = sessions.map((session) => session.id);

    assert.equal(sessionIds.includes('pi-empty'), false);
    assert.equal(sessionIds.includes('pi-real'), true);

    const piSessions = await getPiSessions(projectPath, { includeHidden: true });
    assert.equal(piSessions.some((session) => session.id === 'pi-empty'), false);
    assert.equal(piSessions.some((session) => session.id === 'pi-real'), true);
  });
});

test('Pi project sessions hide indexed workflow child sessions from normal lists', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'pi-workflow-project');
    const childSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'workflow', 'pi-child.jsonl');
    const manualSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'workflow', 'pi-manual.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(childSessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-child',
        timestamp: '2026-05-18T03:10:00.000Z',
        cwd: projectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-child-user',
        timestamp: '2026-05-18T03:10:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Pi child content' }],
        },
      }),
    ]);
    await writeJsonl(manualSessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-manual',
        timestamp: '2026-05-18T03:11:00.000Z',
        cwd: projectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-manual-user',
        timestamp: '2026-05-18T03:11:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Pi manual content' }],
        },
      }),
    ]);
    // Persist workflow child-session metadata to the XDG state config path (not
    // the legacy repo-local .ozw/conf.json) so loadProjectConfig can discover it.
    const configPath = getProjectLocalConfigPath(projectPath);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 2,
        workflows: {
          1: {
            title: 'Pi child workflow',
            chat: {
              1: { sessionId: 'pi-child', provider: 'pi', stageKey: 'execution' },
            },
          },
        },
      }),
      'utf8',
    );

    const piSessions = await getPiSessions(projectPath, {
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    const sessionIds = piSessions.map((session) => session.id);

    assert.equal(sessionIds.includes('pi-child'), false);
    assert.equal(sessionIds.includes('pi-manual'), true);
  });
});

test('getProjects filters Pi workflow child sessions from manual session payloads', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'pi-project-payload');
    const childSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'workflow', 'pi-child-payload.jsonl');
    const manualSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'workflow', 'pi-manual-payload.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(childSessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-child-payload',
        timestamp: '2026-05-18T03:20:00.000Z',
        cwd: projectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-child-payload-user',
        timestamp: '2026-05-18T03:20:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Pi workflow child should stay out of manual payloads' }],
        },
      }),
    ]);
    await writeJsonl(manualSessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-manual-payload',
        timestamp: '2026-05-18T03:21:00.000Z',
        cwd: projectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-manual-payload-user',
        timestamp: '2026-05-18T03:21:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Pi manual session should remain visible' }],
        },
      }),
    ]);
    // Write real run state so getPiSessions can detect pi-child-payload as
    // workflow-internal through the listProjectWorkflows path (not bypassed
    // via config.workflows).
    const runDir = path.join(resolveFlowRunsRoot(projectPath), 'run-pi-payload');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
      run_id: 'run-pi-payload',
      change_name: 'pi-payload-workflow',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      sessions: {
        'pi:executor': 'pi-child-payload',
      },
    }, null, 2)}\n`, 'utf8');

    const projects = await getProjects();
    const project = projects.find((entry) => entry.fullPath === projectPath);
    assert.ok(project, 'Pi project should be discovered from real session headers');

    const sessionIds = (project.piSessions || []).map((session) => session.id);
    assert.equal(sessionIds.includes('pi-child-payload'), false);
    assert.equal(sessionIds.includes('pi-manual-payload'), true);
    const manualSession = project.piSessions.find((session) => session.id === 'pi-manual-payload');
    assert.equal(
      manualSession.summary,
      Array.from('Pi manual session should remain visible').slice(0, 20).join(''),
    );
  });
});

test('Pi project sessions hide workflow sessions recorded only in runner processes', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'pi-process-workflow-project');
    const childSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'workflow', 'pi-process-child.jsonl');
    const manualSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'workflow', 'pi-process-manual.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(childSessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-process-child',
        timestamp: '2026-05-18T03:30:00.000Z',
        cwd: projectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-process-child-user',
        timestamp: '2026-05-18T03:30:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Pi process-only workflow child content' }],
        },
      }),
    ]);
    await writeJsonl(manualSessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-process-manual',
        timestamp: '2026-05-18T03:31:00.000Z',
        cwd: projectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'pi-process-manual-user',
        timestamp: '2026-05-18T03:31:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Pi process-only manual content' }],
        },
      }),
    ]);
    // Write real run state so getPiSessions can detect pi-process-child as
    // workflow-internal through the listProjectWorkflows path.
    const runDir = path.join(resolveFlowRunsRoot(projectPath), 'run-pi-process');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
      run_id: 'run-pi-process',
      change_name: 'pi-process-workflow',
      status: 'running',
      stage: 'execution',
      stages: { execution: 'running' },
      processes: [
        {
          stage: 'execution',
          role: 'executor',
          status: 'running',
          session_id: 'pi-process-child',
          provider: 'pi',
        },
      ],
    }, null, 2)}\n`, 'utf8');

    const piSessions = await getPiSessions(projectPath, {
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    const sessionIds = piSessions.map((session) => session.id);

    assert.equal(sessionIds.includes('pi-process-child'), false);
    assert.equal(sessionIds.includes('pi-process-manual'), true);
  });
});

test('Pi project sessions keep same-id manual session owned by a Codex runner process', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'cross-provider-process-project');
    const piSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'workflow', 'same-process-id.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(piSessionPath, [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'same-process-id',
        timestamp: '2026-05-18T03:40:00.000Z',
        cwd: projectPath,
      }),
      JSON.stringify({
        type: 'message',
        id: 'same-process-id-user',
        timestamp: '2026-05-18T03:40:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Pi manual session should survive Codex runner process with same id' }],
        },
      }),
    ]);

    const runDir = path.join(resolveFlowRunsRoot(projectPath), 'run-codex-process');
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
      run_id: 'run-codex-process',
      change_name: 'codex-process-workflow',
      status: 'running',
      stage: 'review_1',
      stages: { review_1: 'running' },
      processes: [
        {
          stage: 'review_1',
          role: 'reviewer',
          status: 'running',
          session_id: 'same-process-id',
          provider: 'codex',
        },
      ],
    }, null, 2)}\n`, 'utf8');

    const piSessions = await getPiSessions(projectPath, {
      includeHidden: true,
      excludeWorkflowChildSessions: true,
    });
    const sessionIds = piSessions.map((session) => session.id);

    assert.equal(sessionIds.includes('same-process-id'), true,
      'Pi manual session must not be hidden by a Codex workflow runner process with the same id');
  });
});

test('getProjects returns manual projects when a provider index exceeds the home budget', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'manual-budget-project');
    const codexSessionsRoot = path.join(homeDir, '.codex', 'sessions');
    const originalReaddir = fs.readdir;

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(codexSessionsRoot, { recursive: true });
    await addProjectManually(projectPath, 'Manual Budget Project');
    clearProjectDirectoryCache();

    fs.readdir = async (...args) => {
      if (path.resolve(String(args[0])) === path.resolve(codexSessionsRoot)) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      return originalReaddir(...args);
    };

    try {
      const startedAt = Date.now();
      const projects = await getProjects();
      const durationMs = Date.now() - startedAt;

      assert.equal(projects.some((project) => project.fullPath === projectPath), true);
      assert.ok(durationMs < 3500, `manual project discovery should degrade within the home budget, got ${durationMs}ms`);
    } finally {
      fs.readdir = originalReaddir;
    }
  });
});

test('concurrent getProjects calls share one Codex session index build', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'codex-concurrent-project');
    const codexSessionsRoot = path.join(homeDir, '.codex', 'sessions');
    const sessionPath = path.join(codexSessionsRoot, '2026', '05', '18', 'rollout-2026-05-18T04-30-00-codex-concurrent.jsonl');
    const originalReaddir = fs.readdir;
    let rootIndexReadCount = 0;

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(sessionPath, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-18T04:30:00.000Z',
        payload: { id: 'source-codex-concurrent', cwd: projectPath },
      }),
    ]);

    fs.readdir = async (...args) => {
      if (path.resolve(String(args[0])) === path.resolve(codexSessionsRoot)) {
        rootIndexReadCount += 1;
      }
      return originalReaddir(...args);
    };

    try {
      const [firstProjects, secondProjects] = await Promise.all([getProjects(), getProjects()]);
      assert.equal(firstProjects.some((project) => project.fullPath === projectPath), true);
      assert.equal(secondProjects.some((project) => project.fullPath === projectPath), true);
      assert.equal(rootIndexReadCount, 1);
    } finally {
      fs.readdir = originalReaddir;
    }
  });
});

test('Codex detail messages still deep-read transcript after header overview discovery', async () => {
  await withTemporaryHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'codex-detail');
    const sessionPath = path.join(homeDir, '.codex', 'sessions', '2026', '05', '18', 'rollout-2026-05-18T06-00-00-codex-detail.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await writeJsonl(sessionPath, [
      JSON.stringify({ type: 'session_meta', timestamp: '2026-05-18T06:00:00.000Z', payload: { id: 'source-detail', cwd: projectPath } }),
      JSON.stringify({ type: 'event_msg', timestamp: '2026-05-18T06:01:00.000Z', payload: { type: 'user_message', message: '详情消息必须仍可读取' } }),
    ]);

    const index = await buildCodexSessionsIndex();
    assert.equal((index.get(path.resolve(projectPath)) || [])[0].messageCount, null);

    const detail = await getCodexSessionMessages('codex-detail', null, 0);
    assert.equal(detail.messages.some((message) => message.message?.content === '详情消息必须仍可读取'), true);
  });
});
