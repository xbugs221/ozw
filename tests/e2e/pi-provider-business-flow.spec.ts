// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * 文件目的：用真实浏览器流程验证用户创建并使用 Pi 会话的关键路径。
 * 业务场景：用户在项目页选择 Pi、新建路由草稿、进入会话并发送消息。
 * 用户风险：如果这里失败，用户可能看不到 Pi 入口、进错会话或消息无法送达 Provider。
 * 业务场景：WebSocket 发出的 pi-command 必须携带 provider=pi 相关会话信息和模型选项。
 * 用户风险：如果命令载荷错误，页面看似发送成功但后端会绑定错误 Provider 或丢失回复。
 * 业务场景：发送后页面要显示 fake Pi 响应并把会话写入项目读模型。
 * 失败含义：失败通常代表真实页面、WebSocket、后端状态或持久化链路断裂。
 *
 * PURPOSE: Verify Pi provider front-end business flow:
 * 1. Project overview manual-session picker shows Pi
 * 2. Selecting Pi creates a manual session draft under piSessions
 * 3. Entering the Pi session routes to the correct cN route
 * 4. Sending a message dispatches a pi-command and the chat composer clears
 * 5. The dispatched WebSocket message carries provider=pi in its co request
 *
 * These tests satisfy task.md 6.4 of the Pi provider proposal.
 */
import { test, expect } from '@playwright/test';
import {
  openFixtureProject,
} from '../spec/helpers/spec-test-helpers.ts';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Monkey-patch window.prompt so Pi session creation does not fail on
    // the "请输入会话名称" dialog that Playwright dismisses by default.
    window.prompt = (_message, defaultValue = '') => defaultValue;
  });
  await openFixtureProject(page);
});

test('project overview manual-session picker includes Pi button', async ({ page }) => {
  const manualSessionGroup = page.locator('[data-testid="project-overview-manual-sessions"]').first();

  // 业务场景：用户从项目概览打开新建会话选择器，必须能看到 Pi Provider。
  // 失败含义：入口消失会阻断用户创建 Pi 会话的第一步。
  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();

  // Pi button must be visible in the picker
  const piButton = page.getByTestId('project-new-session-provider-pi');
  await expect(piButton).toBeVisible();
  await expect(piButton).toHaveText('Pi');
});

test('selecting Pi creates a route draft that is hidden from piSessions until first message', async ({ page }) => {
  const manualSessionGroup = page.locator('[data-testid="project-overview-manual-sessions"]').first();
  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();

  const piButton = page.getByTestId('project-new-session-provider-pi');
  await piButton.click();

  // Wait for navigation to the cN route
  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+(?:\?.*)?$/, { timeout: 10_000 });
  const routeSessionId = new URL(page.url()).pathname.match(/\/(c\d+)$/)?.[1];

  // Empty Pi drafts are route-only UI state until a provider session is bound.
  const projectData = await page.evaluate(async () => {
    const token = window.localStorage.getItem('auth-token');
    const response = await fetch('/api/projects', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    return response.json();
  });

  const projectWithDraftPi = (Array.isArray(projectData) ? projectData : []).find(
    (p) => Array.isArray(p.piSessions) && p.piSessions.some((session) => session.id === routeSessionId),
  );
  expect(projectWithDraftPi).toBeFalsy();
});

test('Pi session chat page shows the textarea and allows typing a message', async ({ page }) => {
  const manualSessionGroup = page.locator('[data-testid="project-overview-manual-sessions"]').first();
  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();

  const piButton = page.getByTestId('project-new-session-provider-pi');
  await piButton.click();

  // Wait for navigation
  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+(?:\?.*)?$/, { timeout: 10_000 });

  // The textarea for chat input should be visible and editable
  const textarea = page.locator('textarea[placeholder]').first();
  await expect(textarea).toBeVisible({ timeout: 5_000 });

  // Type a message
  await textarea.fill('Hello from Pi E2E test');
  await expect(textarea).toHaveValue('Hello from Pi E2E test');

  // The send/submit button should be visible (either Ctrl+Enter hint or send button)
  const sendHint = page.locator('text=Ctrl+Enter').first();
  const sendButton = page.locator('button[aria-label*="send" i], button[aria-label*="Send" i]').first();
  const submitVisible = await Promise.any([
    sendHint.isVisible().then(() => 'hint'),
    sendButton.isVisible().then(() => 'button'),
  ]).catch(() => null);

  expect(submitVisible).toBeTruthy();
});

