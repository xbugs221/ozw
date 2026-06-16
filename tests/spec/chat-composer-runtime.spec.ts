// @ts-nocheck -- Browser runtime fixtures deliberately patch WebSocket.
/**
 * PURPOSE: Stable browser specification for chat composer submission and
 * running manual-session visibility. It verifies real project/session routes,
 * settings visibility, WebSocket command contracts, and abort behavior.
 *
 * Sources: 89-前端-chat-CtrlEnter发送和运行态可见
 */
import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  authenticatePage,
  openFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from './helpers/spec-test-helpers.ts';
import {
  bindCodexFixtureManualRoute,
  codexFunctionCallEntry,
  codexFunctionOutputEntry,
} from './helpers/codex-jsonl-fixture.ts';
import { installProviderRuntimeHarness } from './helpers/provider-runtime-harness.ts';
import { PLAYWRIGHT_FIXTURE_PROJECT_PATHS } from '../e2e/helpers/playwright-fixture.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results', 'spec-chat-composer-runtime');
const ACTIVE_TURN_EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results', 'active-turn-indicator');
const MATX_PROJECT_PATH = PLAYWRIGHT_FIXTURE_PROJECT_PATHS.find((projectPath) =>
  projectPath.endsWith(`${path.sep}workspace${path.sep}matx`),
) || path.join(path.dirname(PRIMARY_FIXTURE_PROJECT_PATH), 'matx');
const VIEW_IMAGE_SESSION_ID = 'codex-view-image-tool-link';
const VIEW_IMAGE_RELATIVE_PATH = 'images/view-image-tool-link.png';
const READ_TOOL_SESSION_ID = 'codex-read-tool-link';
const READ_TOOL_RELATIVE_PATH = 'src/read-tool-link.ts';
const EDIT_TOOL_SESSION_ID = 'codex-edit-tool-link';
const EDIT_TOOL_RELATIVE_PATH = 'src/edit-tool-link.ts';
const TINY_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92,
  0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

/**
 * Ensure screenshots and state snapshots can be written by every scenario.
 *
 * @returns {Promise<void>}
 */
async function ensureEvidenceDir() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.mkdir(ACTIVE_TURN_EVIDENCE_DIR, { recursive: true });
}

/**
 * Build the same readable project route prefix that the app uses for fixtures.
 *
 * @param {string} projectPath
 * @returns {string}
 */
function buildProjectRoutePrefix(projectPath) {
  const homePath = process.env.HOME || process.env.USERPROFILE || '';
  const relativePath = path.relative(homePath, projectPath).split(path.sep).join('/');
  return `/${relativePath}`;
}

