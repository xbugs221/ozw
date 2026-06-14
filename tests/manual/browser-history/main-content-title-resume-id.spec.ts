// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify the rendered workspace title shows only provider resume ids
 * for resumable sessions and hides resume metadata for route-only sessions.
 */
import { test, expect } from '@playwright/test';
import { authenticatePage } from './helpers/spec-test-helpers.ts';

const PROJECT_NAME = 'resume-id-fixture';
const PROJECT_PATH = '/tmp/ozw-resume-id-fixture';
const CODEX_RESUME_ID = 'codex-provider-session-123';
const PI_RESUME_ID = 'pi-provider-session-456';

function buildProjectPayload() {
  /**
   * Build the minimal project/session payload that route resolution and the
   * main content title need for provider-backed and route-only sessions.
   */
  return [{
    name: PROJECT_NAME,
    displayName: 'Resume ID Fixture',
    path: PROJECT_PATH,
    fullPath: PROJECT_PATH,
    routePath: `/workspace/${PROJECT_NAME}`,
    sessions: [],
    workflows: [],
    codexSessions: [{
      id: 'codex-session-route',
      routeIndex: 1,
      summary: 'Codex Resume Session',
      provider: 'codex',
      __provider: 'codex',
      providerSessionId: CODEX_RESUME_ID,
      projectPath: PROJECT_PATH,
      createdAt: '2026-05-10T10:00:00.000Z',
      lastActivity: '2026-05-10T10:01:00.000Z',
    }],
    piSessions: [{
      id: 'pi-session-route',
      routeIndex: 2,
      summary: 'Pi Resume Session',
      provider: 'pi',
      __provider: 'pi',
      providerSessionId: PI_RESUME_ID,
      projectPath: PROJECT_PATH,
      createdAt: '2026-05-10T10:02:00.000Z',
      lastActivity: '2026-05-10T10:03:00.000Z',
    }],
  }];
}

async function mockProjectApi(page) {
  /**
   * Keep the test in the real browser UI while making project discovery
   * deterministic and independent of provider CLIs.
   */
  await page.route('**/api/projects', async (route) => {
    await route.fulfill({ json: buildProjectPayload() });
  });
  await page.route('**/api/projects/**/workflows**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/projects/**/openspec/changes**', async (route) => {
    await route.fulfill({ json: { changes: [] } });
  });
  await page.route('**/api/codex/sessions/**/messages**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/projects/**/sessions/**/messages**', async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route('**/api/projects/**/sessions/**/token-usage**', async (route) => {
    await route.fulfill({ json: null });
  });
}

async function openSessionRoute(page, routeIndex) {
  /**
   * Open the stable project route used by the application for manual sessions.
   */
  await page.goto(`/workspace/${PROJECT_NAME}/c${routeIndex}`, { waitUntil: 'networkidle' });
  await expect(page.locator('[data-testid="tab-chat"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await authenticatePage(page);
  await mockProjectApi(page);
});

test('Codex session title renders only the provider resume id', async ({ page }) => {
  /** Scenario: Codex providerSessionId is visible without provider command text. */
  await openSessionRoute(page, 1);

  await expect(page.getByRole('heading', { name: 'Codex Resume Session' })).toBeVisible();
  await expect(page.locator('code').filter({ hasText: CODEX_RESUME_ID })).toBeVisible();
  await expect(page.getByText('codex', { exact: true })).toHaveCount(0);
  await expect(page.getByText('resume', { exact: true })).toHaveCount(0);
  await expect(page.getByText('--dangerously-bypass-approvals-and-sandbox')).toHaveCount(0);
});

test('Pi session title renders only the provider resume id', async ({ page }) => {
  /** Scenario: Pi providerSessionId is visible without provider command text. */
  await openSessionRoute(page, 2);

  await expect(page.getByRole('heading', { name: 'Pi Resume Session' })).toBeVisible();
  await expect(page.locator('code').filter({ hasText: PI_RESUME_ID })).toBeVisible();
  await expect(page.getByText('pi', { exact: true })).toHaveCount(0);
  await expect(page.getByText('--session')).toHaveCount(0);
});

test('route-only temporary session title does not render a resume row', async ({ page }) => {
  /** Scenario: cN route aliases without provider ids are not shown as resumable. */
  await openSessionRoute(page, 3);

  await expect(page.getByText('会话3')).toBeVisible();
  await expect(page.locator('code')).toHaveCount(0);
  await expect(page.getByText('codex', { exact: true })).toHaveCount(0);
  await expect(page.getByText('resume', { exact: true })).toHaveCount(0);
});
