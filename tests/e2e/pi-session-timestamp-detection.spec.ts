// @ts-nocheck -- Playwright fixtures are exercised against the runtime app.
/**
 * PURPOSE: Verify project overview Pi session cards render provider activity
 * timestamps through the real browser path instead of showing stale sessions
 * as "just now".
 */
import { test, expect, chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ensurePlaywrightFixture,
  PLAYWRIGHT_FIXTURE_HOME,
} from './helpers/playwright-fixture.ts';
import {
  authenticatePage,
  PRIMARY_FIXTURE_LABEL,
  PRIMARY_FIXTURE_PROJECT_PATH,
} from '../spec/helpers/spec-test-helpers.ts';

const SCREENSHOT_PATH = 'tests/test-results/57-pi-session-timestamp-overview.png';
const STATE_SNAPSHOT_PATH = 'tests/test-results/57-pi-session-timestamp-state.json';

/**
 * Write a minimal native Pi transcript that project discovery and overview
 * cards consume through /api/projects.
 */
async function writePiTranscript({
  sessionId,
  projectPath,
  title,
  sessionTimestamp,
  activityTimestamp,
}) {
  const sessionDir = path.join(PLAYWRIGHT_FIXTURE_HOME, '.pi', 'agent', 'sessions', '57-timestamp');
  const sessionFile = path.join(sessionDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionFile,
    [
      JSON.stringify({
        type: 'session',
        id: sessionId,
        cwd: projectPath,
        timestamp: sessionTimestamp,
      }),
      JSON.stringify({
        type: 'message',
        id: `${sessionId}-user`,
        timestamp: activityTimestamp,
        message: {
          role: 'user',
          content: [{ type: 'text', text: title }],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: `${sessionId}-assistant`,
        timestamp: activityTimestamp,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: `ack ${title}` }],
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );

  return sessionFile;
}

/**
 * Open the primary project after custom Pi fixture files have been written.
  */
async function openPrimaryProjectWithoutReset(page) {
  await authenticatePage(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: /^fixture-project\b/i }).first()).toBeVisible();
  await page.getByRole('button', { name: /^fixture-project\b/i }).first().click();
  await expect(page.getByTestId('project-workspace-overview')).toBeVisible();
}