/**
 * Install a deterministic chat runtime while preserving auth, project APIs,
 * route resolution, and React rendering.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function installChatRuntimeFixture(page) {
  await installProviderRuntimeHarness(page, {
    sentKey: '__chatRuntimeSharedSentMessages',
    eventsKey: '__chatRuntimeSharedEvents',
    socketKey: '__chatRuntimeSharedSocket',
    emitKey: '__chatRuntimeSharedEmit',
    onSendKey: '__chatRuntimeOnSend',
  });
  await page.addInitScript(() => {
    window.__chatRuntimeSentMessages = window.__chatRuntimeSharedSentMessages || [];
    window.__chatRuntimeEvents = window.__chatRuntimeSharedEvents || [];
    window.__chatRuntimeEmit = window.__chatRuntimeSharedEmit;
    window.localStorage.setItem('selected-provider', 'codex');
    window.localStorage.setItem('userLanguage', 'zh-CN');
    window.localStorage.removeItem('uiPreferences');
    window.localStorage.removeItem('sendByCtrlEnter');
    const activeTurnStartedAtKey = '__chatRuntime:c73:turnStartedAt';
    const activeCommandSessionsKey = '__chatRuntime:activeCommandSessions';

    const readActiveCommandSessions = () => {
      try {
        return JSON.parse(window.localStorage.getItem(activeCommandSessionsKey) || '{}');
      } catch {
        return {};
      }
    };

    const writeActiveCommandSessions = (sessions) => {
      window.localStorage.setItem(activeCommandSessionsKey, JSON.stringify(sessions));
    };

    const activeCommandTurnStartedAtKey = (sessionId) => `__chatRuntime:${sessionId}:turnStartedAt`;

    const emitRunningStatus = (sessionId, turnId, turnStartedAt) => {
      window.__chatRuntimeEmit?.({
        type: 'session-status',
        provider: 'codex',
        sessionId,
        ozwSessionId: sessionId,
        ozw_session_id: sessionId,
        isProcessing: true,
        turnId,
        turn_id: turnId,
        turnStartedAt,
        turn_started_at: turnStartedAt,
      });
    };

    window.__chatRuntimeOnSend = (message) => {
      if (message.type === 'codex-command' || message.type === 'pi-command') {
        const commandSessionId = message.ozwSessionId || message.ozw_session_id || message.sessionId;
        if (!commandSessionId) {
          return;
        }
        if (message.clientRequestId) {
          window.__chatRuntimeEmit?.({
            type: 'message-accepted',
            provider: message.provider || 'codex',
            sessionId: commandSessionId,
            ozwSessionId: commandSessionId,
            ozw_session_id: commandSessionId,
            clientRequestId: message.clientRequestId,
          });
        }
        const turnStartedAt =
          window.localStorage.getItem(activeCommandTurnStartedAtKey(commandSessionId)) ||
          new Date(Date.now() - 65_000).toISOString();
        const activeCommandSessions = readActiveCommandSessions();
        activeCommandSessions[commandSessionId] = {
          turnId: `turn-${commandSessionId}-sent`,
          turnStartedAt,
        };
        window.localStorage.setItem(activeCommandTurnStartedAtKey(commandSessionId), turnStartedAt);
        writeActiveCommandSessions(activeCommandSessions);
        emitRunningStatus(commandSessionId, activeCommandSessions[commandSessionId].turnId, turnStartedAt);
        return;
      }

      if (message.type !== 'check-session-status') {
        return;
      }

      const requestedRouteSession =
        message.ozwSessionId ||
        message.ozw_session_id ||
        (String(message.sessionId || '').match(/^c\d+$/) ? message.sessionId : null);

      if (requestedRouteSession === 'c73') {
        const turnStartedAt =
          window.localStorage.getItem(activeTurnStartedAtKey) ||
          new Date(Date.now() - 65_000).toISOString();
        window.localStorage.setItem(activeTurnStartedAtKey, turnStartedAt);
        window.__chatRuntimeEmit?.({
          type: 'session-status',
          provider: 'codex',
          sessionId: 'provider-session-c73',
          ozwSessionId: 'c73',
          ozw_session_id: 'c73',
          isProcessing: true,
          turnId: 'turn-c73-live',
          turn_id: 'turn-c73-live',
          turnStartedAt,
          turn_started_at: turnStartedAt,
        });

        setTimeout(() => {
          window.__chatRuntimeEmit?.({
            type: 'codex-response',
            provider: 'codex',
            sessionId: 'provider-session-c73',
            ozwSessionId: 'c73',
            ozw_session_id: 'c73',
            data: {
              type: 'item',
              itemType: 'agent_message',
              itemId: 'agent-message-c73-live',
              message: {
                role: 'assistant',
                content: 'SPEC_C73_LIVE_OUTPUT',
              },
            },
          });
        }, 50);
        return;
      }

      const activeCommandSessions = readActiveCommandSessions();
      if (requestedRouteSession && activeCommandSessions[requestedRouteSession]) {
        const activeTurn = activeCommandSessions[requestedRouteSession];
        emitRunningStatus(requestedRouteSession, activeTurn.turnId, activeTurn.turnStartedAt);
        return;
      }

      window.__chatRuntimeEmit?.({
        type: 'session-status',
        provider: 'codex',
        sessionId: message.sessionId,
        ozwSessionId: requestedRouteSession,
        isProcessing: false,
      });
    };

    window.__chatRuntimeCompleteSession = (sessionId) => {
      const activeCommandSessions = readActiveCommandSessions();
      delete activeCommandSessions[sessionId];
      writeActiveCommandSessions(activeCommandSessions);
      window.localStorage.removeItem(activeCommandTurnStartedAtKey(sessionId));
      window.__chatRuntimeEmit?.({
        type: 'session-status',
        provider: 'codex',
        sessionId,
        ozwSessionId: sessionId,
        ozw_session_id: sessionId,
        isProcessing: false,
      });
    };

    window.__chatRuntimeEmitToolLifecycle = (phase) => {
      const callId = 'chat-runtime-tool-call-1';
      if (phase === 'start') {
        window.__chatRuntimeEmit?.({
          type: 'loading_progress',
          provider: 'codex',
          sessionId: 'provider-session-c73',
          ozwSessionId: 'c73',
          ozw_session_id: 'c73',
          phase: 'tool_start',
          current: 1,
          total: 2,
        });
        return;
      }

      window.__chatRuntimeEmit?.({
        type: 'codex-response',
        provider: 'codex',
        sessionId: 'provider-session-c73',
        ozwSessionId: 'c73',
        ozw_session_id: 'c73',
        data: {
          type: 'item',
          itemType: 'function_call_output',
          itemId: callId,
          status: 'completed',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: 'CHAT_RUNTIME_TOOL_OUTPUT\n',
          },
        },
      });
    };
  });
}

/**
 * Return composer commands emitted by the browser.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function providerCommands(page) {
  return page.evaluate(() =>
    (window.__chatRuntimeSentMessages || []).filter((message) =>
      message.type === 'codex-command' || message.type === 'pi-command',
    ),
  );
}

/**
 * Persist browser runtime state as a reviewable artifact.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} fileName
 * @returns {Promise<void>}
 */
