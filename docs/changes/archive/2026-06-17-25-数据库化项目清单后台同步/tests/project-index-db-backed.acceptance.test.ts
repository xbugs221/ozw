/**
 * PURPOSE: Acceptance contracts for the DB-backed project list proposal.
 * These tests use real environment loading, SQLite records, and backend project
 * discovery entry points so the implementation cannot pass by only changing UI.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

const REPO_ROOT = path.resolve(new URL('../../../../', import.meta.url).pathname);
const EVIDENCE_DIR = path.join(REPO_ROOT, 'test-results', 'project-index-db-backed');

/**
 * Persist runtime evidence required by the active change acceptance contract.
 */
async function writeEvidence(relativePath: string, content: string): Promise<void> {
  /**
   * PURPOSE: Keep acceptance-run evidence in deterministic paths checked by
   * the oz gate.
   */
  const evidencePath = path.join(EVIDENCE_DIR, relativePath);
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });
  await fs.writeFile(evidencePath, content, 'utf8');
}

/**
 * Create an isolated HOME and remove it after the test body completes.
 */
async function withTemporaryHome(testBody: (homeDir: string) => Promise<void>): Promise<void> {
  /**
   * PURPOSE: Keep contract tests away from the developer's real provider
   * histories and database while still exercising real filesystem behavior.
   */
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-project-index-contract-'));
  try {
    await testBody(homeDir);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

/**
 * Run a small tsx program in a clean process with a controlled HOME.
 */
function runTsxEval(source: string, env: NodeJS.ProcessEnv): string {
  /**
   * PURPOSE: Verify startup-time environment behavior without reusing modules
   * already imported by the current test worker.
   */
  const result = spawnSync('pnpm', ['exec', 'tsx', '-e', source], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test('默认数据库路径使用 ozw.db 而不是 auth.db', async () => {
  await withTemporaryHome(async (homeDir) => {
    const env = {
      ...process.env,
      HOME: homeDir,
      DATABASE_PATH: '',
      OZW_DATABASE_PATH_DEFAULTED: '',
    };
    delete env.DATABASE_PATH;
    delete env.OZW_DATABASE_PATH_DEFAULTED;

    const output = runTsxEval(
      "import './backend/load-env.ts'; console.log(process.env.DATABASE_PATH || '');",
      env,
    );

    assert.equal(path.basename(output), 'ozw.db');
    assert.equal(path.dirname(output), path.join(homeDir, '.ozw'));
    await writeEvidence('4001-runtime.log', [
      'runtime-log-4001',
      `DATABASE_PATH=${output}`,
      `basename=${path.basename(output)}`,
    ].join('\n'));
  });
});

test('CLI status 默认数据库路径与服务端默认路径一致', async () => {
  await withTemporaryHome(async (homeDir) => {
    const env = {
      ...process.env,
      HOME: homeDir,
      DATABASE_PATH: '',
    };
    delete env.DATABASE_PATH;

    const result = spawnSync('pnpm', ['exec', 'tsx', 'backend/cli.ts', 'status'], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp(`${homeDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*\\.ozw.*ozw\\.db`, 's'));
    assert.doesNotMatch(result.stdout, /server[/\\]database[/\\]ozw\.db/);
  });
});

test('轻量项目清单从 project_index 读取且不扫描 provider 历史目录', async () => {
  await withTemporaryHome(async (homeDir) => {
    const originalHome = process.env.HOME;
    const originalDatabasePath = process.env.DATABASE_PATH;
    const originalDefaulted = process.env.OZW_DATABASE_PATH_DEFAULTED;
    const dbPath = path.join(homeDir, '.ozw', 'ozw.db');
    const projectPath = path.join(homeDir, 'work', 'db-backed-project');
    const originalReaddir = fs.readdir;
    let providerDirectoryScanCount = 0;

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    try {
      sqlite.exec(`
        CREATE TABLE project_index (
          project_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          display_name TEXT NOT NULL,
          project_path TEXT NOT NULL,
          normalized_project_path TEXT NOT NULL,
          route_path TEXT NOT NULL,
          source TEXT NOT NULL,
          visible INTEGER NOT NULL DEFAULT 1,
          last_activity TEXT,
          indexed_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `);
      sqlite.prepare(`
        INSERT INTO project_index (
          project_id,
          name,
          display_name,
          project_path,
          normalized_project_path,
          route_path,
          source,
          visible,
          last_activity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'db-backed-project',
        'db-backed-project',
        'DB Backed Project',
        projectPath,
        path.resolve(projectPath),
        '/work/db-backed-project',
        'provider',
        1,
        '2026-06-17T00:00:00.000Z',
      );
    } finally {
      sqlite.close();
    }

    process.env.HOME = homeDir;
    process.env.DATABASE_PATH = dbPath;
    process.env.OZW_DATABASE_PATH_DEFAULTED = '';
    fs.readdir = async (...args: Parameters<typeof fs.readdir>) => {
      const target = String(args[0] || '');
      if (target.includes(`${path.sep}.codex`) || target.includes(`${path.sep}.pi`)) {
        providerDirectoryScanCount += 1;
        return [];
      }
      return originalReaddir(...args);
    };

    try {
      const projectsModule = await import('../../../../backend/projects.ts');
      const projects = await projectsModule.getProjects(null, { lightweightList: true });
      const indexedProject = projects.find((project: Record<string, unknown>) => project.fullPath === projectPath);

      assert.ok(indexedProject, 'DB-indexed project must appear in the lightweight project list');
      assert.equal(providerDirectoryScanCount, 0, 'GET /api/projects must not scan provider history directories');
      assert.equal(Object.prototype.hasOwnProperty.call(indexedProject, 'codexSessions'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(indexedProject, 'piSessions'), false);
      await writeEvidence('project-list-network.json', JSON.stringify({
        evidence: 'network-project-list',
        source: 'contract-project-list-db-only',
        projectCount: projects.length,
        providerDirectoryScanCount,
        fields: Object.keys(indexedProject || {}).sort(),
        projects,
      }, null, 2));
      await writeEvidence('project-index-sync.log', [
        'runtime-log-sync',
        'project_index seeded in SQLite fixture and read through getProjects(lightweightList=true)',
        `projectPath=${projectPath}`,
        `providerDirectoryScanCount=${providerDirectoryScanCount}`,
      ].join('\n'));
    } finally {
      fs.readdir = originalReaddir;
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalDatabasePath === undefined) {
        delete process.env.DATABASE_PATH;
      } else {
        process.env.DATABASE_PATH = originalDatabasePath;
      }
      if (originalDefaulted === undefined) {
        delete process.env.OZW_DATABASE_PATH_DEFAULTED;
      } else {
        process.env.OZW_DATABASE_PATH_DEFAULTED = originalDefaulted;
      }
    }
  });
});

test('provider 同步不会把系统临时 ozw-pi 项目写入可见清单', async () => {
  await withTemporaryHome(async (homeDir) => {
    const dbPath = path.join(homeDir, '.ozw', 'ozw.db');
    const projectPath = path.join(os.tmpdir(), `ozw-pi-contract-${Date.now()}`, 'repo');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.mkdir(projectPath, { recursive: true });

    const output = runTsxEval(`
      import { upsertProjectIndexFromProviderSession } from './backend/domains/projects/project-index-sync-service.ts';
      import { projectIndexDb } from './backend/project-index-store.ts';
      import { db } from './backend/database/db.ts';
      (async () => {
        await upsertProjectIndexFromProviderSession({
          projectPath: process.env.CONTRACT_PROJECT_PATH,
          lastActivity: '2026-06-17T00:00:00.000Z',
        });
        console.log(JSON.stringify(projectIndexDb.listVisible(db).map((project) => project.fullPath)));
      })();
    `, {
      ...process.env,
      HOME: homeDir,
      DATABASE_PATH: dbPath,
      CONTRACT_PROJECT_PATH: projectPath,
    });

    await fs.rm(path.dirname(projectPath), { recursive: true, force: true });
    const visibleProjectsJson = output.split('\n').filter(Boolean).at(-1) || '[]';
    assert.deepEqual(JSON.parse(visibleProjectsJson), []);
  });
});

test('provider JSONL 删除事件会隐藏无剩余会话的 provider 项目并刷新项目清单', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-watch-contract-'));
  try {
    const { createProviderWatcherController } = await import('../../../../backend/server/provider-watchers.ts');
    const counts = {
      delete: 0,
      hide: 0,
      projectInvalidated: 0,
      sessionChanged: 0,
    };
    const projectPath = path.join(root, 'project');
    const controller = createProviderWatcherController({
      PROVIDER_WATCH_PATHS: [{ provider: 'codex', rootPath: root }],
      WATCHER_IGNORED_PATTERNS: [],
      clearProjectDirectoryCache() {},
      async getProviderSessionProjectPathForFile() {
        return projectPath;
      },
      async deleteProviderSessionIndexFile() {
        counts.delete += 1;
      },
      async countProviderSessionsForProject() {
        return 0;
      },
      hideProviderProjectIndex() {
        counts.hide += 1;
      },
      async indexProviderSessionFile() {
        return { projectPath, lastActivity: '2026-06-17T00:00:00.000Z' };
      },
      async upsertProjectIndexFromProviderSession() {
        return projectPath;
      },
      async resolveProviderSessionChange(args: Record<string, unknown>) {
        return args;
      },
      broadcastSessionChanged() {
        counts.sessionChanged += 1;
      },
      broadcastWorkflowChanged() {},
      broadcastProjectListInvalidated() {
        counts.projectInvalidated += 1;
      },
      async attachWorkflowMetadata(projects: unknown[]) {
        return projects;
      },
      async getProjects() {
        return [];
      },
      async ensureGoRunnerWatchersForProjects() {},
    });

    await controller.setupProjectsWatcher();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const filePath = path.join(root, 'session.jsonl');
    await fs.writeFile(filePath, '{}\n', 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 900));
    counts.delete = 0;
    counts.hide = 0;
    counts.projectInvalidated = 0;
    counts.sessionChanged = 0;

    await fs.unlink(filePath);
    await new Promise((resolve) => setTimeout(resolve, 900));
    await controller.closeProjectsWatchers();

    assert.equal(counts.delete, 1);
    assert.equal(counts.hide, 1);
    assert.equal(counts.projectInvalidated, 1);
    assert.equal(counts.sessionChanged, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('项目 rename/delete 写路径会同步 DB-backed 轻量项目清单', async () => {
  await withTemporaryHome(async (homeDir) => {
    const dbPath = path.join(homeDir, '.ozw', 'ozw.db');
    const projectPath = path.join(homeDir, 'work', 'rename-delete-project');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.mkdir(projectPath, { recursive: true });

    const output = runTsxEval(`
      import { addProjectManually, getProjects } from './backend/projects.ts';
      import { renameProject } from './backend/domains/projects/project-rename-service.ts';
      import { deleteProject } from './backend/domains/projects/project-session-delete-service.ts';
      (async () => {
        const projectPath = process.env.CONTRACT_PROJECT_PATH;
        const added = await addProjectManually(projectPath, 'Original Name');
        await renameProject(added.name, 'Renamed Name', projectPath);
        const afterRename = await getProjects(null, { lightweightList: true });
        await deleteProject(added.name, true, projectPath);
        const afterDelete = await getProjects(null, { lightweightList: true });
        console.log(JSON.stringify({
          afterRename: afterRename.map((project) => ({
            displayName: project.displayName,
            fullPath: project.fullPath,
          })),
          afterDelete: afterDelete.map((project) => ({
            displayName: project.displayName,
            fullPath: project.fullPath,
          })),
        }));
      })();
    `, {
      ...process.env,
      HOME: homeDir,
      DATABASE_PATH: dbPath,
      CONTRACT_PROJECT_PATH: projectPath,
    });

    const resultJson = output.split('\n').filter(Boolean).at(-1) || '{}';
    const result = JSON.parse(resultJson);
    assert.ok(
      result.afterRename.some((project: Record<string, unknown>) => (
        project.fullPath === projectPath && project.displayName === 'Renamed Name'
      )),
      'renamed project display name must be visible from DB-backed lightweight list',
    );
    assert.equal(
      result.afterDelete.some((project: Record<string, unknown>) => project.fullPath === projectPath),
      false,
      'deleted project must be removed from DB-backed lightweight list',
    );
  });
});
