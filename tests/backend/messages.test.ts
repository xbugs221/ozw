// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify Codex session message reads support incremental afterLine fetches
 * so realtime project updates do not re-append the full session history.
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  addProjectManually,
  clearProjectDirectoryCache,
  getCodexSessionMessages,
  getProjects,
} from '../../backend/projects.ts';

/**
 * Run each test inside an isolated HOME tree so Codex session fixtures stay local.
 */
async function withTemporaryHome(testBody) {
  const originalHome = process.env.HOME;
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-codex-messages-'));

  process.env.HOME = tempHome;
  try {
    await testBody(tempHome);
  } finally {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    await fs.rm(tempHome, { recursive: true, force: true });
  }
}

/**
 * Write a minimal Codex session file with multiline commands and mixed output shapes.
 */
async function createCodexSessionFixture(homeDir, sessionId) {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '04', '10');
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    sessionFile,
    [
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-10T08:00:00.000Z',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          call_id: 'call_1',
          arguments: JSON.stringify({ command: 'pwd' }),
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-10T08:00:01.000Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '/tmp/demo',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-10T08:00:02.000Z',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          call_id: 'call_2',
          arguments: JSON.stringify({ command: 'printf "alpha\\nbeta\\n"' }),
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-10T08:00:03.000Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call_2',
          output: {
            content: [
              { text: 'alpha' },
              { text: 'beta' },
            ],
          },
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

/**
 * Write a Codex session file with assistant phase metadata so UI adapters can
 * distinguish commentary progress from final answers.
 */
async function createCodexPhaseFixture(homeDir, sessionId) {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '04', '11');
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    sessionFile,
    [
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-11T08:00:00.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'commentary',
          content: [{ type: 'output_text', text: '先继续排查路由映射。' }],
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-11T08:00:01.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          phase: 'final_answer',
          content: [{ type: 'output_text', text: '根因已经确认。' }],
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

/**
 * Write a Codex session file where app-server persisted an update envelope
 * around a functionCall item.
 */
async function createCodexUpdateFunctionCallFixture(homeDir, sessionId) {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '04', '12');
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    sessionFile,
    [
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-12T08:00:00.000Z',
        payload: {
          type: 'update',
          update: {
            type: 'functionCall',
            id: 'call-update-plan-jsonl',
            name: 'update_plan',
            arguments: {
              explanation: 'JSONL update envelope must replay as a tool card',
              plan: [{ step: 'Replay update_plan', status: 'completed' }],
            },
          },
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

/**
 * Write a Codex session file with custom user prompts so project listing can derive summaries.
 */
async function createCodexSummaryFixture(homeDir, sessionId, projectPath, prompts, options = {}) {
  const { baseTimestamp = '2026-04-20T08:00:00.000Z' } = options;
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '04', '20');
  const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionsDir, { recursive: true });
  const lines = [
    JSON.stringify({
      type: 'session_meta',
      timestamp: baseTimestamp,
      payload: {
        id: sessionId,
        cwd: projectPath,
        model: 'gpt-5',
      },
    }),
    ...prompts.map((prompt, index) => JSON.stringify({
      type: 'event_msg',
      timestamp: new Date(new Date(baseTimestamp).getTime() + (index + 1) * 1000).toISOString(),
      payload: {
        type: 'user_message',
        message: prompt,
      },
    })),
  ];
  await fs.writeFile(sessionFile, `${lines.join('\n')}\n`, 'utf8');
}

test('getCodexSessionMessages returns only new mapped messages when afterLine is provided', async () => {
  await withTemporaryHome(async (tempHome) => {
    const sessionId = 'codex-after-line-session';
    await createCodexSessionFixture(tempHome, sessionId);

    const result = await getCodexSessionMessages(sessionId, null, 0, 2);

    assert.equal(result.total, 4);
    assert.equal(result.hasMore, false);
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[0].type, 'tool_use');
    assert.equal(result.messages[0].toolCallId, 'call_2');
    assert.equal(result.messages[1].type, 'tool_result');
    assert.equal(result.messages[1].toolCallId, 'call_2');
    assert.match(result.messages[0].toolInput, /alpha\\\\nbeta\\\\n/);
    assert.equal(result.messages[1].output, 'alpha\nbeta');
  });
});

test('getCodexSessionMessages maps Codex update functionCall envelopes to tool_use', async () => {
  await withTemporaryHome(async (tempHome) => {
    const sessionId = 'codex-update-function-call-session';
    await createCodexUpdateFunctionCallFixture(tempHome, sessionId);

    const result = await getCodexSessionMessages(sessionId, null, 0, null);

    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].type, 'tool_use');
    assert.equal(result.messages[0].toolName, 'update_plan');
    assert.equal(result.messages[0].toolCallId, 'call-update-plan-jsonl');
    assert.match(JSON.stringify(result.messages[0].toolInput), /Replay update_plan/);
    assert.ok(
      !JSON.stringify(result.messages).includes('"type":"update"'),
      'Codex update envelope must not leak to the frontend as raw JSON',
    );
  });
});