async function writeBrowserState(page, fileName) {
  const state = await page.evaluate(() => ({
    sentMessages: window.__chatRuntimeSentMessages || [],
    runtimeEvents: window.__chatRuntimeEvents || [],
    location: window.location.href,
  }));
  await fs.writeFile(path.join(EVIDENCE_DIR, fileName), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Write a real Codex JSONL fixture so the page loads tool cards through the
 * production messages API instead of a route-level mock.
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {string} args.userMessage
 * @param {string} args.toolName
 * @param {Record<string, unknown>} args.toolArguments
 * @returns {Promise<string>}
 */
async function writeCodexToolCardFixture({ sessionId, userMessage, toolName, toolArguments }) {
  const playwrightHome = path.resolve(MATX_PROJECT_PATH, '..', '..');
  const sessionDir = path.join(playwrightHome, '.codex', 'sessions', '2026', '06', '15');
  await fs.mkdir(sessionDir, { recursive: true });
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  const timestamp = '2026-06-15T12:49:00.000Z';
  const lines = [
    {
      type: 'session_meta',
      timestamp,
      payload: {
        id: sessionId,
        cwd: MATX_PROJECT_PATH,
        model: 'gpt-5-codex',
      },
    },
    {
      type: 'event_msg',
      timestamp,
      payload: {
        type: 'user_message',
        message: userMessage,
      },
    },
    codexFunctionCallEntry('2026-06-15T12:49:01.000Z', `${sessionId}-call`, toolName, toolArguments),
    codexFunctionOutputEntry('2026-06-15T12:49:02.000Z', `${sessionId}-call`, `${toolName} complete`),
  ];
  await fs.writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  await bindCodexFixtureManualRoute(sessionId, MATX_PROJECT_PATH, userMessage);
  return sessionPath;
}

/**
 * Write the image fixture asset and JSONL transcript for view_image.
 *
 * @returns {Promise<string>}
 */
async function writeViewImageCodexFixture() {
  const imagePath = path.join(MATX_PROJECT_PATH, VIEW_IMAGE_RELATIVE_PATH);
  await fs.mkdir(path.dirname(imagePath), { recursive: true });
  await fs.writeFile(imagePath, TINY_PNG_BYTES);
  await writeCodexToolCardFixture({
    sessionId: VIEW_IMAGE_SESSION_ID,
    userMessage: 'open generated image from view_image tool card',
    toolName: 'functions.view_image',
    toolArguments: { path: imagePath },
  });
  return imagePath;
}

/**
 * Write a text file plus a Read/Edit tool-card transcript for browser open tests.
 *
 * @param {object} args
 * @param {string} args.sessionId
 * @param {string} args.relativePath
 * @param {string} args.toolName
 * @param {Record<string, unknown>} args.toolArguments
 * @returns {Promise<string>}
 */
async function writeTextToolCodexFixture({ sessionId, relativePath, toolName, toolArguments }) {
  const absolutePath = path.join(MATX_PROJECT_PATH, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, 'export const toolOpenFile = true;\n', 'utf8');
  await writeCodexToolCardFixture({
    sessionId,
    userMessage: `open ${relativePath} from ${toolName} tool card`,
    toolName,
    toolArguments: { ...toolArguments, file_path: absolutePath },
  });
  return absolutePath;
}

/**
 * Open the primary fixture project's manual chat route.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<import('@playwright/test').Locator>}
 */
async function openFixtureManualChat(page) {
  await openFixtureProject(page);
  await page.getByRole('button', { name: /fixture-project manu/i }).first().click();
  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible();
  return textarea;
}

test.beforeEach(async ({ page }) => {
  await ensureEvidenceDir();
  await authenticatePage(page);
  await installChatRuntimeFixture(page);
});

test('chat composer keeps bare Enter as newline and submits only with Ctrl or Meta Enter', async ({ page }) => {
  /** Business rule: multiline prompts must not be submitted accidentally. */
  const textarea = await openFixtureManualChat(page);
  const initialCommandCount = (await providerCommands(page)).length;

  await textarea.fill('spec bare enter draft');
  await textarea.press('Enter');

  await expect.poll(async () => (await providerCommands(page)).length).toBe(initialCommandCount);
  await expect(textarea).toHaveValue('spec bare enter draft\n');
  await expect(page.locator('.chat-message.user').filter({ hasText: 'spec bare enter draft' })).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'shortcut-no-send.png'), fullPage: true });

  await textarea.fill('spec ctrl enter draft');
  await textarea.press('Control+Enter');
  await expect.poll(async () => {
    const commands = await providerCommands(page);
    return commands.some((message) => message.command === 'spec ctrl enter draft');
  }).toBe(true);
  await expect(textarea).toHaveValue('');
  await expect(page.getByTestId('chat-active-turn-indicator')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('chat-active-turn-elapsed')).toHaveText(/0?1:0[5-9]|0?1:1\d/);
  await page.screenshot({ path: path.join(ACTIVE_TURN_EVIDENCE_DIR, 'send-active-turn-indicator.png'), fullPage: true });
  await page.evaluate(() => window.__chatRuntimeCompleteSession?.('c1'));
  await expect(page.getByTestId('chat-active-turn-indicator')).toHaveCount(0);

  await textarea.fill('spec meta enter draft');
  await textarea.press('Meta+Enter');
  await expect.poll(async () => {
    const commands = await providerCommands(page);
    return commands.some((message) => message.command === 'spec meta enter draft');
  }).toBe(true);
  await expect(textarea).toHaveValue('');

  await writeBrowserState(page, 'shortcut-ws-messages.json');
});

