// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Acceptance coverage for Codex goal completion markers rendered from
 * real task_complete transcript events.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_HOME } from '../e2e/helpers/playwright-fixture.ts';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  resetWorkspaceProject,
} from './helpers/spec-test-helpers.ts';

/**
 * Write a Codex session containing the task_complete event produced when an
 * agent goal finishes.
 *
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
async function writeGoalCompletionSession(sessionId) {
  const sessionDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.codex',
    'sessions',
    '2026',
    '06',
    '22',
  );
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  const finalAnswer = [
    '**需求/问题**',
    '',
    '已创建一个覆盖四类需求的 oz 提案。',
    '',
    '**成果**',
    '',
    '契约测试已跑。',
  ].join('\n');

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-06-22T12:44:13.000Z',
        payload: {
          id: sessionId,
          cwd: PRIMARY_FIXTURE_PROJECT_PATH,
          model: 'gpt-5-codex',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-22T12:44:14.000Z',
        payload: {
          type: 'user_message',
          message: '创建一个覆盖四类需求的 oz 提案。',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-06-22T12:52:31.802Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: finalAnswer }],
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-06-22T12:52:31.803Z',
        payload: {
          type: 'task_complete',
          turn_id: '019eef5c-245b-7802-9696-1a51a6956a89',
          last_agent_message: finalAnswer,
          completed_at: 1782132751,
          duration_ms: 498014,
          time_to_first_token_ms: 3902,
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

/**
 * Open a Codex history route using the fixture project identity.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
async function openFixtureCodexSession(page, sessionId) {
  const query = new URLSearchParams({
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    provider: 'codex',
  });
  await page.goto(`/session/${sessionId}?${query.toString()}`, { waitUntil: 'networkidle' });
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('Codex task_complete events render as a visible goal completion banner', async ({ page }) => {
  /** Scenario: A completed long-running agent goal is visible at the end of the transcript */
  const sessionId = 'fixture-goal-completion-banner-session';
  const screenshotPath = path.join(
    process.cwd(),
    'test-results',
    'chat-goal-completion-banner',
    'goal-completion-banner.png',
  );

  await writeGoalCompletionSession(sessionId);
  await openFixtureCodexSession(page, sessionId);

  const banner = page.getByTestId('goal-completion-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Goal completed');
  await expect(banner).toContainText('8m 18s');
  await expect(banner).toContainText('已创建一个覆盖四类需求的 oz 提案。');

  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  await banner.screenshot({ path: screenshotPath });
});
