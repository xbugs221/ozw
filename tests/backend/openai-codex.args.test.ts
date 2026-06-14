// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify Codex CLI argument construction for new and resumed sessions.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  __assertResumeSessionWorkingDirectoryForTest,
  __buildCodexChildEnvForTest,
  __buildCodexExecArgsForTest,
  __findCodexSessionTranscriptForTest,
  __readCodexSessionWorkingDirectoryForTest,
} from '../../backend/openai-codex.ts';

/**
 * Build a minimal argument set and allow per-test overrides.
 * @param {object} overrides - Partial argument overrides.
 * @returns {string[]} Built Codex CLI args.
 */
function buildArgs(overrides = {}) {
  return __buildCodexExecArgsForTest({
    command: 'hello',
    sessionId: null,
    workingDirectory: '/tmp/project',
    model: 'gpt-5.3-codex-spark',
    reasoningEffort: 'high',
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'never',
    ...overrides,
  });
}

test('new session includes --model in codex CLI args', () => {
  const args = buildArgs({ sessionId: null });
  const modelFlagIndex = args.indexOf('--model');

  assert.ok(modelFlagIndex >= 0, 'new sessions should include --model');
  assert.equal(args[modelFlagIndex + 1], 'gpt-5.3-codex-spark');
});

test('resumed session omits --model to avoid model mismatch', () => {
  const args = buildArgs({ sessionId: 'thread_123' });
  const modelFlagIndex = args.indexOf('--model');
  const resumeIndex = args.indexOf('resume');

  assert.equal(modelFlagIndex, -1, 'resumed sessions must not include --model');
  assert.ok(resumeIndex >= 0, 'resumed sessions should include resume command');
  assert.equal(args[resumeIndex + 1], 'thread_123');
});

test('new session forwards reasoning effort via config override', () => {
  const args = buildArgs({ reasoningEffort: 'xhigh' });
  const configIndex = args.findIndex(
    (value, index) => value === '-c' && args[index + 1] === 'model_reasoning_effort="xhigh"',
  );

  assert.notEqual(configIndex, -1, 'reasoning effort should be passed through model_reasoning_effort');
});

test('resumed session forwards synced reasoning effort via config override', () => {
  const args = buildArgs({ sessionId: 'thread_123', reasoningEffort: 'xhigh' });
  const configIndex = args.findIndex(
    (value, index) => value === '-c' && args[index + 1] === 'model_reasoning_effort="xhigh"',
  );

  assert.notEqual(configIndex, -1, 'resumed sessions should use the synced reasoning effort');
});

test('child env pins context-mode project dir to the active Codex workspace', () => {
  const originalContextModeDir = process.env.CONTEXT_MODE_PROJECT_DIR;
  const originalClaudeCode = process.env.CLAUDECODE;
  const originalCodexThreadId = process.env.CODEX_THREAD_ID;
  const originalCodexSessionId = process.env.CODEX_SESSION_ID;

  process.env.CONTEXT_MODE_PROJECT_DIR = '/tmp/host-project';
  process.env.CLAUDECODE = '1';
  process.env.CODEX_THREAD_ID = 'thread-live';
  process.env.CODEX_SESSION_ID = 'session-live';
  try {
    const env = __buildCodexChildEnvForTest({ HTTPS_PROXY: 'http://proxy.local:8080' }, '/tmp/matx');

    assert.equal(env.CONTEXT_MODE_PROJECT_DIR, '/tmp/matx');
    assert.equal(env.HTTPS_PROXY, 'http://proxy.local:8080');
    assert.equal('CLAUDECODE' in env, false);
    assert.equal('CODEX_THREAD_ID' in env, false);
    assert.equal('CODEX_SESSION_ID' in env, false);
  } finally {
    if (originalContextModeDir === undefined) {
      delete process.env.CONTEXT_MODE_PROJECT_DIR;
    } else {
      process.env.CONTEXT_MODE_PROJECT_DIR = originalContextModeDir;
    }

    if (originalClaudeCode === undefined) {
      delete process.env.CLAUDECODE;
    } else {
      process.env.CLAUDECODE = originalClaudeCode;
    }

    if (originalCodexThreadId === undefined) {
      delete process.env.CODEX_THREAD_ID;
    } else {
      process.env.CODEX_THREAD_ID = originalCodexThreadId;
    }

    if (originalCodexSessionId === undefined) {
      delete process.env.CODEX_SESSION_ID;
    } else {
      process.env.CODEX_SESSION_ID = originalCodexSessionId;
    }
  }
});

test('resume validation reads persisted Codex cwd from transcript metadata', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-sessions-'));
  const transcriptDir = path.join(tempRoot, '2026', '04', '22');
  const sessionId = 'thread_abc';
  const transcriptPath = path.join(transcriptDir, `rollout-2026-04-22T16-43-59-${sessionId}.jsonl`);

  await fs.mkdir(transcriptDir, { recursive: true });
  await fs.writeFile(
    transcriptPath,
    `${JSON.stringify({ type: 'session_meta', payload: { cwd: '/tmp/matx' } })}\n`,
    'utf8',
  );

  assert.equal(await __findCodexSessionTranscriptForTest(sessionId, tempRoot), transcriptPath);
  assert.equal(await __readCodexSessionWorkingDirectoryForTest(sessionId, tempRoot), '/tmp/matx');
});

test('resume validation rejects cross-project Codex cwd mismatches', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-sessions-'));
  const transcriptDir = path.join(tempRoot, '2026', '04', '22');
  const sessionId = 'thread_resume_guard';
  const transcriptPath = path.join(transcriptDir, `rollout-2026-04-22T16-43-59-${sessionId}.jsonl`);

  await fs.mkdir(transcriptDir, { recursive: true });
  await fs.writeFile(
    transcriptPath,
    `${JSON.stringify({ type: 'session_meta', payload: { cwd: '/tmp/ozw' } })}\n`,
    'utf8',
  );

  await assert.rejects(
    __assertResumeSessionWorkingDirectoryForTest(sessionId, '/tmp/matx', tempRoot),
    /recorded session cwd is \/tmp\/ozw/,
  );

  await assert.doesNotReject(
    __assertResumeSessionWorkingDirectoryForTest(sessionId, '/tmp/ozw', tempRoot),
  );
});