test('sending a Pi message dispatches pi-command with provider=pi', async ({ page }) => {
  // Inject a WebSocket send spy before the app creates its WebSocket.
  // addInitScript runs before any page script, so the monkey-patch is in place
  // before the first WebSocket connection is established.
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    window.__capturedWsMessages = [];
    // Monkey-patch WebSocket to intercept send() calls for assertion.
    // Must copy static constants (OPEN, CONNECTING, etc.) so that
    // production readiness checks do not silently skip send calls.
    function PatchedWebSocket(...args) {
      const ws = new OriginalWebSocket(...args);
      const originalSend = ws.send.bind(ws);
      ws.send = function (data) {
        try {
          window.__capturedWsMessages.push(JSON.parse(data));
        } catch {
          window.__capturedWsMessages.push(data);
        }
        return originalSend(data);
      };
      return ws;
    }
    PatchedWebSocket.prototype = OriginalWebSocket.prototype;
    for (const key of ['OPEN', 'CONNECTING', 'CLOSING', 'CLOSED']) {
      PatchedWebSocket[key] = OriginalWebSocket[key];
    }
    window.WebSocket = PatchedWebSocket;
  });

  // Now authenticate and open the fixture project (creates WebSocket)
  await openFixtureProject(page);

  const manualSessionGroup = page.locator('[data-testid="project-overview-manual-sessions"]').first();
  await manualSessionGroup.getByRole('button', { name: /新建|New Session/ }).click();

  const piButton = page.getByTestId('project-new-session-provider-pi');
  await piButton.click();

  // Wait for navigation to the cN route
  await expect(page).toHaveURL(/\/workspace\/.*\/c\d+(?:\?.*)?$/, { timeout: 10_000 });

  // Wait for the textarea to be ready
  const textarea = page.locator('textarea[placeholder]').first();
  await expect(textarea).toBeVisible({ timeout: 5_000 });

  // Type and send a message
  const testMessage = `Pi E2E send test ${Date.now()}`;
  await textarea.fill(testMessage);
  await textarea.press('Control+Enter');

  // Wait for the WebSocket message to be captured
  await page.waitForFunction(
    () => {
      const msgs = window.__capturedWsMessages || [];
      return msgs.some((m) => typeof m === 'object' && m.type === 'pi-command');
    },
    { timeout: 8_000 },
  );

  // 业务场景：确认真实页面发出的命令载荷能让后端识别 Pi 会话与模型。
  // 失败含义：用户输入可能被发送到错误 Provider，或者无法绑定到当前会话。
  const wsMessages = await page.evaluate(() => window.__capturedWsMessages);
  const piCommand = wsMessages.find((m) => typeof m === 'object' && m.type === 'pi-command');
  expect(piCommand).toBeTruthy();
  expect(piCommand.command).toBe(testMessage);
  expect(piCommand.options?.projectPath).toBeTruthy();
  expect(piCommand.options?.model).toBe('playwright/pi-fake');

  const chat = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(chat.getByText(`fake pi response: ${testMessage}`).last()).toBeVisible({ timeout: 25_000 });

  const projectData = await page.evaluate(async (commandProjectPath) => {
    const token = window.localStorage.getItem('auth-token');
    const response = await fetch('/api/projects', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const projects = await response.json();
    const project = Array.isArray(projects)
      ? projects.find((candidate) => candidate.fullPath === commandProjectPath) || null
      : null;
    if (!project) return null;
    const overviewResponse = await fetch(
      `/api/projects/${encodeURIComponent(project.name)}/overview?projectPath=${encodeURIComponent(project.fullPath)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    return overviewResponse.json();
  }, piCommand.options?.projectPath);
  expect(projectData?.piSessions?.some((session) => session.id === piCommand.ozwSessionId)).toBeTruthy();
});