test('settings no longer expose a sendByCtrlEnter toggle', async ({ page }) => {
  /** Business rule: users cannot re-enable bare Enter sending from settings. */
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /设置|Settings/ }).first().click();

  await expect(page.getByText('使用 Ctrl+Enter 发送')).toHaveCount(0);
  await expect(page.getByText('Send by Ctrl+Enter')).toHaveCount(0);
  await expect(page.getByText(/按 Ctrl\+Enter 发送消息/)).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'settings-no-shortcut-toggle.png'), fullPage: true });
});

test('running cN session shows provider live output and sends abort for the route session', async ({ page }) => {
  /** Business rule: cN routes stay visibly running when provider status uses another session id. */
  const matxRoute = `${buildProjectRoutePrefix(MATX_PROJECT_PATH)}/c73`;
  await page.goto(matxRoute, { waitUntil: 'networkidle' });
  await expect(page.locator('textarea').first()).toBeVisible();

  await expect(page.getByText('SPEC_C73_LIVE_OUTPUT')).toBeVisible({ timeout: 10_000 });
  const activeTurnIndicator = page.getByTestId('chat-active-turn-indicator');
  await expect(activeTurnIndicator).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('chat-active-turn-elapsed')).toHaveText(/0?1:0[5-9]|0?1:1\d/);
  const stopButton = page.getByRole('button', { name: /停止|stop/i });
  await expect(stopButton).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'c73-live-stop.png'), fullPage: true });
  await activeTurnIndicator.screenshot({ path: path.join(ACTIVE_TURN_EVIDENCE_DIR, 'c73-active-turn-indicator.png') });

  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('chat-active-turn-indicator')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('chat-active-turn-elapsed')).toHaveText(/0?1:0[5-9]|0?1:1\d/);
  await page.getByTestId('chat-active-turn-indicator').screenshot({
    path: path.join(ACTIVE_TURN_EVIDENCE_DIR, 'c73-active-turn-indicator-after-reload.png'),
  });
  const c73RunningStartedAtValues = await page.evaluate(() =>
    (window.__chatRuntimeEvents || [])
      .filter((event) =>
        event.type === 'session-status' &&
        event.ozwSessionId === 'c73' &&
        event.turnId === 'turn-c73-live' &&
        event.isProcessing === true
      )
      .map((event) => event.turnStartedAt),
  );
  expect(c73RunningStartedAtValues.length).toBeGreaterThanOrEqual(2);
  expect(new Set(c73RunningStartedAtValues).size).toBe(1);

  await stopButton.click();
  await expect.poll(async () => {
    return page.evaluate(() =>
      (window.__chatRuntimeSentMessages || []).some((message) =>
        message.type === 'abort-session' &&
        message.provider === 'codex' &&
        (
          message.sessionId === 'c73' ||
          message.ozwSessionId === 'c73' ||
          message.ozw_session_id === 'c73' ||
          message.sessionId === 'provider-session-c73'
        ),
      ),
    );
  }).toBe(true);

  await writeBrowserState(page, 'c73-runtime-state.json');
  await fs.writeFile(
    path.join(ACTIVE_TURN_EVIDENCE_DIR, 'c73-active-turn-state.json'),
    `${JSON.stringify({
      events: await page.evaluate(() => window.__chatRuntimeEvents || []),
      elapsedText: await page.getByTestId('chat-active-turn-elapsed').textContent(),
    }, null, 2)}\n`,
    'utf8',
  );
});

