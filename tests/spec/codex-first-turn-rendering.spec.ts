// @ts-nocheck -- Proposal contract test uses browser-injected WebSocket runtime events.
/**
 * PURPOSE: 验收 Codex 手动会话首条用户消息后的 live 响应、命令卡和
 * JSONL 持久化收敛不会错位，并且命令卡不再显示可见 Output 摘要行。
 */
import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  authHeaders,
  authenticatePage,
  getFixtureProject,
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.ts';
import { openCodexFixtureRoute, waitForCodexFixtureSession } from './helpers/fixture-session-discovery.ts';
import { installProviderRuntimeHarness } from './helpers/provider-runtime-harness.ts';
import { getProjectLocalConfigPath } from '../../backend/project-config-store.ts';
import {
  appendCodexSessionEntries,
  codexAssistantMessageEntry,
  codexFunctionCallEntry,
  codexFunctionOutputEntry,
  codexUserMessageEntry,
  writeCodexSessionFixture,
} from './helpers/codex-jsonl-fixture.ts';
import {
  ensurePlaywrightFixture,
  PLAYWRIGHT_FIXTURE_HOME,
} from '../e2e/helpers/playwright-fixture.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results/oz-91-codex-first-turn-rendering');
const LIVE_REFRESH_DEBUG_DIR = path.resolve(process.cwd(), 'docs/debug/20260618-1024-live-reply-refresh/screenshots');
const SESSION_DAY = ['2026', '06', '09'];

/**
 * Build a user message row in Codex JSONL event shape.
 *
 * @param {string} timestamp
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
function userEvent(timestamp, text) {
  /** docstring: event_msg/user_message 是用户气泡的真实来源之一。 */
  return codexUserMessageEntry(timestamp, text);
}

/**
 * Build a visible assistant text row.
 *
 * @param {string} timestamp
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
function assistantMessage(timestamp, text) {
  /** docstring: output_text 覆盖 Codex JSONL 回放的正文路径。 */
  return codexAssistantMessageEntry(timestamp, text);
}

/**
 * Build a Codex function_call row for a command tool.
 *
 * @param {string} timestamp
 * @param {string} callId
 * @param {string} command
 * @returns {Record<string, unknown>}
 */
function commandToolCall(timestamp, callId, command) {
  /** docstring: functions.exec_command 是截图中最容易暴露 Output 行回归的命令类工具。 */
  return codexFunctionCallEntry(timestamp, callId, 'functions.exec_command', { cmd: command, yield_time_ms: 5000 });
}

/**
 * Build a Codex function_call_output row for a command tool.
 *
 * @param {string} timestamp
 * @param {string} callId
 * @param {string} output
 * @returns {Record<string, unknown>}
 */
function commandToolOutput(timestamp, callId, output) {
  /** docstring: 同一 call_id 的 output 必须补全原命令卡，而不是生成第二张卡。 */
  return codexFunctionOutputEntry(timestamp, callId, output);
}

/**
 * Build a non-visible lifecycle row.
 *
 * @param {string} timestamp
 * @param {string} type
 * @returns {Record<string, unknown>}
 */
function eventMsg(timestamp, type) {
  /** docstring: lifecycle 行不应生成聊天气泡，但真实 JSONL 里会出现。 */
  return {
    type: 'event_msg',
    timestamp,
    payload: { type },
  };
}

/**
 * Install a deterministic WebSocket transport while keeping real UI and APIs.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function installCodexSocketHarness(page) {
  await installProviderRuntimeHarness(page, {
    sentKey: '__oz91SentMessages',
    eventsKey: '__oz91RuntimeMessages',
    socketKey: '__oz91Socket',
    emitKey: '__oz91EmitSocketMessage',
  });
  await page.addInitScript(() => {
    window.localStorage.setItem('selected-provider', 'codex');
    window.localStorage.setItem('userLanguage', 'zh-CN');
  });
}

/**
 * Capture browser noise so the acceptance result is not hiding runtime failures.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {{ consoleErrors: string[], pageErrors: string[], ignoredRequestAborts: string[], failedRequests: string[] }}
 */
