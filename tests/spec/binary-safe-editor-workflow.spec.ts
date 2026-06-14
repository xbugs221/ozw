// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Acceptance tests for binary-safe editor workflows.
 * Derived from openspec/specs/binary-safe-editor-workflow/spec.md and
 * openspec/changes/1-fix-utf8-boundary-binary-detection/specs/binary-safe-editor-workflow/spec.md.
 */
import { test, expect } from '@playwright/test';
import {
  authenticatePage,
  openFilesTab,
  openFixtureProject,
  readWorkspaceBytes,
  resetWorkspaceProject,
  writeWorkspaceBinaryFile,
  writeWorkspaceTextFile,
} from './helpers/spec-test-helpers.ts';

const TINY_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92,
  0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

/**
 * Open a file from a known fixture folder after refreshing the file tree.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} directoryName
 * @param {string} fileName
 * @returns {Promise<void>}
 */
async function openFileByName(page, directoryName, fileName) {
  await page.getByRole('button', { name: /^Reload$/i }).click();
  const directory = page.getByText(directoryName, { exact: true });
  await expect(directory).toBeVisible();
  await directory.click();
  const file = page.getByText(fileName, { exact: true });
  await expect(file).toBeVisible();
  await file.click();
}

/**
 * PURPOSE: Reproduce the UTF-8 sampling boundary bug with a valid Markdown file.
 * The first multibyte character starts exactly at byte 8192, so decoding a fixed
 * 8192-byte sample fails unless the classifier trims or tolerates the tail.
 *
 * @returns {string}
 */
function buildUtf8BoundaryMarkdown() {
  return `${'a'.repeat(8191)}中\n\n# 边界标题\n\n这是一段中文正文。\n`;
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('text files open in an editable editor surface with save controls', async ({ page }) => {
  /** Scenario: Opening a text file */
  await writeWorkspaceTextFile('notes/todo.md', '# TODO\n');

  await openFixtureProject(page, { reset: false });
  await openFilesTab(page);
  await openFileByName(page, 'notes', 'todo.md');

  await expect(page.getByRole('heading', { name: 'todo.md' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();
});

test('utf-8 markdown files remain editable when the sample boundary splits a multibyte character', async ({ page }) => {
  /** Scenario: Opening a UTF-8 markdown file whose sample boundary splits a multibyte character */
  await writeWorkspaceTextFile('notes/boundary.md', buildUtf8BoundaryMarkdown());

  await openFixtureProject(page, { reset: false });
  await openFilesTab(page);
  await openFileByName(page, 'notes', 'boundary.md');

  await expect(page.getByRole('heading', { name: 'boundary.md' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Preview/i })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/binary|non-editable|cannot be edited/i);
});

test('binary files open in a non-editable placeholder instead of the text editor', async ({ page }) => {
  /** Scenario: Opening a binary file */
  await writeWorkspaceBinaryFile('assets/manual.pdf', [0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a]);

  await openFixtureProject(page, { reset: false });
  await openFilesTab(page);
  await openFileByName(page, 'assets', 'manual.pdf');

  await expect(page.locator('body')).toContainText(/binary|non-editable|cannot be edited/i);
  await expect(page.getByRole('button', { name: /Save/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Download/i })).toBeVisible();
});

test('files containing null bytes take the binary-safe path', async ({ page }) => {
  /** Scenario: Opening a file containing null bytes */
  await writeWorkspaceBinaryFile('data/weird.dat', [0x48, 0x49, 0x00, 0x41, 0x42, 0x43]);

  await openFixtureProject(page, { reset: false });
  await openFilesTab(page);
  await openFileByName(page, 'data', 'weird.dat');

  await expect(page.locator('body')).toContainText(/binary|non-editable|cannot be edited/i);
});

test('binary downloads from the editor preserve exact bytes', async ({ page }) => {
  /** Scenario: Downloading a binary file from the editor */
  const relativePath = 'assets/archive.bin';
  await writeWorkspaceBinaryFile(relativePath, [0x10, 0x00, 0xff, 0x7f, 0x42, 0x24]);

  await openFixtureProject(page, { reset: false });
  await openFilesTab(page);
  await openFileByName(page, 'assets', 'archive.bin');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download/i }).click(),
  ]);

  const downloadPath = await download.path();
  const downloadedBytes = await readWorkspaceBytes(relativePath);
  const savedBytes = await import('node:fs/promises').then((fs) => fs.readFile(downloadPath));

  expect(Buffer.compare(savedBytes, downloadedBytes)).toBe(0);
});

test('image assets continue to use a visual preview instead of a text editor', async ({ page }) => {
  /** Scenario: Opening an image asset from the file tree */
  await writeWorkspaceBinaryFile('images/pixel.png', TINY_PNG_BYTES);

  await openFixtureProject(page, { reset: false });
  await openFilesTab(page);
  await openFileByName(page, 'images', 'pixel.png');

  await expect(page.getByRole('img', { name: 'pixel.png' })).toBeVisible();
});