test('running cN session shows only the completed tool card', async ({ page }) => {
  /** Business rule: tool start events are internal progress; users see the completed card once output arrives. */
  const matxRoute = `${buildProjectRoutePrefix(MATX_PROJECT_PATH)}/c73`;
  await page.goto(matxRoute, { waitUntil: 'networkidle' });
  await expect(page.locator('textarea').first()).toBeVisible();
  await expect(page.getByTestId('chat-active-turn-indicator')).toBeVisible({ timeout: 10_000 });

  await expect(page.getByTestId('codex-tool-card')).toHaveCount(0);
  await page.evaluate(() => window.__chatRuntimeEmitToolLifecycle?.('start'));
  await expect(page.getByTestId('codex-tool-card')).toHaveCount(0);

  await page.evaluate(() => window.__chatRuntimeEmitToolLifecycle?.('complete'));
  await expect(page.getByTestId('codex-tool-card')).toHaveCount(1);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'c73-completed-tool-card-only.png'), fullPage: true });

  await writeBrowserState(page, 'c73-tool-card-runtime-state.json');
});

test('view_image tool card path opens the image preview', async ({ page }) => {
  /** Business rule: a generated image path in a view_image tool card is a direct workspace file link. */
  await writeViewImageCodexFixture();
  const matxRoute = `${buildProjectRoutePrefix(MATX_PROJECT_PATH)}/${VIEW_IMAGE_SESSION_ID}`;
  await page.goto(matxRoute, { waitUntil: 'networkidle' });
  await page.getByText('open generated image').first().click();

  const imagePathButton = page.getByRole('button', { name: VIEW_IMAGE_RELATIVE_PATH });
  await expect(imagePathButton).toBeVisible();
  await imagePathButton.click();
  await expect(page.getByRole('img', { name: path.basename(VIEW_IMAGE_RELATIVE_PATH) })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'view-image-tool-link-opened.png'), fullPage: true });
});

test('Read tool card path opens the text editor', async ({ page }) => {
  /** Business rule: Read file paths use the same workspace file-open flow as image tools. */
  await writeTextToolCodexFixture({
    sessionId: READ_TOOL_SESSION_ID,
    relativePath: READ_TOOL_RELATIVE_PATH,
    toolName: 'Read',
    toolArguments: {},
  });
  const matxRoute = `${buildProjectRoutePrefix(MATX_PROJECT_PATH)}/${READ_TOOL_SESSION_ID}`;
  await page.goto(matxRoute, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /open src\/read-tool-l/i }).first().click();

  const openReadButton = page.getByRole('button', { name: `Open ${READ_TOOL_RELATIVE_PATH}` });
  await expect(openReadButton).toBeVisible();
  await openReadButton.click();
  await expect(
    page.getByTestId('workspace-dock-layout').getByRole('heading', { name: path.basename(READ_TOOL_RELATIVE_PATH) }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Save|保存/i })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'read-tool-link-opened.png'), fullPage: true });
});

