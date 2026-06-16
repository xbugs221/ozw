/**
 * Sources: 2026-06-17-25-数据库化项目清单后台同步
 *
 * 文件目的：验证项目清单切换为 SQLite project_index 读模型后的长期业务契约。
 * 业务场景：首屏项目清单必须轻量、稳定，并由后台同步和项目写路径维护。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

const REPO_ROOT = process.cwd();

/**
 * Run one DB-backed project-list scenario in an isolated HOME.
 */
async function withTemporaryHome(testBody: (homeDir: string) => Promise<void>): Promise<void> {
  /**
   * PURPOSE: Keep the spec away from the developer's real provider histories
   * and default database while still exercising real filesystem behavior.
   */
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-project-index-spec-'));
  try {
    await testBody(homeDir);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
}

/**
 * Run a small tsx program in a fresh process with controlled environment.
 */
function runTsxEval(source: string, env: NodeJS.ProcessEnv): string {
  /**
   * PURPOSE: Validate startup-time module behavior without reusing imports
   * already cached by the current test worker.
   */
  const result = spawnSync('pnpm', ['exec', 'tsx', '-e', source], {
    cwd: REPO_ROOT,
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

test('默认数据库路径和 CLI status 使用 ~/.ozw/ozw.db', async () => {
  /**
   * 业务场景：默认数据库承载全应用状态，服务端和 CLI 不能继续指向 auth.db
   * 或安装目录下的 server/database/ozw.db。
   */
  await withTemporaryHome(async (homeDir) => {
    const env = { ...process.env, HOME: homeDir };
    delete env.DATABASE_PATH;
    delete env.OZW_DATABASE_PATH_DEFAULTED;

    const loadedPath = runTsxEval(
      "import './backend/load-env.ts'; console.log(process.env.DATABASE_PATH || '');",
      env,
    );
    assert.equal(loadedPath, path.join(homeDir, '.ozw', 'ozw.db'));

    const status = spawnSync('pnpm', ['exec', 'tsx', 'backend/cli.ts', 'status'], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    });
    assert.equal(status.status, 0, status.stderr || status.stdout);
    assert.match(status.stdout, /Database Location/);
    assert.match(status.stdout, /\.ozw[/\\]ozw\.db/);
    assert.doesNotMatch(status.stdout, /server[/\\]database[/\\]ozw\.db/);
  });
});

test('轻量项目清单只从 project_index 返回有界摘要', async () => {
  /**
   * 业务场景：刷新首页时 `/api/projects` 只读 SQLite project_index，
   * 不扫描 provider 历史目录，也不回传 provider session 重数组。
   */
  await withTemporaryHome(async (homeDir) => {
    const originalHome = process.env.HOME;
    const originalDatabasePath = process.env.DATABASE_PATH;
    const originalDefaulted = process.env.OZW_DATABASE_PATH_DEFAULTED;
    const originalReaddir = fs.readdir;
    const dbPath = path.join(homeDir, '.ozw', 'ozw.db');
    const projectPath = path.join(homeDir, 'work', 'db-backed-project');
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
      const projectsModule = await import('../../backend/projects.ts');
      const projects = await projectsModule.getProjects(null, { lightweightList: true });
      const indexedProject = projects.find((project: Record<string, unknown>) => project.fullPath === projectPath);

      assert.ok(indexedProject, 'DB-indexed project must appear in the lightweight project list');
      assert.equal(providerDirectoryScanCount, 0);
      assert.equal(Object.prototype.hasOwnProperty.call(indexedProject, 'codexSessions'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(indexedProject, 'piSessions'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(indexedProject, 'workflows'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(indexedProject, 'batches'), false);
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

test('项目索引同步保留可见性、unlink、rename 和 delete 语义', async () => {
  /**
   * 业务场景：后台同步和既有项目写路径必须维护 project_index，
   * 否则 DB-backed 侧边栏会显示临时项目、旧名称或已删除项目。
   */
  await withTemporaryHome(async (homeDir) => {
    const dbPath = path.join(homeDir, '.ozw', 'ozw.db');
    const manualProjectPath = path.join(homeDir, 'work', 'rename-delete-project');
    const tempProviderPath = path.join(os.tmpdir(), `ozw-pi-spec-${Date.now()}`, 'repo');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.mkdir(manualProjectPath, { recursive: true });
    await fs.mkdir(tempProviderPath, { recursive: true });

    try {
      const output = runTsxEval(`
        import { addProjectManually, getProjects } from './backend/projects.ts';
        import { renameProject } from './backend/domains/projects/project-rename-service.ts';
        import { deleteProject } from './backend/domains/projects/project-session-delete-service.ts';
        import { upsertProjectIndexFromProviderSession } from './backend/domains/projects/project-index-sync-service.ts';
        import { projectIndexDb } from './backend/project-index-store.ts';
        import { db } from './backend/database/db.ts';
        (async () => {
          await upsertProjectIndexFromProviderSession({
            projectPath: process.env.TEMP_PROVIDER_PATH,
            lastActivity: '2026-06-17T00:00:00.000Z',
          });
          const visibleAfterTempProvider = projectIndexDb.listVisible(db).map((project) => project.fullPath);
          const added = await addProjectManually(process.env.MANUAL_PROJECT_PATH, 'Original Name');
          await renameProject(added.name, 'Renamed Name', process.env.MANUAL_PROJECT_PATH);
          const afterRename = await getProjects(null, { lightweightList: true });
          await deleteProject(added.name, true, process.env.MANUAL_PROJECT_PATH);
          const afterDelete = await getProjects(null, { lightweightList: true });
          console.log(JSON.stringify({
            visibleAfterTempProvider,
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
        MANUAL_PROJECT_PATH: manualProjectPath,
        TEMP_PROVIDER_PATH: tempProviderPath,
      });

      const result = JSON.parse(output.split('\n').filter(Boolean).at(-1) || '{}');
      assert.deepEqual(result.visibleAfterTempProvider, []);
      assert.equal(
        result.afterRename.some((project: Record<string, unknown>) => (
          project.fullPath === manualProjectPath && project.displayName === 'Renamed Name'
        )),
        true,
      );
      assert.equal(
        result.afterDelete.some((project: Record<string, unknown>) => project.fullPath === manualProjectPath),
        false,
      );
    } finally {
      await fs.rm(path.dirname(tempProviderPath), { recursive: true, force: true });
    }
  });
});