function attachNoiseRecorder(page) {
  /** docstring: 业务断言通过但浏览器报错时，验收仍然不可信。 */
  const recorder = {
    consoleErrors: [],
    pageErrors: [],
    ignoredRequestAborts: [],
    failedRequests: [],
  };

  page.on('console', (message) => {
    if (message.type() === 'error') {
      recorder.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    recorder.pageErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || 'unknown failure';
    if (failure === 'net::ERR_ABORTED') {
      recorder.ignoredRequestAborts.push(`${request.method()} ${request.url()} ${failure}`);
      return;
    }
    recorder.failedRequests.push(`${request.method()} ${request.url()} ${failure}`);
  });

  return recorder;
}

/**
 * Wait until the project API publishes the fixture Codex session.
 *
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} sessionId
 * @returns {Promise<{ project: Record<string, unknown>, session: Record<string, unknown> }>}
 */
async function getFixtureProjectWithCodexSession(request, sessionId) {
  /** docstring: Codex session discovery 是异步的，打开 cN 前必须等真实项目 API 可见。 */
  return waitForCodexFixtureSession(request, sessionId);
}

/**
 * Open the real project cN route for the generated Codex fixture session.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} sessionId
 * @returns {Promise<{ routeSessionId: string, providerSessionId: string }>}
 */
async function openManualCodexRoute(page, request, sessionId) {
  /** docstring: 用户实际看到的是项目内 cN 会话，不是裸 provider UUID 路由。 */
  const route = await openCodexFixtureRoute(page, request, sessionId);
  return {
    routeSessionId: route.routeSessionId,
    providerSessionId: route.providerSessionId,
  };
}

/**
 * Submit one prompt through the visible chat composer.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 * @returns {Promise<void>}
 */
async function submitUserMessage(page, text) {
  /** docstring: 只通过真实 textarea 发送，让 optimistic user row 由应用代码创建。 */
  const textarea = page.locator('textarea').first();
  await textarea.fill(text);
  await textarea.press('Control+Enter');
  await expect(page.locator('.chat-message.user').filter({ hasText: text })).toHaveCount(1);
}

/**
 * Return the codex-command sent by the real composer for the prompt.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} prompt
 * @returns {Promise<Record<string, unknown>>}
 */
async function waitForCodexCommand(page, prompt) {
  /** docstring: 证明测试不是直接拼 React state，而是真的走 composer submit。 */
  await expect.poll(async () => page.evaluate((expectedPrompt) => {
    const messages = window.__oz91SentMessages || [];
    const command = messages.find((message) => (
      message && typeof message === 'object' && message.type === 'codex-command' && message.command === expectedPrompt
    ));
    return command?.clientRequestId || '';
  }, prompt), { timeout: 5000 }).not.toBe('');

  return page.evaluate((expectedPrompt) => {
    const messages = window.__oz91SentMessages || [];
    return messages.find((message) => (
      message && typeof message === 'object' && message.type === 'codex-command' && message.command === expectedPrompt
    ));
  }, prompt);
}

/**
 * Emit one route-scoped Codex WebSocket message.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} routeSessionId
 * @param {Record<string, unknown>} message
 * @returns {Promise<void>}
 */
async function emitCodexSocketMessage(page, routeSessionId, message) {
  /** docstring: 所有 runtime 事件都带 cN 身份，防止未加 scope 的消息误通过。 */
  await page.evaluate((payload) => {
    window.__oz91EmitSocketMessage?.(payload);
  }, {
    provider: 'codex',
    sessionId: routeSessionId,
    ozwSessionId: routeSessionId,
    ozw_session_id: routeSessionId,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    ...message,
  });
}

/**
 * Emit one global project-list invalidation through the browser socket harness.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function emitProjectListInvalidated(page) {
  /** docstring: 复现后端 provider 绑定完成后发出的项目刷新事件。 */
  await page.evaluate((projectPath) => {
    window.__oz91EmitSocketMessage?.({
      type: 'project_list_invalidated',
      reason: 'manual-session-provider-bound',
      changedProjectPath: projectPath,
      scope: 'projects:list',
      version: String(Date.now()),
    });
  }, PRIMARY_FIXTURE_PROJECT_PATH);
}

/**
 * Read visible chat rows in DOM order.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<{ key: string, text: string }>>}
 */