test('Edit tool card path opens diff context in the text editor', async ({ page }) => {
  /** Business rule: Edit cards open the target file while carrying the old/new diff context. */
  await writeTextToolCodexFixture({
    sessionId: EDIT_TOOL_SESSION_ID,
    relativePath: EDIT_TOOL_RELATIVE_PATH,
    toolName: 'Edit',
    toolArguments: {
      old_string: 'export const toolOpenFile = true;',
      new_string: 'export const toolOpenFile = "edited";',
    },
  });
  const matxRoute = `${buildProjectRoutePrefix(MATX_PROJECT_PATH)}/${EDIT_TOOL_SESSION_ID}`;
  await page.goto(matxRoute, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /open src\/edit-tool-l/i }).first().click();

  const openEditButton = page.getByRole('button', { name: `Open ${EDIT_TOOL_RELATIVE_PATH}` });
  await expect(openEditButton).toBeVisible();
  await openEditButton.click();
  await expect(
    page.getByTestId('workspace-dock-layout').getByRole('heading', { name: path.basename(EDIT_TOOL_RELATIVE_PATH) }),
  ).toBeVisible();
  await expect(page.getByText('显示更改')).toBeVisible();
  await expect(page.getByRole('button', { name: /Save|保存/i })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'edit-tool-link-opened.png'), fullPage: true });
});

test('running cN follow-up turns green and renders live output before JSONL catches up', async ({ page }) => {
  /** Business rule: accepted follow-up sends turn green and live output renders before persisted history catches up. */
  let includePersistedFollowup = false;
  await page.route('**/api/projects/**/sessions/c73/messages**', async (route) => {
    const messages = includePersistedFollowup
      ? [
          {
            type: 'message',
            timestamp: '2026-06-14T06:20:00.000Z',
            provider: 'codex',
            messageKey: 'persisted-followup-user-c73',
            message: { role: 'user', content: 'CHAT_RUNTIME_FOLLOWUP_DEDUPE' },
          },
        ]
      : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages,
        total: messages.length,
        hasMore: false,
        appendCursor: includePersistedFollowup ? 'cursor-followup-1' : 'cursor-empty',
      }),
    });
  });

  const matxRoute = `${buildProjectRoutePrefix(MATX_PROJECT_PATH)}/c73`;
  await page.goto(matxRoute, { waitUntil: 'networkidle' });
  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible();

  await textarea.fill('CHAT_RUNTIME_FOLLOWUP_DEDUPE');
  await textarea.press('Control+Enter');
  const followupRows = page.locator('.chat-message.user').filter({ hasText: 'CHAT_RUNTIME_FOLLOWUP_DEDUPE' });
  await expect(followupRows).toHaveCount(1);
  await expect(followupRows.first()).toHaveAttribute('data-delivery-status', 'persisted');
  await expect(followupRows.first().locator(':scope > div > div').first()).toHaveCSS('background-color', 'rgb(22, 163, 74)');
  await page.evaluate(() => window.__chatRuntimeEmit?.({
    type: 'codex-response',
    provider: 'codex',
    sessionId: 'provider-session-c73',
    ozwSessionId: 'c73',
    ozw_session_id: 'c73',
    data: {
      type: 'item',
      itemType: 'agent_message',
      itemId: 'c73-followup-live-before-jsonl',
      message: {
        role: 'assistant',
        content: 'CHAT_RUNTIME_LIVE_BEFORE_JSONL',
      },
      status: 'completed',
    },
  }));
  await expect(page.getByText('CHAT_RUNTIME_LIVE_BEFORE_JSONL')).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'c73-followup-green-live-before-jsonl.png'), fullPage: true });

  includePersistedFollowup = true;
  await page.evaluate(() => window.__chatRuntimeEmit?.({
    type: 'codex-complete',
    provider: 'codex',
    sessionId: 'c73',
    ozwSessionId: 'c73',
    ozw_session_id: 'c73',
    status: 'completed',
  }));

  await expect(followupRows).toHaveCount(1);
  await expect(followupRows.first()).toHaveAttribute('data-delivery-status', 'persisted');
  await expect(followupRows.first().locator(':scope > div > div').first()).toHaveCSS('background-color', 'rgb(22, 163, 74)');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'c73-followup-dedupe.png'), fullPage: true });

  await writeBrowserState(page, 'c73-followup-dedupe-state.json');
});