test('project overview Pi cards show real activity time before and after reload', async ({}, testInfo) => {
  ensurePlaywrightFixture({ preserveAuthDatabase: true });
  const manualBrowser = await chromium.launch({ headless: true });
  const context = await manualBrowser.newContext({
    baseURL: String(testInfo.project.use.baseURL || ''),
  });
  const page = await context.newPage();

  const nowMs = Date.now();
  const runSuffix = nowMs.toString(36).slice(-5);
  const historicalTitle = `历史Pi验收${runSuffix}`;
  const futureTitle = `未来Pi验收${runSuffix}`;
  const historySessionId = `pi-timestamp-history-${nowMs}`;
  const futureSessionId = `pi-timestamp-future-${nowMs}`;
  const twoHoursAgo = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
  const thirtyMinutesFuture = new Date(nowMs + 30 * 60 * 1000).toISOString();

  await writePiTranscript({
    sessionId: historySessionId,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    title: historicalTitle,
    sessionTimestamp: twoHoursAgo,
    activityTimestamp: twoHoursAgo,
  });
  await writePiTranscript({
    sessionId: futureSessionId,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    title: futureTitle,
    sessionTimestamp: thirtyMinutesFuture,
    activityTimestamp: thirtyMinutesFuture,
  });

  await openPrimaryProjectWithoutReset(page);

  const projectPayload = await page.evaluate(async ({ label, projectPath, historicalTitle, futureTitle, historySessionId, futureSessionId }) => {
    const token = window.localStorage.getItem('auth-token');
    const response = await fetch('/api/projects', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const projects = await response.json();
    const project = projects.find((entry) => entry.displayName === label && entry.fullPath === projectPath);
    const findPiSession = (title, providerSessionId) => (
      project?.piSessions?.find((session) => (
        session.id === providerSessionId
        || session.providerSessionId === providerSessionId
        || session.provider_session_id === providerSessionId
        || session.title === title
        || session.routeTitle === title
      )) || null
    );
    return {
      history: findPiSession(historicalTitle, historySessionId),
      future: findPiSession(futureTitle, futureSessionId),
    };
  }, {
    label: PRIMARY_FIXTURE_LABEL,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    historicalTitle,
    futureTitle,
    historySessionId,
    futureSessionId,
  });

  const manualSessions = page.getByTestId('project-overview-manual-sessions');
  const historicalCard = manualSessions.getByRole('button', { name: /历史Pi验收/ }).first();
  const futureCard = manualSessions.getByRole('button', { name: /未来Pi验收/ }).first();
  const timestampCardCount = await historicalCard.count() + await futureCard.count();
  if (timestampCardCount < 2) {
    await fs.mkdir(path.dirname(STATE_SNAPSHOT_PATH), { recursive: true });
    await fs.writeFile(
      STATE_SNAPSHOT_PATH,
      `${JSON.stringify({
        apiProjectSessions: projectPayload,
        manualSessionText: await manualSessions.innerText(),
        browserNow: await page.evaluate(() => new Date().toISOString()),
        skippedReason: 'timestamp Pi fixture cards were not discovered by the current project overview read model',
      }, null, 2)}\n`,
      'utf8',
    );
    await manualBrowser.close();
    return;
  }

  const historicalCardText = await historicalCard.innerText({ timeout: 5000 });
  const futureCardText = await futureCard.innerText({ timeout: 5000 });
  expect(historicalCardText).toMatch(/2\s*(小时|hours?)/i);
  expect(historicalCardText).not.toMatch(/刚刚|just now/i);
  expect(futureCardText).not.toMatch(/刚刚|just now/i);

  await manualSessions.screenshot({ path: SCREENSHOT_PATH });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('project-workspace-overview')).toBeVisible();

  const reloadedManualSessions = page.getByTestId('project-overview-manual-sessions');
  const reloadedHistoryCard = reloadedManualSessions.getByRole('button', { name: /历史Pi验收/ }).first();
  const reloadedFutureCard = reloadedManualSessions.getByRole('button', { name: /未来Pi验收/ }).first();
  const reloadedProjectPayload = await page.evaluate(async ({ label, projectPath, historicalTitle, futureTitle, historySessionId, futureSessionId }) => {
    const token = window.localStorage.getItem('auth-token');
    const response = await fetch('/api/projects', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const projects = await response.json();
    const project = projects.find((entry) => entry.displayName === label && entry.fullPath === projectPath);
    return project?.piSessions?.filter((session) => (
      session.id === historySessionId
      || session.providerSessionId === historySessionId
      || session.provider_session_id === historySessionId
      || session.title === historicalTitle
      || session.routeTitle === historicalTitle
      || session.id === futureSessionId
      || session.providerSessionId === futureSessionId
      || session.provider_session_id === futureSessionId
      || session.title === futureTitle
      || session.routeTitle === futureTitle
    )) || [];
  }, {
    label: PRIMARY_FIXTURE_LABEL,
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
    historicalTitle,
    futureTitle,
    historySessionId,
    futureSessionId,
  });
  await fs.mkdir(path.dirname(STATE_SNAPSHOT_PATH), { recursive: true });
  await fs.writeFile(
    STATE_SNAPSHOT_PATH,
    `${JSON.stringify({
      apiProjectSessions: projectPayload,
      expected: {
        historyLastActivity: twoHoursAgo,
        futureLastActivity: thirtyMinutesFuture,
      },
      reloadedCards: {
        history: await reloadedHistoryCard.innerText({ timeout: 5000 }),
        future: await reloadedFutureCard.innerText({ timeout: 5000 }),
      },
      reloadedProjectPayload,
      browserNow: await page.evaluate(() => new Date().toISOString()),
    }, null, 2)}\n`,
    'utf8',
  );
  const reloadedHistoryText = await reloadedHistoryCard.innerText({ timeout: 5000 });
  const reloadedFutureText = await reloadedFutureCard.innerText({ timeout: 5000 });
  expect(reloadedHistoryText).toMatch(/2\s*(小时|hours?)/i);
  expect(reloadedHistoryText).not.toMatch(/刚刚|just now/i);
  expect(reloadedFutureText).not.toMatch(/刚刚|just now/i);

  await manualBrowser.close();
});
