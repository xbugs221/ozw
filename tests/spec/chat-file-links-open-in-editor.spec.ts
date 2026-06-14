// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Acceptance tests for assistant-message workspace file references.
 * Derived from openspec/changes/chat-file-links-open-in-editor/specs/chat-file-links-open-in-editor/spec.md.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_HOME } from '../e2e/helpers/playwright-fixture.ts';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  resetWorkspaceProject,
  resolveFlowrkspacePath,
  writeWorkspaceTextFile,
} from './helpers/spec-test-helpers.ts';

/**
 * Create a Codex-format session fixture containing one assistant markdown reply.
 *
 * @param {{ sessionId: string, assistantContent: string }} params
 * @returns {Promise<void>}
 */
async function writeAssistantLinkSession({ sessionId, assistantContent }) {
  const sessionDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.codex',
    'sessions',
    '2026',
    '04',
    '14',
  );
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-14T08:00:00.000Z',
        payload: {
          id: sessionId,
          cwd: PRIMARY_FIXTURE_PROJECT_PATH,
          model: 'gpt-5-codex',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-14T08:00:01.000Z',
        payload: {
          type: 'user_message',
          message: 'Show me the relevant file.',
        },
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-14T08:00:02.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: assistantContent }],
        },
      }),
    ].join('\n') + '\n',
    'utf8',
  );
}

