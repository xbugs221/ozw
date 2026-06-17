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
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: homeDir };
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
    const scanGuardReaddir = async (...args: Parameters<typeof fs.readdir>) => {
      const target = String(args[0] || '');
      if (target.includes(`${path.sep}.codex`) || target.includes(`${path.sep}.pi`)) {
        providerDirectoryScanCount += 1;
        return [] as Awaited<ReturnType<typeof fs.readdir>>;
      }
      return originalReaddir(...args);
    };
    fs.readdir = scanGuardReaddir as typeof fs.readdir;

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
    const staleManualProjectPath = path.join(homeDir, 'work', 'claude-demo');
    const staleProviderProjectPath = path.join(homeDir, 'missing', 'conf-v2-project');
    const tempProviderPath = path.join(os.tmpdir(), `ozw-pi-spec-${Date.now()}`, 'repo');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.mkdir(manualProjectPath, { recursive: true });
    await fs.mkdir(staleManualProjectPath, { recursive: true });
    await fs.mkdir(tempProviderPath, { recursive: true });

    try {
      const output = runTsxEval(`
        import { addProjectManually, getProjects } from './backend/projects.ts';
        import { renameProject } from './backend/domains/projects/project-rename-service.ts';
        import { deleteProject } from './backend/domains/projects/project-session-delete-service.ts';
        import { reconcileProjectIndex, upsertProjectIndexFromProviderSession } from './backend/domains/projects/project-index-sync-service.ts';
        import { projectIndexDb } from './backend/project-index-store.ts';
        import { db } from './backend/database/db.ts';
        (async () => {
          await upsertProjectIndexFromProviderSession({
            projectPath: process.env.TEMP_PROVIDER_PATH,
            lastActivity: '2026-06-17T00:00:00.000Z',
          });
          const visibleAfterTempProvider = projectIndexDb.listVisible(db).map((project) => project.fullPath);
          const added = await addProjectManually(process.env.MANUAL_PROJECT_PATH, 'Original Name');
          projectIndexDb.upsert(db, {
            projectId: process.env.STALE_MANUAL_PROJECT_PATH,
            name: 'claude-demo',
            displayName: 'Claude Demo',
            projectPath: process.env.STALE_MANUAL_PROJECT_PATH,
            routePath: '/tmp/claude-demo',
            source: 'manual',
            visible: true,
            syncState: 'ready',
          });
          projectIndexDb.upsert(db, {
            projectId: process.env.STALE_PROVIDER_PROJECT_PATH,
            name: 'conf-v2-project',
            displayName: 'Conf V2 Project',
            projectPath: process.env.STALE_PROVIDER_PROJECT_PATH,
            routePath: '/tmp/conf-v2-project',
            source: 'provider',
            visible: true,
            syncState: 'ready',
          });
          const reconcileResult = await reconcileProjectIndex();
          const hiddenRows = db.prepare(\`
            SELECT project_path, visibility_reason
            FROM project_index
            WHERE visible = 0 AND project_path IN (?, ?)
            ORDER BY project_path
          \`).all(process.env.STALE_MANUAL_PROJECT_PATH, process.env.STALE_PROVIDER_PROJECT_PATH);
          await renameProject(added.name, 'Renamed Name', process.env.MANUAL_PROJECT_PATH);
          const afterRename = await getProjects(null, { lightweightList: true });
          await deleteProject(added.name, true, process.env.MANUAL_PROJECT_PATH);
          const afterDelete = await getProjects(null, { lightweightList: true });
          console.log(JSON.stringify({
            visibleAfterTempProvider,
            reconcileResult,
            hiddenRows,
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
        STALE_MANUAL_PROJECT_PATH: staleManualProjectPath,
        STALE_PROVIDER_PROJECT_PATH: staleProviderProjectPath,
        TEMP_PROVIDER_PATH: tempProviderPath,
      });

      const result = JSON.parse(output.split('\n').filter(Boolean).at(-1) || '{}');
      assert.deepEqual(result.visibleAfterTempProvider, []);
      assert.equal(result.reconcileResult.hiddenCount, 2);
      assert.deepEqual(result.hiddenRows, [
        { project_path: staleProviderProjectPath, visibility_reason: 'provider-path-missing' },
        { project_path: staleManualProjectPath, visibility_reason: 'manual-not-in-config' },
      ].sort((left, right) => left.project_path.localeCompare(right.project_path)));
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

test('启动 backfill 同步写入 provider_session_index 和 project_index', async () => {
  /**
   * 业务场景：用户在 ozw 离线时直接用 Codex/Pi CLI 创建会话，
   * 下次启动 backfill 必须让项目清单和项目首页会话列表都能从 DB 读模型恢复。
   */
  await withTemporaryHome(async (homeDir) => {
    const dbPath = path.join(homeDir, '.ozw', 'ozw.db');
    const projectPath = path.join(homeDir, 'work', 'offline-cli-project');
    const codexSessionPath = path.join(
      homeDir,
      '.codex',
      'sessions',
      '2026',
      '06',
      '17',
      'rollout-2026-06-17T03-00-00-codex-backfill-cli.jsonl',
    );
    const piSessionPath = path.join(homeDir, '.pi', 'agent', 'sessions', 'offline-cli', 'pi-backfill-cli.jsonl');

    await fs.mkdir(projectPath, { recursive: true });
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
    await fs.mkdir(path.dirname(codexSessionPath), { recursive: true });
    await fs.mkdir(path.dirname(piSessionPath), { recursive: true });
    await fs.writeFile(
      codexSessionPath,
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-06-17T03:00:00.000Z',
          payload: { id: 'source-codex-backfill-cli', cwd: projectPath, model: 'gpt-5-codex' },
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-06-17T03:00:01.000Z',
          payload: { type: 'user_message', message: 'Codex CLI session for startup backfill' },
        }),
      ].join('\n') + '\n',
      'utf8',
    );
    await fs.writeFile(
      piSessionPath,
      [
        JSON.stringify({
          type: 'session',
          id: 'pi-backfill-cli',
          timestamp: '2026-06-17T03:10:00.000Z',
          cwd: projectPath,
        }),
        JSON.stringify({
          type: 'message',
          timestamp: '2026-06-17T03:10:01.000Z',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'Pi CLI session for startup backfill' }],
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    );

    const output = runTsxEval(`
      (async () => {
        await import('./backend/projects.ts');
        const { backfillProjectIndex } = await import('./backend/domains/projects/project-index-sync-service.ts');
        const { db } = await import('./backend/database/db.ts');
        const result = await backfillProjectIndex();
        const providerRows = db.prepare(\`
          SELECT provider, session_id
          FROM provider_session_index
          WHERE normalized_project_path = ?
          ORDER BY provider, session_id
        \`).all(process.env.PROJECT_PATH);
        const projectRows = db.prepare(\`
          SELECT project_path
          FROM project_index
          WHERE normalized_project_path = ? AND visible = 1
        \`).all(process.env.PROJECT_PATH);
        console.log(JSON.stringify({ result, providerRows, projectRows }));
      })();
    `, {
      ...process.env,
      HOME: homeDir,
      DATABASE_PATH: dbPath,
      PROJECT_PATH: path.resolve(projectPath),
    });

    const result = JSON.parse(output.split('\n').filter(Boolean).at(-1) || '{}');
    assert.deepEqual(result.providerRows, [
      { provider: 'codex', session_id: 'codex-backfill-cli' },
      { provider: 'pi', session_id: 'pi-backfill-cli' },
    ]);
    assert.deepEqual(result.projectRows, [
      { project_path: path.resolve(projectPath) },
    ]);
    assert.equal(result.result.providerCount, 2);
  });
});
