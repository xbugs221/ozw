// Sources: 114-统一会话路由编号与真实会话创建
/**
 * 文件目的：验证 CBW 手动会话 cN 路由编号和真实 provider session 绑定的稳定业务规格。
 * 业务意义：防止新建会话时复用旧 cN，或把 cN 当成真实 provider session 导致无法创建新会话。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createManualSessionDraft,
  finalizeManualSessionRoute,
  getManualSessionRouteRuntime,
  loadProjectConfig,
  saveProjectConfig,
} from '../../backend/projects.ts';

/**
 * 创建隔离 HOME，避免规格测试读写用户真实 Codex/Pi 历史。
 */
async function createIsolatedHome(): Promise<string> {
  /**
   * PURPOSE: Build a disposable home directory so provider discovery and project
   * config writes exercise real filesystem behavior without touching user data.
   */
  return fs.mkdtemp(path.join(os.tmpdir(), 'ozw-manual-route-numbering-'));
}

/**
 * 写入规格测试运行后的状态快照，供 QA 或回归排查复核。
 */
async function writeEvidenceSnapshot(fileName: string, payload: unknown): Promise<void> {
  /**
   * PURPOSE: Store QA evidence under test-results; the file is a local runtime
   * artifact and must not be committed.
   */
  const evidenceDir = path.join(process.cwd(), 'test-results', 'manual-session-route-numbering');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(path.join(evidenceDir, fileName), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

test('manual session route numbering skips existing cN routes and binds finalize to real provider session id', { concurrency: false }, async () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const tempHome = await createIsolatedHome();
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;

  try {
    const projectPath = path.join(tempHome, 'workspace', 'route-numbering-project');
    await fs.mkdir(projectPath, { recursive: true });

    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        '1': {
          sessionId: 'codex-real-alpha',
          provider: 'codex',
          title: '已经完成的 Codex 会话',
        },
        '2': {
          sessionId: 'pi-real-beta',
          provider: 'pi',
          title: '已经完成的 Pi 会话',
        },
      },
      manualSessionRouteCounter: 1,
    }, projectPath);

    const firstDraft = await createManualSessionDraft(
      'route-numbering-project',
      projectPath,
      'codex',
      '用户点击新建 Codex 会话',
    );
    assert.equal(firstDraft.id, 'c3', '过期 counter 不能导致复用 c1/c2，新 draft 必须使用 c3');

    const runtimeBeforeFinalize = await getManualSessionRouteRuntime(
      'route-numbering-project',
      projectPath,
      firstDraft.id,
    );
    assert.equal(runtimeBeforeFinalize?.routeIndex, 3, 'runtime 必须保留 c3 的 route index');
    assert.equal(runtimeBeforeFinalize?.providerSessionId, '', '未 finalize 的 c3 不能被当成真实 provider session id');

    const secondDraft = await createManualSessionDraft(
      'route-numbering-project',
      projectPath,
      'pi',
      '用户继续新建 Pi 会话',
    );
    assert.equal(secondDraft.id, 'c4', '连续新建 draft 必须继续推进到 c4，不能复用 c3');

    const finalized = await finalizeManualSessionRoute(
      'route-numbering-project',
      firstDraft.id,
      'codex-real-gamma',
      'codex',
      projectPath,
    );
    assert.equal(finalized, true, 'provider 返回真实 session id 后，c3 route 必须能 finalize');

    const runtimeAfterFinalize = await getManualSessionRouteRuntime(
      'route-numbering-project',
      projectPath,
      firstDraft.id,
    );
    assert.equal(runtimeAfterFinalize?.providerSessionId, 'codex-real-gamma', 'finalize 后 c3 必须绑定真实 provider session id');

    const finalConfig = await loadProjectConfig(projectPath) as {
      chat?: Record<string, { sessionId?: string }>;
      manualSessionDrafts?: Record<string, { provider?: string }>;
      manualSessionRouteCounter?: number;
    };
    assert.equal(finalConfig.chat?.['3']?.sessionId, 'codex-real-gamma', 'chat.3 必须指向真实 provider session');
    assert.equal(finalConfig.manualSessionDrafts?.c4?.provider, 'pi', '未 finalize 的第二个 draft 必须保留在 c4');
    assert.equal(finalConfig.manualSessionRouteCounter, 4, 'counter 必须推进到最新已分配 route index');

    await writeEvidenceSnapshot('project-config-after-finalize.json', {
      firstDraft,
      secondDraft,
      runtimeBeforeFinalize,
      runtimeAfterFinalize,
      finalConfig: {
        chat: finalConfig.chat,
        manualSessionDrafts: finalConfig.manualSessionDrafts,
        manualSessionRouteCounter: finalConfig.manualSessionRouteCounter,
      },
    });
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
  }
});
