// @ts-nocheck -- Spec fixture audits FileHandle methods with a proxy across backend provider readers.
/**
 * Sources: 2026-06-11-102-长会话消息增量瘦身
 *
 * PURPOSE: Verify long-session append refreshes read only new JSONL tail bytes
 * for Codex/Pi while preserving raw-line cursor semantics.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const PROJECT_PATH = '/tmp/ozw-session-incremental-read-project';
const CODEX_SESSION_ID = 'spec-codex-incremental-session';
const PI_SESSION_ID = 'spec-pi-incremental-session';

/**
 * Create an isolated HOME so provider JSONL fixtures never touch real history.
 */
async function withTemporaryHome(testBody) {
  const originalHome = process.env.HOME;
  const originalStateHome = process.env.XDG_STATE_HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-session-incremental-read-'));

  process.env.HOME = tempHome;
  process.env.XDG_STATE_HOME = path.join(tempHome, '.local', 'state');
  await fs.mkdir(PROJECT_PATH, { recursive: true });

  try {
    await testBody(tempHome);
  } finally {
    if (originalHome) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalStateHome) process.env.XDG_STATE_HOME = originalStateHome;
    else delete process.env.XDG_STATE_HOME;
    await fs.rm(tempHome, { recursive: true, force: true });
  }
}

/**
 * Build one Codex JSONL transcript with many historical rows.
 */
async function writeCodexTranscript(tempHome, includeTail = true) {
  const sessionDir = path.join(tempHome, '.codex', 'sessions', '2026', '06', '11');
  const filePath = path.join(sessionDir, `${CODEX_SESSION_ID}.jsonl`);
  const lines = [
    {
      type: 'session_meta',
      timestamp: '2026-06-11T01:00:00.000Z',
      payload: { id: CODEX_SESSION_ID, cwd: PROJECT_PATH, model: 'gpt-5-codex' },
    },
  ];

  for (let index = 0; index < 120; index += 1) {
    lines.push({
      type: 'event_msg',
      timestamp: `2026-06-11T01:${String(index % 60).padStart(2, '0')}:01.000Z`,
      payload: { type: 'user_message', message: `历史 Codex 用户消息 ${index}` },
    });
    lines.push({
      type: 'response_item',
      timestamp: `2026-06-11T01:${String(index % 60).padStart(2, '0')}:02.000Z`,
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: `历史 Codex 助手消息 ${index}` }],
      },
    });
  }

  if (includeTail) lines.push(...codexTailRows());

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return { filePath, totalLines: lines.length };
}

/**
 * Return Codex rows appended by the incremental refresh scenario.
 */
function codexTailRows() {
  return [
    {
      type: 'event_msg',
      timestamp: '2026-06-11T03:00:01.000Z',
      payload: { type: 'user_message', message: '新增 Codex 用户尾部消息' },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-11T03:00:02.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: '新增 Codex 助手尾部消息' }],
      },
    },
  ];
}

/**
 * Build one Pi JSONL transcript with many historical rows.
 */
async function writePiTranscript(tempHome, includeTail = true) {
  const sessionDir = path.join(tempHome, '.pi', 'agent', 'sessions');
  const filePath = path.join(sessionDir, `${PI_SESSION_ID}.jsonl`);
  const lines = [
    { type: 'session', id: PI_SESSION_ID, cwd: PROJECT_PATH, timestamp: '2026-06-11T02:00:00.000Z' },
  ];

  for (let index = 0; index < 120; index += 1) {
    lines.push({
      type: 'message',
      timestamp: `2026-06-11T02:${String(index % 60).padStart(2, '0')}:01.000Z`,
      message: { role: 'user', content: `历史 Pi 用户消息 ${index}` },
    });
    lines.push({
      type: 'message',
      timestamp: `2026-06-11T02:${String(index % 60).padStart(2, '0')}:02.000Z`,
      message: { role: 'assistant', content: `历史 Pi 助手消息 ${index}` },
    });
  }

  if (includeTail) lines.push(...piTailRows());

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return { filePath, totalLines: lines.length };
}

/**
 * Return Pi rows appended by the incremental refresh scenario.
 */
function piTailRows() {
  return [
    {
      type: 'message',
      timestamp: '2026-06-11T04:00:01.000Z',
      message: { role: 'user', content: '新增 Pi 用户尾部消息' },
    },
    {
      type: 'message',
      timestamp: '2026-06-11T04:00:02.000Z',
      message: { role: 'assistant', content: '新增 Pi 助手尾部消息' },
    },
  ];
}

/**
 * Append JSONL records and return the previous file size.
 */