async function readChatRows(page) {
  /** docstring: 最终验收以用户实际看到的 DOM 顺序为准。 */
  return page.locator('.chat-message').evaluateAll((rows) =>
    rows.map((row) => ({
      key: row.getAttribute('data-message-key') || '',
      text: (row.textContent || '').replace(/\s+/g, ' ').trim(),
    })).filter((row) => row.text),
  );
}

/**
 * Check whether expected texts appear in increasing chat row order.
 *
 * @param {Array<{ text: string }>} rows
 * @param {string[]} expectedTexts
 * @returns {boolean}
 */
function rowsContainInOrder(rows, expectedTexts) {
  /** docstring: 不绑定头像、时间或样式文案，只判断业务文本顺序。 */
  let searchFrom = 0;
  for (const expectedText of expectedTexts) {
    const foundIndex = rows.findIndex((row, index) => index >= searchFrom && row.text.includes(expectedText));
    if (foundIndex < 0) {
      return false;
    }
    searchFrom = foundIndex + 1;
  }
  return true;
}

/**
 * Count visible chat rows containing a specific text.
 *
 * @param {Array<{ text: string }>} rows
 * @param {string} text
 * @returns {number}
 */
function countRowsContaining(rows, text) {
  /** docstring: 用户消息和命令卡都只能出现一次，重复说明 merge 失败。 */
  return rows.filter((row) => row.text.includes(text)).length;
}

/**
 * Assert a command card uses icon-only output toggle and remains inspectable.
 *
 * @param {import('@playwright/test').Locator} card
 * @param {string} output
 * @returns {Promise<void>}
 */
async function expectCommandOutputIconOnly(card, output) {
  /** docstring: 禁止可见 Output summary，但保留图标展开和真实输出内容。 */
  await expect(card.locator('summary').filter({ hasText: /^\s*Output\s*$/ })).toHaveCount(0);
  const outputToggle = card.locator('[aria-label="Show output"], [aria-label="Hide output"]').first();
  await expect(outputToggle).toBeVisible();
  const outputBlock = card.locator('pre').filter({ hasText: output }).first();
  if (!(await outputBlock.isVisible().catch(() => false))) {
    await outputToggle.click();
  }
  await expect(outputBlock).toBeVisible();
  await expect(card.locator('[id^="tool-result-"], span[id^="tool-result-"]').first()).toHaveCount(1);
}

/**
 * Persist screenshots and browser state snapshots for QA review.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} screenshotName
 * @param {Record<string, unknown>} recorder
 * @returns {Promise<void>}
 */
