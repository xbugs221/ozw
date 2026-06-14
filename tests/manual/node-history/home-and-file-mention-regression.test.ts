/**
 * PURPOSE: Verify the home-page degradation and file mention picker contracts for oz change 39.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  addProjectManually,
  clearProjectDirectoryCache,
  getProjects,
} from '../../../backend/projects.ts';
import { filterMentionableFiles, type MentionableFile } from '../../../frontend/components/chat/utils/fileMentionSearch.ts';
import { buildFileTree } from '../../../frontend/components/chat/utils/fileMentionTree.ts';

/**
 * Run a regression case with isolated HOME and state so no real user sessions are scanned.
 */
async function withIsolatedHome(testBody: (homeDir: string) => Promise<void>): Promise<void> {
  const originalHome = process.env.HOME;
  const originalXdgStateHome = process.env.XDG_STATE_HOME;
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-change-39-'));

  process.env.HOME = homeDir;
  process.env.XDG_STATE_HOME = path.join(homeDir, '.local', 'state');
  clearProjectDirectoryCache();

  try {
    await testBody(homeDir);
  } finally {
    clearProjectDirectoryCache();
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalXdgStateHome) {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    } else {
      delete process.env.XDG_STATE_HOME;
    }
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

/**
 * Write one JSONL file for provider header-index fixtures.
 */
async function writeJsonl(filePath: string, records: string[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${records.join('\n')}\n`, 'utf8');
}

test('home discovery returns manual projects when a Codex index is slower than the home budget', async () => {
  await withIsolatedHome(async (homeDir) => {
    const projectPath = path.join(homeDir, 'work', 'manual-project');
    const codexSessionsRoot = path.join(homeDir, '.codex', 'sessions');
    const originalReaddir = fs.readdir;

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(codexSessionsRoot, { recursive: true });
    await addProjectManually(projectPath);
    clearProjectDirectoryCache();

    (fs as unknown as { readdir: typeof fs.readdir }).readdir = async (...args: any[]) => {
      if (path.resolve(String(args[0])) === path.resolve(codexSessionsRoot)) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      return (originalReaddir as any)(...args);
    };

    try {
      const startedAt = Date.now();
      const projects = await getProjects();
      const durationMs = Date.now() - startedAt;

      assert.equal(projects.some((project) => project.fullPath === projectPath), true);
      assert.ok(durationMs < 3500, `expected budgeted home fallback, got ${durationMs}ms`);
    } finally {
      (fs as unknown as { readdir: typeof fs.readdir }).readdir = originalReaddir;
    }
  });
});

test('provider-only discovery keeps Codex and Pi sessions on one project', async () => {
  await withIsolatedHome(async (homeDir) => {
    const sharedProjectPath = path.join(homeDir, 'work', 'shared-project');

    await fs.mkdir(sharedProjectPath, { recursive: true });
    await writeJsonl(
      path.join(homeDir, '.codex', 'sessions', '2026', '05', '18', 'rollout-2026-05-18T01-00-00-codex-shared.jsonl'),
      [JSON.stringify({ type: 'session_meta', timestamp: '2026-05-18T01:00:00.000Z', payload: { id: 'codex-shared-source', cwd: sharedProjectPath } })],
    );
    await writeJsonl(
      path.join(homeDir, '.pi', 'agent', 'sessions', 'shared', 'pi-shared.jsonl'),
      [JSON.stringify({ type: 'session', id: 'pi-shared', timestamp: '2026-05-18T01:01:00.000Z', cwd: sharedProjectPath })],
    );

    const projects = await getProjects();
    const sharedProject = projects.find((project) => project.fullPath === sharedProjectPath);

    assert.ok(sharedProject, 'shared provider-only project should be discovered');
    assert.equal(sharedProject.codexSessions.some((session: { provider?: string }) => session.provider === 'codex'), true);
    assert.equal(sharedProject.piSessions.some((session: { provider?: string }) => session.provider === 'pi'), true);
  });
});

test('provider-only discovery caps the project list at 50 entries', async () => {
  await withIsolatedHome(async (homeDir) => {
    for (let index = 0; index < 55; index += 1) {
      const projectPath = path.join(homeDir, 'work', `provider-only-${index}`);
      await fs.mkdir(projectPath, { recursive: true });
      await writeJsonl(
        path.join(homeDir, '.codex', 'sessions', '2026', '05', '18', `rollout-2026-05-18T02-${String(index).padStart(2, '0')}-00-codex-${index}.jsonl`),
        [JSON.stringify({ type: 'session_meta', timestamp: `2026-05-18T02:${String(index).padStart(2, '0')}:00.000Z`, payload: { id: `codex-${index}-source`, cwd: projectPath } })],
      );
    }

    const projects = await getProjects();
    const providerOnlyProjects = projects.filter((project: { isManuallyAdded?: boolean }) => !project.isManuallyAdded);

    assert.ok(providerOnlyProjects.length <= 50, `provider-only projects should be capped at 50, got ${providerOnlyProjects.length}`);
  });
});

test('file mention search is bounded, fuzzy, and keeps expandable tree paths', () => {
  const files: MentionableFile[] = Array.from({ length: 100 }, (_, index: number) => ({
    name: index === 42 ? 'SettlementPolicy.ts' : `GeneratedFile${index}.ts`,
    path: index === 42 ? 'frontend/domain/SettlementPolicy.ts' : `frontend/generated/GeneratedFile${index}.ts`,
  }));
  const filteredFiles = filterMentionableFiles(files, 'set pol');
  const fileTree = buildFileTree([
    {
      name: 'src',
      type: 'directory',
      children: [
        {
          name: 'domain',
          type: 'directory',
          children: [{ name: 'SettlementPolicy.ts', type: 'file', path: 'frontend/domain/SettlementPolicy.ts' }],
        },
      ],
    },
  ]);

  assert.ok(filteredFiles.length <= 80, `file mention results should be bounded, got ${filteredFiles.length}`);
  assert.equal(filteredFiles[0]?.path, 'frontend/domain/SettlementPolicy.ts');
  assert.equal(fileTree[0]?.fullPath, 'src');
  assert.equal(fileTree[0]?.children?.[0]?.fullPath, 'frontend/domain');
  assert.equal(fileTree[0]?.children?.[0]?.children?.[0]?.fullPath, 'frontend/domain/SettlementPolicy.ts');
});