async function appendJsonlRows(filePath, rows) {
  const previousStat = await fs.stat(filePath);
  await fs.appendFile(filePath, `${rows.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return previousStat.size;
}

/**
 * Audit JSONL FileHandle reads while running production backend readers.
 */
async function withJsonlReadAudit(run) {
  const originalOpen = fs.open;
  const audit = {
    jsonlReadFileCalls: 0,
    jsonlReadFileBytes: 0,
    jsonlReadCalls: [],
  };

  fs.open = async (...args) => {
    const filePath = String(args[0] || '');
    const handle = await originalOpen(...args);
    if (!filePath.endsWith('.jsonl')) return handle;

    return new Proxy(handle, {
      get(target, property, receiver) {
        if (property === 'readFile') {
          return async (...readArgs) => {
            const stat = await target.stat();
            audit.jsonlReadFileCalls += 1;
            audit.jsonlReadFileBytes += stat.size;
            return target.readFile(...readArgs);
          };
        }
        if (property === 'read') {
          return async (...readArgs) => {
            audit.jsonlReadCalls.push({
              filePath,
              position: Number(readArgs[3]),
              length: Number(readArgs[2]),
            });
            return target.read(...readArgs);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };

  try {
    return await run(audit);
  } finally {
    fs.open = originalOpen;
  }
}

/**
 * Extract visible text from provider-specific backend message rows.
 */
function messageText(messages) {
  return messages.map((message) => {
    if (typeof message?.message?.content === 'string') return message.message.content;
    if (Array.isArray(message?.message?.content)) {
      return message.message.content.map((part) => part?.text || '').join('');
    }
    return String(message?.content || '');
  }).join('\n');
}

test('Codex/Pi afterLine cache hits read appended JSONL tail bytes only', async () => {
  await withTemporaryHome(async (tempHome) => {
    const codexFixture = await writeCodexTranscript(tempHome, false);
    const piFixture = await writePiTranscript(tempHome, false);
    const projectsModule = await import('../../backend/projects.ts');
    projectsModule.clearProjectDirectoryCache?.();

    const codexInitial = await projectsModule.getCodexSessionMessages(CODEX_SESSION_ID, 100, 0, null);
    const piInitial = await projectsModule.getPiSessionMessages(PI_SESSION_ID, 100, 0, null);
    const codexOldSize = await appendJsonlRows(codexFixture.filePath, codexTailRows());
    const piOldSize = await appendJsonlRows(piFixture.filePath, piTailRows());

    await withJsonlReadAudit(async (audit) => {
      const codexResult = await projectsModule.getCodexSessionMessages(CODEX_SESSION_ID, null, 0, codexInitial.total);
      const piResult = await projectsModule.getPiSessionMessages(PI_SESSION_ID, null, 0, piInitial.total);
      const codexText = messageText(codexResult.messages || []);
      const piText = messageText(piResult.messages || []);

      assert.equal(codexResult.total, codexFixture.totalLines + 2, 'Codex total must keep full JSONL line count');
      assert.equal(piResult.total, piFixture.totalLines + 2, 'Pi total must keep full JSONL line count');
      assert.match(codexText, /新增 Codex 用户尾部消息|新增 Codex 助手尾部消息/);
      assert.doesNotMatch(codexText, /历史 Codex 用户消息 0/);
      assert.match(piText, /新增 Pi 用户尾部消息|新增 Pi 助手尾部消息/);
      assert.doesNotMatch(piText, /历史 Pi 用户消息 0/);
      assert.equal(audit.jsonlReadFileCalls, 0, 'afterLine refresh must not call FileHandle.readFile');
      assert.ok(
        audit.jsonlReadCalls.some((call) => call.filePath === codexFixture.filePath && call.position === codexOldSize),
        'Codex cache-hit afterLine must start from old EOF',
      );
      assert.ok(
        audit.jsonlReadCalls.some((call) => call.filePath === piFixture.filePath && call.position === piOldSize),
        'Pi cache-hit afterLine must start from old EOF',
      );
      assert.equal(
        audit.jsonlReadCalls.some((call) => call.filePath === codexFixture.filePath && call.position === 0),
        false,
        'Codex cache-hit afterLine must not scan from byte 0',
      );
      assert.equal(
        audit.jsonlReadCalls.some((call) => call.filePath === piFixture.filePath && call.position === 0),
        false,
        'Pi cache-hit afterLine must not scan from byte 0',
      );
    });
  });
});

test('Codex afterLine boundaries preserve totals without full-file reads', async () => {
  await withTemporaryHome(async (tempHome) => {
    const codexFixture = await writeCodexTranscript(tempHome);
    const projectsModule = await import('../../backend/projects.ts');
    projectsModule.clearProjectDirectoryCache?.();

    await withJsonlReadAudit(async (audit) => {
      const emptyTail = await projectsModule.getCodexSessionMessages(CODEX_SESSION_ID, null, 0, codexFixture.totalLines);
      const oversizedCursor = await projectsModule.getCodexSessionMessages(
        CODEX_SESSION_ID,
        null,
        0,
        codexFixture.totalLines + 100,
      );
      const cacheMiss = await projectsModule.getCodexSessionMessages(CODEX_SESSION_ID, null, 0, 0);

      assert.equal(emptyTail.total, codexFixture.totalLines, 'empty tail still returns current total line count');
      assert.equal(emptyTail.messages.length, 0, 'afterLine equal to total must not repeat messages');
      assert.equal(oversizedCursor.total, codexFixture.totalLines, 'oversized cursor still returns current total line count');
      assert.equal(oversizedCursor.messages.length, 0, 'oversized cursor must not repeat old messages');
      assert.ok(cacheMiss.messages.length > 0, 'cache miss with afterLine=0 must read existing messages');
      assert.equal(audit.jsonlReadFileCalls, 0, 'boundary reads must not call FileHandle.readFile');
    });
  });
});
