// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Acceptance tests for workspace file-tree operations.
 * Derived from openspec/changes/upgrade-file-tree-operations/specs/workspace-file-tree-operations/spec.md.
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  authHeaders,
  authenticatePage,
  getFixtureProject,
  PRIMARY_FIXTURE_PROJECT_PATH,
  openFilesTab,
  openFixtureProject,
  readWorkspaceBytes,
  resetWorkspaceProject,
  workspacePathExists,
  writeWorkspaceBinaryFile,
  writeWorkspaceTextFile,
} from './helpers/spec-test-helpers.ts';

/**
 * List zip entries using the host unzip tooling already present in the test environment.
 */
function listZipEntries(archivePath) {
  return execFileSync('zipinfo', ['-1', archivePath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .toString('utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort();
}

/**
 * Read a zip entry as raw bytes via `unzip -p` to preserve binary data.
 */
function readZipEntry(archivePath, entryPath) {
  return execFileSync('unzip', ['-p', archivePath, entryPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Check whether an absolute path exists.
 */
async function absolutePathExists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('directory context menu exposes upload, rename, delete, copy, and download actions', async ({ page }) => {
  /** Scenario: Opening a directory context menu */
  await writeWorkspaceTextFile('docs/spec.md', '# draft\n');

  await openFixtureProject(page, { reset: false });
  await openFilesTab(page);

  await page.getByText('docs', { exact: true }).first().click({ button: 'right' });

  const contextMenu = page.getByRole('menu');
  await expect(contextMenu.getByText('Upload', { exact: true })).toBeVisible();
  await expect(page.getByText('New File', { exact: true })).toHaveCount(0);
  await expect(page.getByText('New Folder', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Rename', { exact: true })).toBeVisible();
  await expect(page.getByText('Delete', { exact: true })).toBeVisible();
  await expect(page.getByText('Copy Path', { exact: true })).toBeVisible();
  await expect(page.getByText('Download', { exact: true })).toBeVisible();
});

test('file create endpoint is not available from the file tree API', async ({ request }) => {
  /** Scenario: The removed Add File/Folder UI cannot be bypassed through the old file-tree route */
  const project = await getFixtureProject(request);

  const response = await request.post(`/api/projects/${encodeURIComponent(project.name)}/files`, {
    headers: authHeaders({ 'content-type': 'application/json' }),
    data: {
      path: '',
      type: 'file',
      name: 'todo.md',
      projectPath: project.fullPath,
    },
  });

  expect(response.status()).toBe(404);
  expect(await workspacePathExists('todo.md')).toBe(false);
});

test('directory-heavy projects keep folders collapsed until the user expands them', async ({ page }) => {
  /** Scenario: Opening a project whose useful files live under root directories */
  await writeWorkspaceTextFile('src/app.js', 'export const ready = true;\n');
  await writeWorkspaceTextFile('docs/guide.md', '# Guide\n');

  await openFixtureProject(page, { reset: false });
  await openFilesTab(page);

  await expect(page.getByText('app.js', { exact: true })).toHaveCount(0);
  await expect(page.getByText('guide.md', { exact: true })).toHaveCount(0);

  await page.getByText('src', { exact: true }).click();
  await expect(page.getByText('app.js', { exact: true })).toBeVisible();
  await page.getByText('app.js', { exact: true }).click();
  await expect(page.getByRole('button', { name: /Save/i })).toBeVisible();
});

test('rename endpoint moves a directory and preserves its nested contents', async ({ page, request }) => {
  /** Scenario: Renaming a directory from the file tree */
  await writeWorkspaceTextFile('docs/guide.md', 'hello\n');
  const project = await getFixtureProject(request);

  const response = await request.put(`/api/projects/${encodeURIComponent(project.name)}/files/rename`, {
    headers: authHeaders({ 'content-type': 'application/json' }),
    data: {
      oldPath: 'docs',
      newName: 'guides',
      projectPath: project.fullPath,
    },
  });

  expect(response.ok()).toBeTruthy();
  expect(await workspacePathExists('guides/guide.md')).toBe(true);
  expect(await workspacePathExists('docs/guide.md')).toBe(false);

  await openFixtureProject(page, { reset: false });
  await openFilesTab(page);
  await expect(page.getByText('guides', { exact: true })).toBeVisible();
  await expect(page.getByText('docs', { exact: true })).toHaveCount(0);
});

test('delete endpoint removes a workspace file and the tree no longer lists it', async ({ page, request }) => {
  /** Scenario: Deleting a file from the file tree */
  await writeWorkspaceTextFile('notes/remove-me.txt', 'obsolete\n');
  const project = await getFixtureProject(request);

  const response = await request.delete(`/api/projects/${encodeURIComponent(project.name)}/files`, {
    headers: authHeaders({ 'content-type': 'application/json' }),
    data: {
      path: 'notes/remove-me.txt',
      type: 'file',
      projectPath: project.fullPath,
    },
  });

  expect(response.ok()).toBeTruthy();
  expect(await workspacePathExists('notes/remove-me.txt')).toBe(false);

  await openFixtureProject(page);
  await openFilesTab(page);
  await expect(page.getByText('remove-me.txt', { exact: true })).toHaveCount(0);
});

test('upload endpoint rejects folder-style relative paths', async ({ page, request }) => {
  /** Scenario: Removed folder upload behavior cannot be bypassed through the upload route */
  const project = await getFixtureProject(request);
  await openFixtureProject(page);

  const uploadResult = await page.evaluate(async ({ projectName, projectPath }) => {
    const token = window.localStorage.getItem('auth-token');
    const body = new FormData();
    body.append('targetPath', '');
    body.append('projectPath', projectPath);
    body.append('relativePaths', JSON.stringify([
      'upload-batch/alpha.txt',
      'upload-batch/nested/beta.txt',
    ]));
    body.append('files', new File(['alpha\n'], 'alpha.txt', { type: 'text/plain' }));
    body.append('files', new File(['beta\n'], 'beta.txt', { type: 'text/plain' }));

    const response = await fetch(`/api/projects/${encodeURIComponent(projectName)}/files/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });

    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  }, { projectName: project.name, projectPath: project.fullPath });

  expect(uploadResult.ok, uploadResult.body).toBeFalsy();
  expect(uploadResult.status).toBe(400);
  expect(await workspacePathExists('upload-batch/alpha.txt')).toBe(false);
  expect(await workspacePathExists('upload-batch/nested/beta.txt')).toBe(false);
});

test('files tab upload action works for projects with URL-sensitive names', async ({ page, request }) => {
  /** Scenario: A manually added project path contains # and users still upload files from the toolbar */
  const specialProjectPath = path.join(path.dirname(PRIMARY_FIXTURE_PROJECT_PATH), 'hash#fixture-project');
  await fs.rm(specialProjectPath, { recursive: true, force: true });
  await fs.mkdir(specialProjectPath, { recursive: true });

  const createProjectResponse = await request.post('/api/projects/create', {
    headers: authHeaders({ 'content-type': 'application/json' }),
    data: { path: specialProjectPath },
  });

  expect(createProjectResponse.ok()).toBeTruthy();
  const projectsResponse = await request.get('/api/projects', {
    headers: authHeaders(),
  });
  expect(projectsResponse.ok()).toBeTruthy();
  const projects = await projectsResponse.json();
  const createdProject = projects.find((project) => project.fullPath === specialProjectPath);
  expect(createdProject).toBeTruthy();

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^hash#fixture-project\b/i }).click();
  await openFilesTab(page);

  await expect(page.getByRole('button', { name: /^Add File$/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Add Folder$/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Upload Files$/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Upload Folder$/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Upload$/i })).toBeVisible();

  const uploadResult = await page.evaluate(async ({ projectName, projectPath }) => {
    const { api } = await import('/frontend/utils/api.ts');
    const formData = new FormData();
    formData.append('targetPath', '.');
    formData.append('projectPath', projectPath);
    formData.append('relativePaths', JSON.stringify(['uploaded.txt']));
    formData.append('files', new File(['uploaded through files tab\n'], 'uploaded.txt', { type: 'text/plain' }));

    const response = await api.uploadProjectEntries(projectName, formData);
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  }, { projectName: createdProject.name, projectPath: createdProject.fullPath });

  expect(uploadResult.ok, uploadResult.body).toBeTruthy();
  await expect.poll(() => absolutePathExists(path.join(specialProjectPath, 'uploaded.txt'))).toBe(true);
  await page.getByRole('button', { name: /^Reload$/i }).click();
  await expect(page.getByText('uploaded.txt', { exact: true }).first()).toBeVisible();
});

test('hyphenated projects still load and expand the file tree when the request carries the real project path', async ({ request }) => {
  /** Scenario: A hyphenated project name cannot be safely reconstructed into the original filesystem path */
  const hyphenProjectPath = path.join(os.tmpdir(), `ozw-hyphen-project-${Date.now()}`, 'hybrid-agent-control-plane');
  await fs.mkdir(path.join(hyphenProjectPath, 'src'), { recursive: true });
  await fs.writeFile(path.join(hyphenProjectPath, 'src', 'index.js'), 'export const ready = true;\n', 'utf8');

  const projectName = path.basename(hyphenProjectPath);
  const encodedProjectPath = encodeURIComponent(hyphenProjectPath);

  const rootResponse = await request.get(
    `/api/projects/${encodeURIComponent(projectName)}/files?projectPath=${encodedProjectPath}&depth=0`,
    { headers: authHeaders() },
  );

  expect(rootResponse.ok()).toBeTruthy();
  const rootPayload = await rootResponse.json();
  expect(rootPayload).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'src', type: 'directory', hasChildren: true }),
  ]));

  const nestedResponse = await request.get(
    `/api/projects/${encodeURIComponent(projectName)}/files?projectPath=${encodedProjectPath}&path=${encodeURIComponent('src')}&depth=1`,
    { headers: authHeaders() },
  );

  expect(nestedResponse.ok()).toBeTruthy();
  const nestedPayload = await nestedResponse.json();
  expect(nestedPayload).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'index.js', type: 'file' }),
  ]));
});

test('single file download returns the exact bytes stored in the workspace', async ({ request }) => {
  /** Scenario: Downloading a single file from the tree */
  const expected = Buffer.from('quarterly report\n', 'utf8');
  await writeWorkspaceBinaryFile('downloads/report.txt', expected);
  const project = await getFixtureProject(request);

  const response = await request.get(
    `/api/projects/${encodeURIComponent(project.name)}/files/download?path=${encodeURIComponent('downloads/report.txt')}&projectPath=${encodeURIComponent(project.fullPath)}`,
    { headers: authHeaders() },
  );

  expect(response.ok()).toBeTruthy();
  expect(Buffer.compare(Buffer.from(await response.body()), expected)).toBe(0);
});

test('folder download returns an archive with the expected nested entries and bytes', async ({ request }) => {
  /** Scenario: Downloading a folder as an archive */
  await writeWorkspaceTextFile('release/notes.txt', 'notes\n');
  await writeWorkspaceBinaryFile('release/assets/logo.bin', [0x00, 0x01, 0x02, 0x03]);
  const project = await getFixtureProject(request);

  const response = await request.get(
    `/api/projects/${encodeURIComponent(project.name)}/folders/download?path=${encodeURIComponent('release')}&projectPath=${encodeURIComponent(project.fullPath)}`,
    { headers: authHeaders() },
  );

  expect(response.ok()).toBeTruthy();
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-file-tree-zip-'));
  const archivePath = path.join(tempDirectory, 'release.zip');
  await fs.writeFile(archivePath, Buffer.from(await response.body()));
  const entries = listZipEntries(archivePath);

  expect(entries).toContain('release/notes.txt');
  expect(entries).toContain('release/assets/logo.bin');
  expect(readZipEntry(archivePath, 'release/notes.txt').toString('utf8')).toBe('notes\n');
  expect(Buffer.compare(
    readZipEntry(archivePath, 'release/assets/logo.bin'),
    await readWorkspaceBytes('release/assets/logo.bin'),
  )).toBe(0);

  await fs.rm(tempDirectory, { recursive: true, force: true });
});
