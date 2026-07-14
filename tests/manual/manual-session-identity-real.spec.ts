/**
 * PURPOSE: Validate the real project overview never exposes Codex subagents as
 * manual cards after provider-index repair.
 */
import { expect, test } from '@playwright/test';
import path from 'node:path';

import {
  listCodexSessionFiles,
  parseCodexSessionHeader,
} from '../../backend/domains/projects/provider-transcript-read-model.ts';

const REAL_BASE_URL = process.env.OZW_REAL_URL || 'http://127.0.0.1:4001';
const REAL_PROJECT_NAME = process.env.OZW_REAL_PROJECT_NAME || 'ozw';
const REAL_PROJECT_PATH = process.env.OZW_REAL_PROJECT_PATH || process.cwd();
const SCREENSHOT_PATH = path.join(
  process.cwd(),
  'docs/debug/20260714-1230-manual-session-identity/screenshots/after-top-level-sessions.png',
);

type RealOverviewSession = {
  id?: string;
  providerSessionId?: string;
  routeIndex?: number;
};

test('真实项目手动会话只展示顶层 Codex 会话', async ({ page }) => {
  /**
   * PURPOSE: Compare the live overview response with authoritative JSONL
   * metadata instead of relying on titles or fixture-only workflow state.
   */
  await page.goto(`${REAL_BASE_URL}/projects/${encodeURIComponent(REAL_PROJECT_NAME)}`, {
    waitUntil: 'networkidle',
  });
  const overview = await page.evaluate(async ({ projectName, projectPath }) => {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectName)}/overview?projectPath=${encodeURIComponent(projectPath)}`,
    );
    return { ok: response.ok, status: response.status, body: await response.json() };
  }, { projectName: REAL_PROJECT_NAME, projectPath: REAL_PROJECT_PATH });

  expect(overview.ok).toBe(true);
  expect(overview.status).toBe(200);

  const codexFiles = await listCodexSessionFiles();
  const visibleCodexSessions: RealOverviewSession[] = Array.isArray(overview.body?.codexSessions)
    ? overview.body.codexSessions as RealOverviewSession[]
    : [];
  const classifiedVisibleSessions = await Promise.all(visibleCodexSessions.map(async (session) => {
    const providerSessionId = String(session.providerSessionId || session.id || '');
    const filePath = codexFiles.find((candidate) => path.basename(candidate).includes(providerSessionId));
    const header = filePath ? await parseCodexSessionHeader(filePath) : null;
    return {
      routeIndex: session.routeIndex,
      providerSessionId,
      parsedOrigin: header?.origin || null,
      parsedParentSessionId: header?.sourceSessionId || null,
    };
  }));
  const leakedSubagents = classifiedVisibleSessions.filter((session) => session.parsedOrigin === 'workflow');

  await expect(page.getByTestId('project-overview-manual-sessions')).toBeVisible();
  await page.getByTestId('project-overview-manual-sessions').screenshot({ path: SCREENSHOT_PATH });
  expect(leakedSubagents).toEqual([]);
});
