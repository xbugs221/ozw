// @ts-nocheck -- Browser fixture helpers use shared dynamic test globals.
/**
 * PURPOSE: Regress chat Markdown rendering for Codex persisted messages where
 * Chinese prose is adjacent to fenced code block markers.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { PLAYWRIGHT_FIXTURE_HOME } from '../e2e/helpers/playwright-fixture.ts';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  resetWorkspaceProject,
} from './helpers/spec-test-helpers.ts';

const SESSION_DAY = ['2026', '06', '06'];
const SESSION_ID = 'spec-chat-markdown-adjacent-code-fences';
const CODE_LINE = 'const persistedAdjacentFence = true;';
const SINGLE_BACKTICK_CODE_LINE = 'MATX_GATEWAY_URL=http://127.0.0.1:18789';
const PREFIX_TEXT = '下面是代码';
const SUFFIX_TEXT = '继续说明';
const SINGLE_BACKTICK_PREFIX = '如果要测试真实 HPC 上的';
const SINGLE_BACKTICK_SUFFIX = '在 Kestra 配好 secrets';
const DEBUG_SCREENSHOT_DIR = path.join(
  process.cwd(),
  'docs/debug/20260606-1321-chat-single-backtick-code-fence/screenshots',
);

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('Codex 持久化中文邻接 fenced code block 刷新后仍渲染为代码块', async ({ page }) => {
  /**
   * docstring: 写入真实 Codex JSONL 并打开会话路由，覆盖刷新加载后的业务可见渲染。
   */
  await writeCodexSession();
  await openCodexSession(page, SESSION_ID);
  await page.reload({ waitUntil: 'networkidle' });

  const transcript = page.locator('[data-testid="chat-scroll-container"]').last();
  await expect(transcript.getByText(PREFIX_TEXT, { exact: true })).toBeVisible();
  await expect(transcript.getByText(SUFFIX_TEXT, { exact: true })).toBeVisible();

  const codeBlock = transcript.locator('pre').filter({ hasText: CODE_LINE }).first();
  await expect(codeBlock).toBeVisible();
  await expect(codeBlock.locator('code')).toContainText(CODE_LINE);

  const singleBacktickCodeBlock = transcript.locator('pre').filter({ hasText: SINGLE_BACKTICK_CODE_LINE }).first();
  await expect(singleBacktickCodeBlock).toBeVisible();
  await expect(singleBacktickCodeBlock.locator('code')).toContainText(SINGLE_BACKTICK_CODE_LINE);
  await expect(transcript.getByText(SINGLE_BACKTICK_PREFIX)).toBeVisible();
  await expect(transcript.getByText(SINGLE_BACKTICK_SUFFIX)).toBeVisible();
  await expect(transcript.getByText('inline-proposal-78', { exact: true })).toBeVisible();

  const transcriptText = await transcript.textContent();
  expect(transcriptText).not.toContain('```ts');
  expect(transcriptText).not.toContain('```继续说明');
  expect(transcriptText).not.toContain('`bash');
  expect(transcriptText).not.toContain('`2. 在 Kestra');

  await fs.mkdir(DEBUG_SCREENSHOT_DIR, { recursive: true });
  await transcript.screenshot({
    path: path.join(DEBUG_SCREENSHOT_DIR, 'single-backtick-fence-rendering.png'),
  });
});

/**
 * Write a persisted Codex JSONL session under the isolated Playwright HOME.
 */
async function writeCodexSession(): Promise<void> {
  /**
   * docstring: 使用真实 session 文件触发前端 read model 和 Markdown 渲染链路。
   */
  const sessionDir = path.join(PLAYWRIGHT_FIXTURE_HOME, '.codex', 'sessions', ...SESSION_DAY);
  await fs.mkdir(sessionDir, { recursive: true });
  const assistantContent = [
    `${PREFIX_TEXT}\`\`\`ts\n${CODE_LINE}\n\`\`\`${SUFFIX_TEXT}`,
    [
      '1. 启动 MatX Gateway:',
      '```bash',
      'pnpm matx gateway run \\',
      '  --allow-unconfigured',
      '`如果要测试真实 HPC 上的 `mob4dspaw run`，启动时加：`bash',
      'MATX_LIVE_MOB4DSPAW_REAL=1',
      SINGLE_BACKTICK_CODE_LINE,
      '`2. 在 Kestra 配好 secrets：`.text`',
    ].join('\n'),
    '保留单行 inline：```inline-proposal-78```。',
  ].join('\n\n');

  const entries = [
    {
      type: 'session_meta',
      timestamp: '2026-06-06T08:00:00.000Z',
      payload: { id: SESSION_ID, cwd: PRIMARY_FIXTURE_PROJECT_PATH, model: 'gpt-5-codex' },
    },
    {
      type: 'event_msg',
      timestamp: '2026-06-06T08:00:01.000Z',
      payload: { type: 'user_message', message: '请用中文说明并给出 TypeScript 代码。' },
    },
    {
      type: 'response_item',
      timestamp: '2026-06-06T08:00:02.000Z',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: assistantContent }],
      },
    },
  ];

  await fs.writeFile(
    path.join(sessionDir, `${SESSION_ID}.jsonl`),
    `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8',
  );
}

/**
 * Open a Codex chat session with project context.
 */
async function openCodexSession(page, sessionId: string): Promise<void> {
  /**
   * docstring: 带 provider 和 projectPath 打开真实聊天路由，避免依赖首页导航状态。
   */
  const query = new URLSearchParams({
    provider: 'codex',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
  });
  await page.goto(`/session/${sessionId}?${query.toString()}`, { waitUntil: 'networkidle' });
}
