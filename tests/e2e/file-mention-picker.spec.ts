/**
 * PURPOSE: End-to-end acceptance for selecting project files from the chat @ mention picker.
 */
import { test, expect } from '@playwright/test';
import {
  openFixtureProject,
  openFixtureManualSessionFromOverview,
  writeWorkspaceTextFile,
} from '../spec/helpers/spec-test-helpers.ts';

test('chat @ file picker expands directories and inserts the selected relative path', async ({ page }) => {
  await openFixtureProject(page);
  await writeWorkspaceTextFile('src/domain/SettlementPolicy.ts', 'export const policy = true;\n');

  await openFixtureManualSessionFromOverview(page);

  const textarea = page.locator('textarea').first();
  await expect(textarea).toBeVisible();
  await textarea.fill('请查看 ');
  await page.getByRole('button', { name: '@' }).click();

  await expect(page.getByTestId('file-mention-tree')).toBeVisible();
  await page.getByRole('button', { name: /src/ }).click();
  await page.getByRole('button', { name: /domain/ }).click();
  await page.getByRole('button', { name: /SettlementPolicy\.ts/ }).click();

  await expect(textarea).toHaveValue(/请查看 src\/domain\/SettlementPolicy\.ts/);
});

test('chat @ file picker fuzzy search narrows to a deep business file', async ({ page }) => {
  await openFixtureProject(page);
  await writeWorkspaceTextFile('src/domain/SettlementPolicy.ts', 'export const policy = true;\n');

  await openFixtureManualSessionFromOverview(page);
  await page.getByRole('button', { name: '@' }).click();
  await page.getByRole('searchbox', { name: /搜索项目文件|Search project files/ }).fill('set pol');

  await expect(page.getByRole('option', { name: /SettlementPolicy\.ts/ })).toBeVisible();
});