test('getCodexSessionMessages collapses duplicated Codex user echo records', async () => {
  await withTemporaryHome(async (tempHome) => {
    const sessionId = 'codex-duplicate-user-echo';
    const sessionsDir = path.join(tempHome, '.codex', 'sessions', '2026', '04', '30');
    const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
    const prompt = '把工作区的stage变更合并到 02080295 这个commit里';

    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      sessionFile,
      [
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-04-30T03:40:29.604Z',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: prompt }],
          },
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-04-30T03:40:29.605Z',
          payload: {
            type: 'user_message',
            message: prompt,
          },
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-04-30T03:40:30.604Z',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '已处理' }],
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    );

    const result = await getCodexSessionMessages(sessionId, null, 0, null);

    assert.equal(result.messages.filter((message) => message.type === 'user').length, 1);
    assert.equal(result.messages.length, 2);
  });
});

test('getCodexSessionMessages limits initial history to the newest requested lines', async () => {
  await withTemporaryHome(async (tempHome) => {
    const sessionId = 'codex-tail-window-session';
    await createCodexSessionFixture(tempHome, sessionId);

    const firstPage = await getCodexSessionMessages(sessionId, 2, 0, null);
    const olderPage = await getCodexSessionMessages(sessionId, 2, 2, null);

    assert.equal(firstPage.total, 4);
    assert.equal(firstPage.hasMore, true);
    assert.equal(firstPage.nextRawLineOffset, 2);
    assert.equal(firstPage.messages.length, 2);
    assert.equal(firstPage.messages[0].toolCallId, 'call_2');
    assert.equal(firstPage.messages[1].toolCallId, 'call_2');

    assert.equal(olderPage.total, 4);
    assert.equal(olderPage.hasMore, false);
    assert.equal(olderPage.nextRawLineOffset, 4);
    assert.equal(olderPage.messages.length, 2);
    assert.equal(olderPage.messages[0].toolCallId, 'call_1');
    assert.equal(olderPage.messages[1].toolCallId, 'call_1');
  });
});