async function saveEvidence(page, screenshotName, recorder) {
  /** docstring: 截图给人工复查，JSON 状态给自动复查顺序、WS 和浏览器噪声。 */
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${screenshotName}.png`), fullPage: true });

  const rows = await readChatRows(page);
  const cards = await page.getByTestId('codex-tool-card').evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
      outputSummaryCount: [...node.querySelectorAll('summary')]
        .filter((summary) => (summary.textContent || '').trim() === 'Output').length,
      resultAnchorCount: node.querySelectorAll('[id^="tool-result-"]').length,
    })),
  );
  const wsState = await page.evaluate(() => ({
    sentMessages: window.__oz91SentMessages || [],
    runtimeMessages: window.__oz91RuntimeMessages || [],
    location: window.location.href,
  }));

  const transcriptPath = path.join(EVIDENCE_DIR, 'transcript-state.json');
  let transcriptState = {};
  try {
    transcriptState = JSON.parse(await fs.readFile(transcriptPath, 'utf8'));
  } catch {
    transcriptState = {};
  }
  transcriptState[screenshotName] = { rows, cards };

  await fs.writeFile(transcriptPath, `${JSON.stringify(transcriptState, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(EVIDENCE_DIR, 'ws-messages.json'), `${JSON.stringify(wsState, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(EVIDENCE_DIR, 'console-network.json'), `${JSON.stringify(recorder, null, 2)}\n`, 'utf8');
}

/**
 * Assert the browser did not hide runtime failures during the contract flow.
 *
 * @param {Record<string, string[]>} recorder
 */
function expectNoRuntimeNoise(recorder) {
  /** docstring: 未解释的浏览器错误会让 UI 证据不可信。 */
  const unexpectedConsoleErrors = recorder.consoleErrors.filter((message) => (
    !message.includes('Error fetching slash commands: TypeError: Failed to fetch')
    && !message.includes('Failed to load Codex model catalog: TypeError: Failed to fetch')
  ));
  expect(unexpectedConsoleErrors, 'browser console errors').toEqual([]);
  expect(recorder.pageErrors, 'browser page errors').toEqual([]);
  expect(recorder.failedRequests, 'failed browser requests').toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
  await authenticatePage(page);
  await installCodexSocketHarness(page);
});

test('Codex 首条响应 live 和 persisted 阶段顺序稳定且命令卡没有可见 Output 行', async ({ page, request }) => {
  /**
   * 业务场景: 用户打开一个没有可见消息的 Codex 手动会话，发送首条消息后，
   * Codex live 返回 commentary、命令工具和最终正文。页面不能把这些内容错位、
   * 重复，也不能在命令卡底部显示被禁用的 Output 摘要行。
   */
  const recorder = attachNoiseRecorder(page);
  const sessionId = 'oz91-codex-first-turn-rendering';
  const prompt = '91 首条 Codex 消息：请读取 oz flow 状态并说明结果。';
  const commentary = '91 live commentary：准备读取当前仓库 oz flow 状态。';
  const command = 'rtk command -v oz';
  const output = '/home/zzl/.local/bin/oz\n';
  const finalText = '91 live final：已经找到 oz 命令并确认本轮响应顺序稳定。';
  const callId = 'oz91-first-turn-command';
  const secondCommand = 'cat /etc/hostname';
  const secondOutput = 'playwright-fixture\n';
  const secondCallId = 'oz91-live-command-execution';

  await writeCodexSessionFixture({
    sessionId,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionDay: SESSION_DAY,
    homeDir: PLAYWRIGHT_FIXTURE_HOME,
    timestamp: '2026-06-09T09:10:00.000Z',
  });
  const route = await openManualCodexRoute(page, request, sessionId);
  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();

  await submitUserMessage(page, prompt);
  const commandMessage = await waitForCodexCommand(page, prompt);
  expect(commandMessage.ozwSessionId || commandMessage.ozw_session_id || commandMessage.options?.ozwSessionId).toBe(route.routeSessionId);

  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'message-accepted',
    clientRequestId: commandMessage.clientRequestId,
  });
  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'session-status',
    isProcessing: true,
    turnId: `turn-${commandMessage.clientRequestId}`,
    turn_id: `turn-${commandMessage.clientRequestId}`,
  });
  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'oz91-live-commentary',
      message: {
        role: 'assistant',
        phase: 'commentary',
        content: commentary,
      },
    },
  });
  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'function_call',
      itemId: callId,
      item: {
        id: callId,
        type: 'function_call',
        call_id: callId,
        name: 'functions.exec_command',
        arguments: { cmd: command, yield_time_ms: 5000 },
      },
    },
  });
  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'function_call_output',
      itemId: callId,
      item: {
        id: callId,
        type: 'function_call_output',
        call_id: callId,
        output,
      },
    },
  });
  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'command_execution',
      itemId: secondCallId,
      status: 'completed',
      command: secondCommand,
      output: secondOutput,
      exitCode: 0,
    },
  });
  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'oz91-live-final',
      message: {
        role: 'assistant',
        phase: 'final',
        content: finalText,
      },
    },
  });

  await expect(transcript).toContainText(commentary);
  await expect(transcript).toContainText(command);
  await expect(transcript).toContainText(secondCommand);
  await expect(transcript).toContainText(finalText);
  const liveCommandCard = transcript.getByTestId('codex-tool-card').filter({ hasText: command }).first();
  await expect(liveCommandCard).toBeVisible();
  await expectCommandOutputIconOnly(liveCommandCard, output.trim());
  const liveSecondCommandCard = transcript.getByTestId('codex-tool-card').filter({ hasText: secondCommand }).first();
  await expect(liveSecondCommandCard).toBeVisible();
  await expectCommandOutputIconOnly(liveSecondCommandCard, secondOutput.trim());
  await expect.poll(async () => {
    const rows = await readChatRows(page);
    return rowsContainInOrder(rows, [prompt, commentary, command, secondCommand, finalText])
      && countRowsContaining(rows, prompt) === 1
      && countRowsContaining(rows, command) === 1
      && countRowsContaining(rows, secondCommand) === 1;
  }, { timeout: 5000 }).toBe(true);
  await saveEvidence(page, 'live-first-turn', recorder);

  await appendCodexSessionEntries(sessionId, [
    userEvent('2026-06-09T09:10:01.000Z', prompt),
    assistantMessage('2026-06-09T09:10:02.000Z', commentary),
    commandToolCall('2026-06-09T09:10:03.000Z', callId, command),
    commandToolOutput('2026-06-09T09:10:04.000Z', callId, output),
    assistantMessage('2026-06-09T09:10:05.000Z', finalText),
    eventMsg('2026-06-09T09:10:06.000Z', 'task_complete'),
  ], { sessionDay: SESSION_DAY, homeDir: PLAYWRIGHT_FIXTURE_HOME });
  await emitCodexSocketMessage(page, route.routeSessionId, {
    type: 'codex-complete',
    status: 'completed',
    actualSessionId: route.providerSessionId,
  });

  await expect.poll(async () => {
    const rows = await readChatRows(page);
    return rowsContainInOrder(rows, [prompt, commentary, command, finalText])
      && countRowsContaining(rows, prompt) === 1
      && countRowsContaining(rows, command) === 1;
  }, { timeout: 10_000 }).toBe(true);

  const persistedCommandCard = transcript.getByTestId('codex-tool-card').filter({ hasText: command }).first();
  await expect(persistedCommandCard).toBeVisible();
  await expectCommandOutputIconOnly(persistedCommandCard, output.trim());
  await saveEvidence(page, 'persisted-first-turn', recorder);
  expectNoRuntimeNoise(recorder);
});

test('Codex 手动会话 provider 绑定刷新期间保留 live 回复', async ({ page, request }) => {
  /**
   * 业务场景: WebUI 新建 cN 手动会话后，第一条回复正在 live 输出。
   * provider session 绑定完成会触发 project invalidation，但这个项目刷新
   * 不应把当前聊天页的 live 回复清空。
   */
  await page.addInitScript(() => {
    window.prompt = (_message, defaultValue = '') => String(defaultValue || '');
  });
  const recorder = attachNoiseRecorder(page);
  const project = await getFixtureProject(request);
  const providerSessionId = `oz91-live-refresh-provider-${Date.now()}`;
  const prompt = '91 live 刷新回归：请回复时保持动态渲染。';
  const liveBeforeRefresh = '91 live 刷新前：这条回复不能被项目 overview 刷新清空。';

  await writeCodexSessionFixture({
    sessionId: providerSessionId,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionDay: SESSION_DAY,
    homeDir: PLAYWRIGHT_FIXTURE_HOME,
    timestamp: '2026-06-09T09:20:00.000Z',
  });

  await openFixtureProject(page, { reset: false });
  const manualSessionGroup = page.locator('[data-testid="project-overview-manual-sessions"]').first();
  await expect(manualSessionGroup).toBeVisible();
  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();
  await page.getByTestId('project-new-session-provider-codex').click();
  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+$/);
  const routeSessionId = page.url().match(/\/(c\d+)(?:[?#].*)?$/)?.[1] || '';
  expect(routeSessionId).toMatch(/^c\d+$/);

  await submitUserMessage(page, prompt);
  const commandMessage = await waitForCodexCommand(page, prompt);
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'message-accepted',
    clientRequestId: commandMessage.clientRequestId,
  });
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'session-status',
    isProcessing: true,
    turnId: `turn-${commandMessage.clientRequestId}`,
    turn_id: `turn-${commandMessage.clientRequestId}`,
  });
  await emitCodexSocketMessage(page, routeSessionId, {
    type: 'codex-response',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'oz91-live-before-project-refresh',
      message: {
        role: 'assistant',
        phase: 'commentary',
        content: liveBeforeRefresh,
      },
    },
  });
  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(transcript).toContainText(liveBeforeRefresh);

  const finalizeResponse = await request.post(
    `/api/projects/${encodeURIComponent(project.name)}/manual-sessions/${routeSessionId}/finalize`,
    {
      headers: authHeaders(),
      data: {
        actualSessionId: providerSessionId,
        provider: 'codex',
        projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
      },
    },
  );
  expect(finalizeResponse.ok()).toBeTruthy();

  await Promise.all([
    page.waitForResponse((response) => (
      response.url().includes('/overview')
      && response.url().includes(encodeURIComponent(PRIMARY_FIXTURE_PROJECT_PATH))
      && response.status() === 200
    ), { timeout: 5000 }).catch(() => null),
    emitProjectListInvalidated(page),
  ]);

  await expect(transcript).toContainText(liveBeforeRefresh);

  await fs.mkdir(LIVE_REFRESH_DEBUG_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(LIVE_REFRESH_DEBUG_DIR, 'codex-live-reply-after-project-refresh.png'),
    fullPage: true,
  });
  await saveEvidence(page, 'live-refresh-preserved', recorder);
  expectNoRuntimeNoise(recorder);
});

test('Codex cN route 消息刷新保持 route-scoped 加载入口', async ({ page, request }) => {
  /**
   * 业务场景: 用户从项目页打开 `cN` 手动会话时，运行中回复恢复依赖
   * route-scoped messages API 合并 active-turn overlay；前端不能在 overview
   * 解析出 provider UUID 后切到裸 provider messages API。
   */
  const recorder = attachNoiseRecorder(page);
  const sessionId = `oz91-route-scoped-loader-${Date.now()}`;
  const persistedUser = '91 cN route loader：用户已进入 provider-backed 手动会话。';
  const persistedAssistant = '91 cN route loader：历史消息通过 cN route 加载。';
  const messageRequests = [];

  await writeCodexSessionFixture({
    sessionId,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    sessionDay: SESSION_DAY,
    homeDir: PLAYWRIGHT_FIXTURE_HOME,
    timestamp: '2026-06-09T09:30:00.000Z',
    entries: [
      userEvent('2026-06-09T09:30:01.000Z', persistedUser),
      assistantMessage('2026-06-09T09:30:02.000Z', persistedAssistant),
    ],
  });
  const configPath = getProjectLocalConfigPath(PRIMARY_FIXTURE_PROJECT_PATH);
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const chat = Object.fromEntries(
    Object.entries(config.chat || {}).filter(([, record]) => record?.sessionId !== sessionId),
  ) as Record<string, Record<string, unknown>>;
  const routeIndex = Math.max(
    0,
    ...Object.keys(chat).map((key) => Number(key)).filter((value) => Number.isInteger(value) && value > 0),
  ) + 1;
  const routeSessionId = `c${routeIndex}`;
  config.chat = chat;
  chat[String(routeIndex)] = {
    sessionId,
    providerSessionId: sessionId,
    provider: 'codex',
    title: 'Codex route-scoped loader',
  };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  page.on('request', (pageRequest) => {
    const url = pageRequest.url();
    if (url.includes('/messages')) {
      messageRequests.push(url);
    }
  });

  const project = await getFixtureProject(request);
  const route = {
    project,
    session: config.chat[String(routeIndex)],
    routeSessionId,
    providerSessionId: sessionId,
  };
  await openFixtureProject(page, { reset: false });
  await page.goto(`${project.routePath}/${routeSessionId}`, { waitUntil: 'domcontentloaded' });
  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(transcript).toContainText(persistedAssistant);
  await page.waitForTimeout(1200);

  const routeScopedRequests = messageRequests.filter((url) => url.includes(`/sessions/${route.routeSessionId}/messages`));
  const providerScopedRequests = messageRequests.filter((url) => url.includes(`/api/codex/sessions/${sessionId}/messages`));
  await fs.writeFile(
    path.join(EVIDENCE_DIR, 'route-scoped-message-requests.json'),
    `${JSON.stringify({ route, messageRequests, routeScopedRequests, providerScopedRequests }, null, 2)}\n`,
    'utf8',
  );

  expect(routeScopedRequests.length, 'cN route must request route-scoped messages').toBeGreaterThan(0);
  expect(providerScopedRequests, 'cN route must not bypass active-turn overlay with provider UUID messages API').toEqual([]);
  await saveEvidence(page, 'route-scoped-loader', recorder);
});
