// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Guard against empty update_plan tool results hiding the input plan content.
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
 * Write one Codex JSONL session file under the Playwright fixture HOME.
 *
 * @param {{ sessionId: string, entries: Array<Record<string, unknown>> }} params
 * @returns {Promise<void>}
 */
async function writeCodexSession({ sessionId, entries }) {
  const sessionDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.codex',
    'sessions',
    '2026',
    '04',
    '20',
  );
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

/**
 * Build a minimal Codex transcript containing function_call pairs.
 *
 * @param {{ sessionId: string, records: Array<Record<string, unknown>> }} params
 * @returns {Array<Record<string, unknown>>}
 */
function buildCodexTranscript({ sessionId, records }) {
  return [
    {
      type: 'session_meta',
      timestamp: '2026-04-20T09:10:00.000Z',
      payload: {
        id: sessionId,
        cwd: PRIMARY_FIXTURE_PROJECT_PATH,
        model: 'gpt-5-codex',
      },
    },
    ...records,
  ];
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

/**
 * Open a Codex session with project identity for route recovery.
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

test('update_plan 在空 result 时仍然展示 input 里的计划步骤', async ({ page }) => {
  /** Scenario: 真实运行中 tool_result 可能只返回空对象，输入侧的计划仍然必须可见。 */
  const sessionId = 'fixture-update-plan-empty-result';

  await writeCodexSession({
    sessionId,
    entries: buildCodexTranscript({
      sessionId,
      records: [
        {
          timestamp: '2026-04-20T09:10:01.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call',
            call_id: 'call-plan-empty-result',
            name: 'update_plan',
            arguments: JSON.stringify({
              explanation: '先确认问题，再改渲染逻辑。',
              plan: [
                { step: '确认空白来源', status: 'completed' },
                { step: '修正回退策略', status: 'in_progress' },
              ],
            }),
          },
        },
        {
          timestamp: '2026-04-20T09:10:02.000Z',
          type: 'response_item',
          payload: {
            type: 'function_call_output',
            call_id: 'call-plan-empty-result',
            output: {},
          },
        },
      ],
    }),
  });

  await openFixtureCodexSession(page, sessionId);

  await expect(page.getByTestId('tool-plan-content')).toContainText('先确认问题，再改渲染逻辑。');
  await expect(page.getByTestId('tool-plan-step-0')).toContainText('确认空白来源');
  await expect(page.getByTestId('tool-plan-step-1')).toContainText('修正回退策略');
  await expect(page.getByTestId('tool-plan-step-1')).toContainText('进行中');
});