test('getCodexSessionMessages uses raw line cursor and hides internal Codex roles', async () => {
  await withTemporaryHome(async (tempHome) => {
    const sessionId = 'codex-history-raw-cursor-and-internal-roles';
    const sessionsDir = path.join(tempHome, '.codex', 'sessions', '2026', '06', '07');
    const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
    const lines = [
      {
        type: 'session_meta',
        timestamp: '2026-06-07T04:00:00.000Z',
        payload: { id: sessionId, cwd: '/tmp/ozw-codex-history-project' },
      },
      {
        type: 'response_item',
        timestamp: '2026-06-07T04:00:00.001Z',
        payload: {
          type: 'message',
          role: 'developer',
          content: [{ type: 'input_text', text: '内部开发者指令，不应显示。' }],
        },
      },
    ];

    for (let turn = 1; turn <= 3; turn += 1) {
      const userText = `第${turn}轮用户需求`;
      lines.push(
        {
          type: 'response_item',
          timestamp: `2026-06-07T04:0${turn}:00.000Z`,
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: userText }],
          },
        },
        {
          type: 'event_msg',
          timestamp: `2026-06-07T04:0${turn}:00.001Z`,
          payload: { type: 'user_message', message: userText },
        },
        {
          type: 'response_item',
          timestamp: `2026-06-07T04:0${turn}:10.000Z`,
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: `第${turn}轮 assistant 回复` }],
          },
        },
        {
          type: 'response_item',
          timestamp: `2026-06-07T04:0${turn}:20.000Z`,
          payload: {
            type: 'function_call',
            name: 'exec_command',
            call_id: `call-${turn}`,
            arguments: JSON.stringify({ cmd: `printf turn-${turn}` }),
          },
        },
      );
    }

    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(sessionFile, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');

    const firstPage = await getCodexSessionMessages(sessionId, 5, 0, null);
    const secondPage = await getCodexSessionMessages(sessionId, 5, firstPage.nextRawLineOffset, null);
    const allMessages = await getCodexSessionMessages(sessionId, null, 0, null);
    const rawLineNumbers = (messages) => new Set(
      messages
        .map((message) => String(message.messageKey || '').match(/:line:(\d+):/)?.[1])
        .filter(Boolean),
    );
    const firstLines = rawLineNumbers(firstPage.messages);
    const secondLines = rawLineNumbers(secondPage.messages);
    const overlap = [...firstLines].filter((lineNumber) => secondLines.has(lineNumber));
    const userMessages = allMessages.messages.filter((message) => message.type === 'user');

    assert.equal(firstPage.nextRawLineOffset, 5);
    assert.deepEqual(overlap, []);
    assert.equal(
      allMessages.messages.some((message) => message.message?.role === 'developer'),
      false,
    );
    assert.deepEqual(
      userMessages.map((message) => message.message.content),
      ['第1轮用户需求', '第2轮用户需求', '第3轮用户需求'],
    );
  });
});

test('getCodexSessionMessages maps native Codex tool item records', async () => {
  await withTemporaryHome(async (tempHome) => {
    const sessionId = 'codex-native-tool-items';
    const sessionsDir = path.join(tempHome, '.codex', 'sessions', '2026', '04', '24');
    const sessionFile = path.join(sessionsDir, `${sessionId}.jsonl`);
    await fs.mkdir(sessionsDir, { recursive: true });
    const lines = [
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-24T08:00:00.000Z',
        payload: {
          type: 'command_execution',
          id: 'native_cmd',
          command: 'ctx_batch_execute',
          arguments: { queries: ['needle'] },
          output: 'line 1\nline 2',
          exitCode: 0,
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-24T08:00:01.000Z',
        payload: {
          type: 'file_change',
          id: 'native_edit',
          path: 'src/native.js',
          changeType: 'edit',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-24T08:00:02.000Z',
        payload: {
          type: 'mcp_tool_call',
          id: 'native_mcp',
          server: 'context_mode',
          name: 'ctx_batch_execute',
          arguments: { commands: [] },
          result: { content: 'indexed native result' },
        },
      }),
    ];
    await fs.writeFile(sessionFile, `${lines.join('\n')}\n`, 'utf8');

    const result = await getCodexSessionMessages(sessionId, null, 0, null);
    const toolUses = result.messages.filter((message) => message.type === 'tool_use');
    const toolResults = result.messages.filter((message) => message.type === 'tool_result');

    assert.deepEqual(
      toolUses.map((message) => [message.toolName, message.toolCallId]),
      [
        ['ctx_batch_execute', 'native_cmd'],
        ['FileChanges', 'native_edit'],
        ['context_mode:ctx_batch_execute', 'native_mcp'],
      ],
    );
    assert.deepEqual(toolUses[0].toolInput, { queries: ['needle'] });
    assert.equal(toolUses[1].toolInput.changes[0].path, 'src/native.js');
    assert.equal(toolResults.length, 3);
    assert.equal(toolResults[0].output, 'line 1\nline 2');
    assert.equal(toolResults[2].output, 'indexed native result');
  });
});

