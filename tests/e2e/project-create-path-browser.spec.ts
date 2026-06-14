/**
 * PURPOSE: Verify the sidebar project creation wizard resolves user-entered
 * workspace paths consistently across folder suggestions and project creation.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  openFixtureProject,
} from '../spec/helpers/spec-test-helpers.ts';
import { PLAYWRIGHT_FIXTURE_HOME } from './helpers/playwright-fixture.ts';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'docs/debug/20260614-1352-project-create-path/screenshots');

/**
 * Prepare a real directory under the isolated Playwright home.
 */
async function prepareCandidateProject() {
  const parentPath = path.join(PLAYWRIGHT_FIXTURE_HOME, 'workspace', 'ozw-create-path-parent');
  const projectPath = path.join(parentPath, 'candidate-project');
  await fs.rm(parentPath, { recursive: true, force: true });
  await fs.mkdir(projectPath, { recursive: true });
  await fs.writeFile(path.join(projectPath, 'README.md'), '# candidate project\n', 'utf8');
  return {
    parentPath,
    projectPath,
    typedPath: '~/workspace/ozw-create-path-parent/candidate',
  };
}

test('sidebar create project shows home-relative candidates and creates from absolute path', async ({ page }) => {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await openFixtureProject(page);
  const candidate = await prepareCandidateProject();

  await page.locator('[data-testid="create-project"]:visible').click();
  await expect(page.getByRole('heading', { name: /Create New Project|创建新项目/i })).toBeVisible();
  await page.getByRole('button', { name: /Next|下一步/ }).click();

  const pathInput = page.getByPlaceholder('/path/to/existing/workspace');
  const browseResponsePromise = page.waitForResponse((response) => (
    response.url().includes('/api/browse-filesystem')
  ));
  await pathInput.fill(candidate.typedPath);
  const browseResponse = await browseResponsePromise;
  const browseBody = await browseResponse.text();
  expect(browseResponse.status(), browseBody).toBe(200);
  const browsePayload = JSON.parse(browseBody);
  expect(browsePayload.suggestions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: candidate.projectPath, name: 'candidate-project' }),
    ]),
  );
  await expect(page.getByRole('button', { name: /candidate-project/ })).toBeVisible();
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'candidate-suggestions-visible.png'),
    fullPage: true,
  });

  await pathInput.fill(candidate.projectPath);
  await page.getByRole('button', { name: /Next|下一步/ }).click();
  await expect(page.getByText(candidate.projectPath)).toBeVisible();
  await page.getByRole('button', { name: /Create Project|创建项目/ }).click();

  await expect(page.getByRole('button', { name: /^candidate-project\b/ }).first()).toBeVisible();
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'absolute-path-project-created.png'),
    fullPage: true,
  });
});