/**
 * Open a legacy session route with enough project identity for route recovery.
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

/**
 * Assert that editor opening keeps the chat session pathname active.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
async function expectSessionPath(page, sessionId) {
  await expect(page).toHaveURL((url) => url.pathname === `/session/${sessionId}`);
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('absolute workspace file links open the referenced file in the embedded editor', async ({ page }) => {
  /** Scenario: Opening an absolute workspace file reference */
  const relativePath = 'src/absolute-link-target.ts';
  const absolutePath = resolveFlowrkspacePath(relativePath);
  const sessionId = 'fixture-absolute-file-link-session';

  await writeWorkspaceTextFile(relativePath, 'export const absoluteLink = true;\n');
  await writeAssistantLinkSession({
    sessionId,
    assistantContent: `Open [absolute-link-target.ts](${absolutePath}) for the implementation details.`,
  });

  await openFixtureCodexSession(page, sessionId);
  await expect(page.getByRole('link', { name: 'absolute-link-target.ts' })).toBeVisible();

  await page.getByRole('link', { name: 'absolute-link-target.ts' }).click();

  await expectSessionPath(page, sessionId);
  await expect(page.getByRole('heading', { name: 'absolute-link-target.ts' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();
});

test('project-relative workspace file links resolve against the selected project root', async ({ page }) => {
  /** Scenario: Opening a project-relative workspace file reference */
  const relativePath = 'docs/relative-link-target.md';
  const sessionId = 'fixture-relative-file-link-session';

  await writeWorkspaceTextFile(relativePath, '# Relative Link Target\n');
  await writeAssistantLinkSession({
    sessionId,
    assistantContent: 'Review [relative-link-target.md](docs/relative-link-target.md) before editing.',
  });

  await openFixtureCodexSession(page, sessionId);
  await expect(page.getByRole('link', { name: 'relative-link-target.md' })).toBeVisible();

  await page.getByRole('link', { name: 'relative-link-target.md' }).click();

  await expectSessionPath(page, sessionId);
  await expect(page.getByRole('heading', { name: 'relative-link-target.md' })).toBeVisible();
  await expect(page.getByText('docs/relative-link-target.md', { exact: true })).toBeVisible();
});

test('workspace file links with line suffixes still open the file in the embedded editor', async ({ page }) => {
  /** Scenario: Opening a file reference that includes a line suffix */
  const relativePath = 'src/line-suffix-target.ts';
  const absolutePath = resolveFlowrkspacePath(relativePath);
  const sessionId = 'fixture-line-suffix-file-link-session';

  await writeWorkspaceTextFile(relativePath, 'export const firstLine = 1;\nexport const secondLine = 2;\n');
  await writeAssistantLinkSession({
    sessionId,
    assistantContent: `Inspect [line-suffix-target.ts](${absolutePath}#L2) for the second export.`,
  });

  await openFixtureCodexSession(page, sessionId);
  await expect(page.getByRole('link', { name: 'line-suffix-target.ts' })).toBeVisible();

  await page.getByRole('link', { name: 'line-suffix-target.ts' }).click();

  await expectSessionPath(page, sessionId);
  await expect(page.getByRole('heading', { name: 'line-suffix-target.ts' })).toBeVisible();
  await expect(page.locator('text=export const secondLine = 2;')).toBeVisible();
});

test('clicking a workspace file reference keeps the current chat route active while opening the editor sidebar', async ({ page }) => {
  /** Scenario: Clicking a workspace file reference from an assistant reply */
  const relativePath = 'src/sidebar-route-target.ts';
  const sessionId = 'fixture-sidebar-route-file-link-session';

  await writeWorkspaceTextFile(relativePath, 'export const sidebarRoute = true;\n');
  await writeAssistantLinkSession({
    sessionId,
    assistantContent: 'Open [sidebar-route-target.ts](src/sidebar-route-target.ts) without leaving this chat.',
  });

  await openFixtureCodexSession(page, sessionId);
  await expect(page.getByRole('link', { name: 'sidebar-route-target.ts' })).toBeVisible();

  await page.getByRole('link', { name: 'sidebar-route-target.ts' }).click();

  await expectSessionPath(page, sessionId);
  await expect(page.getByRole('heading', { name: 'sidebar-route-target.ts' })).toBeVisible();
  await expect(page.locator('text=src/sidebar-route-target.ts')).toBeVisible();
});

test('external links keep normal browser navigation instead of opening the editor', async ({ page }) => {
  /** Scenario: Opening an external documentation link */
  const sessionId = 'fixture-external-link-session';

  await writeAssistantLinkSession({
    sessionId,
    assistantContent: 'See [Example docs](https://example.com/docs) for external guidance.',
  });

  await openFixtureCodexSession(page, sessionId);
  const externalLink = page.getByRole('link', { name: 'Example docs' });
  await expect(externalLink).toBeVisible();
  await expect(externalLink).toHaveAttribute('href', 'https://example.com/docs');
  await expect(externalLink).toHaveAttribute('target', '_blank');
  await expect(externalLink).toHaveAttribute('rel', /noopener noreferrer/);

  await expectSessionPath(page, sessionId);
  await expect(page.getByRole('button', { name: /Save/i })).toHaveCount(0);
});

test('unopenable workspace references render as plain text while external links stay clickable', async ({ page }) => {
  /** Scenario: Only workspace references that can open real files get link affordance */
  const openableFile = 'src/openable-link.ts';
  const directoryOnly = 'src/folder-only';
  const missingFile = 'src/missing-link.ts';
  const sessionId = 'fixture-unopenable-workspace-links';

  await writeWorkspaceTextFile(openableFile, 'export const openableWorkspaceLink = true;\n');
  await fs.mkdir(resolveFlowrkspacePath(directoryOnly), { recursive: true });
  await writeAssistantLinkSession({
    sessionId,
    assistantContent: [
      `Open [openable file](${openableFile}) for implementation details.`,
      `Do not link [directory target](${directoryOnly}).`,
      `Do not link [missing target](${missingFile}).`,
      'Do not link [plain label](just words).',
      'Keep [external docs](https://example.com/docs) as a browser link.',
    ].join('\n\n'),
  });

  await openFixtureCodexSession(page, sessionId);

  const openable = page.getByRole('link', { name: 'openable file' });
  await expect(openable).toBeVisible();
  await expect(page.getByRole('link', { name: 'directory target' })).toHaveCount(0);
  await expect(page.getByText('directory target', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'missing target' })).toHaveCount(0);
  await expect(page.getByText('missing target', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'plain label' })).toHaveCount(0);
  await expect(page.getByText('plain label', { exact: true })).toBeVisible();

  const external = page.getByRole('link', { name: 'external docs' });
  await expect(external).toBeVisible();
  await expect(external).toHaveAttribute('href', 'https://example.com/docs');
  await expect(external).toHaveAttribute('target', '_blank');
  await expect(external).toHaveAttribute('rel', /noopener noreferrer/);

  await openable.click();
  await expectSessionPath(page, sessionId);
  await expect(page.getByRole('heading', { name: 'openable-link.ts' })).toBeVisible();
});