test('Codex project overview uses lightweight title without deep transcript summary', async () => {
  await withTemporaryHome(async (tempHome) => {
    clearProjectDirectoryCache();
    const projectPath = path.join(tempHome, 'workspace', 'codex-demo');
    await fs.mkdir(projectPath, { recursive: true });
    await addProjectManually(projectPath, 'Codex Demo');
    await createCodexSummaryFixture(tempHome, 'codex-summary-session', projectPath, ['ping', '修复首页空白问题']);

    const projects = await getProjects();
    const project = projects.find((entry) => entry.fullPath === projectPath || entry.path === projectPath);

    assert.ok(project);
    assert.equal(project.codexSessions.length, 1);
    assert.equal(project.codexSessions[0].summary, 'Codex Session');
    assert.equal(project.codexSessions[0].routeTitle, '修复首页空白问题');

    const detail = await getCodexSessionMessages('codex-summary-session', null, 0, null);
    assert.equal(
      detail.messages.some((message) => message.message?.content === '修复首页空白问题'),
      true,
    );
  });
});

test('Codex project overview card title uses first user request prefix', async () => {
  await withTemporaryHome(async (tempHome) => {
    clearProjectDirectoryCache();
    const projectPath = path.join(tempHome, 'workspace', 'codex-title-prefix');
    const firstRequest = '请修复项目主页手动会话卡片显示过多的问题并保持列表清爽';
    await fs.mkdir(projectPath, { recursive: true });
    await addProjectManually(projectPath, 'Codex Title Prefix');
    await createCodexSummaryFixture(tempHome, 'codex-title-prefix-session', projectPath, [firstRequest]);

    const projects = await getProjects();
    const project = projects.find((entry) => entry.fullPath === projectPath || entry.path === projectPath);

    assert.ok(project);
    assert.equal(project.codexSessions[0].routeTitle, Array.from(firstRequest).slice(0, 20).join(''));
  });
});

test('getCodexSessionMessages preserves assistant phase metadata from Codex transcripts', async () => {
  await withTemporaryHome(async (tempHome) => {
    const sessionId = 'codex-phase-session';
    await createCodexPhaseFixture(tempHome, sessionId);

    const result = await getCodexSessionMessages(sessionId, null, 0, null);
    const messages = Array.isArray(result.messages) ? result.messages : [];

    assert.equal(messages.length, 2);
    assert.equal(messages[0].message?.phase, 'commentary');
    assert.equal(messages[0].message?.content, '先继续排查路由映射。');
    assert.equal(messages[1].message?.phase, 'final_answer');
    assert.equal(messages[1].message?.content, '根因已经确认。');
  });
});

test('getProjects keeps every visible Codex session in project overview snapshots', async () => {
  await withTemporaryHome(async (tempHome) => {
    clearProjectDirectoryCache();
    const projectPath = path.join(tempHome, 'workspace', 'codex-overview-demo');
    await fs.mkdir(projectPath, { recursive: true });
    await addProjectManually(projectPath, 'Codex Overview Demo');

    for (let index = 0; index < 6; index += 1) {
      const sequence = String(index + 1).padStart(2, '0');
      await createCodexSummaryFixture(
        tempHome,
        `codex-overview-session-${sequence}`,
        projectPath,
        [`修复项目主页会话卡片限制 ${sequence}`],
        { baseTimestamp: `2026-04-20T08:00:${sequence}.000Z` },
      );
    }

    clearProjectDirectoryCache();
    const projects = await getProjects();
    const project = projects.find((entry) => entry.fullPath === projectPath || entry.path === projectPath);

    assert.ok(project);
    assert.equal(project.codexSessions.length, 6);
    assert.equal(project.codexSessions[0].summary, 'Codex Session');
    assert.equal(project.codexSessions[5].summary, 'Codex Session');
  });
});
