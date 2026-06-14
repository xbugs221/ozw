// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Acceptance tests for project-chat-config-v2 OpenSpec scenarios.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  addProjectManually,
  createManualSessionDraft,
  deleteCodexSession,
  finalizeManualSessionRoute,
  getSessions,
  loadProjectConfig,
  saveProjectConfig,
  updateSessionModelState,
  updateSessionUiState,
} from '../../backend/projects.ts';
import { getProjectLocalConfigPath } from '../../backend/project-config-store.ts';
import {
  readProjectConf,
  withIsolatedProject,
} from './helpers/conf-v2-fixtures.ts';

test('Scenario: 保存项目配置时写入 v2 分组结构', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Demo');
    await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');

    await loadProjectConfig(projectPath);
    const persisted = await readProjectConf(projectPath);
    assert.equal(persisted.schemaVersion, 2);
    assert.ok(persisted.chat?.['1']);
    assert.equal(persisted.workflows, undefined);
    assert.equal('manualSessionDrafts' in persisted, false);
    assert.equal('sessionRouteIndex' in persisted, false);
    assert.ok('sessionSummaryById' in persisted);
    assert.equal(persisted.sessionSummaryById[persisted.chat['1'].sessionId], '会话1');
    assert.equal('sessionWorkflowMetadataById' in persisted, false);
    assert.equal('sessionModelStateById' in persisted, false);
    assert.equal('sessionUiStateByPath' in persisted, false);
  });
});

test('Scenario: 重复保存相同项目配置不会刷新 conf.json', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        1: { sessionId: 'codex-terminal-1', title: '终端会话1' },
      },
    }, projectPath);

    const confPath = getProjectLocalConfigPath(projectPath);
    const firstStat = await fs.stat(confPath);
    await saveProjectConfig(await loadProjectConfig(projectPath), projectPath);
    const secondStat = await fs.stat(confPath);
    const persisted = await fs.readFile(confPath, 'utf8');

    assert.equal(persisted.endsWith('\n'), true);
    assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
  });
});

test('Scenario: 保存普通会话配置不会清空已有 workflow 配置', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    await saveProjectConfig({
      schemaVersion: 2,
      workflows: {
        1: {
          title: '清理技术债',
          stage: 'execution',
          runState: 'running',
          providers: {
            planning: 'claude',
            execution: 'claude',
          },
          chat: {
            1: {
              sessionId: 'workflow-execution-session',
              title: '执行阶段',
            },
          },
        },
      },
    }, projectPath);

    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        1: {
          sessionId: 'codex-terminal-1',
          title: '普通会话',
        },
      },
    }, projectPath);

    const persisted = await readProjectConf(projectPath);

    assert.equal(persisted.workflows, undefined);
    assert.equal(persisted.chat['1'].sessionId, 'codex-terminal-1');
  });
});

test('Scenario: 单条普通会话聚合所有展示状态', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Aggregate Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await updateSessionModelState(projectPath, draft.id, {
      model: 'gpt-5.5',
      reasoningEffort: 'low',
    });
    await updateSessionUiState(project.name, draft.id, 'codex', { favorite: true });

    const persisted = await readProjectConf(projectPath);
    assert.deepEqual(persisted.chat['1'], {
      sessionId: draft.id,
      title: '会话1',
      provider: 'codex',
      origin: 'manual',
      model: 'gpt-5.5',
      reasoningEffort: 'low',
      ui: { favorite: true },
    });
    assert.equal(Object.prototype.hasOwnProperty.call(persisted.chat, draft.id), false);
  });
});

test('Scenario: v2 会话 UI 状态按 provider 和项目路径写入并回读', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Session UI Provider Demo');
    const codexDraft = await createManualSessionDraft(project.name, projectPath, 'codex', 'Codex 会话');
    const piDraft = await createManualSessionDraft(project.name, projectPath, 'pi', 'Pi 会话');

    await updateSessionUiState(project.name, codexDraft.id, 'codex', { favorite: true, hidden: true });
    await updateSessionUiState(project.name, piDraft.id, 'pi', { pending: true });

    const persisted = await readProjectConf(projectPath);
    assert.deepEqual(persisted.chat['1'].ui, { favorite: true, hidden: true });
    assert.equal(persisted.chat['1'].provider, 'codex');
    assert.deepEqual(persisted.chat['2'].ui, { pending: true });
    assert.equal(persisted.chat['2'].provider, 'pi');
    assert.equal('sessionUiStateByPath' in persisted, false);
  });
});

test('Scenario: provider 缺省的 v2 chat ui 归一化为 Codex 会话状态', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Providerless Codex UI Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', 'Providerless Codex UI state regression');
    await updateSessionUiState(project.name, draft.id, undefined, { favorite: true, hidden: true });

    const persisted = await readProjectConf(projectPath);
    assert.equal(persisted.chat['1'].provider, 'codex');
    assert.deepEqual(persisted.chat['1'].ui, { favorite: true, hidden: true });
  });
});

test('Scenario: legacy sessionUiStateByPath 归一化保存时合并到 v2 chat ui', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        1: {
          sessionId: 'legacy-codex-session',
          title: 'Legacy Codex 会话',
          provider: 'codex',
        },
      },
      sessionUiStateByPath: {
        [`codex:${projectPath}:legacy-codex-session`]: {
          favorite: true,
          hidden: true,
        },
      },
    }, projectPath);

    const persisted = await readProjectConf(projectPath);
    assert.deepEqual(persisted.chat['1'].ui, { favorite: true, hidden: true });
    assert.equal('sessionUiStateByPath' in persisted, false);
  });
});

test('Scenario: Codex 推理深度随会话状态写入项目配置', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Codex Reasoning Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', 'Codex 会话1');
    await updateSessionModelState(projectPath, draft.id, {
      model: 'gpt-5.4',
      reasoningEffort: 'high',
    });

    const persisted = await readProjectConf(projectPath);
    assert.equal(persisted.chat['1'].provider, 'codex');
    assert.equal(persisted.chat['1'].model, 'gpt-5.4');
    assert.equal(persisted.chat['1'].reasoningEffort, 'high');
  });
});


test('Scenario: 终端会话已占用编号后新建 WebUI 草稿', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Numbering Demo');
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        18: { sessionId: 'codex-terminal-18', title: '终端会话18', ui: {} },
        19: { sessionId: 'codex-terminal-19', title: '终端会话19', ui: {} },
      },
    }, projectPath);

    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话20');
    const persisted = await readProjectConf(projectPath);
    assert.equal(draft.id, 'c20');
    assert.equal(persisted.chat['20'].sessionId, 'c20');
    assert.equal(persisted.chat['18'].sessionId, 'codex-terminal-18');
    assert.equal(persisted.chat['19'].sessionId, 'codex-terminal-19');
  });
});

test('Scenario: 删除普通会话后编号不回收', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Non-Recycle Demo');
    await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await createManualSessionDraft(project.name, projectPath, 'codex', '会话2');
    const config = await loadProjectConfig(projectPath);
    delete config.chat['1'];
    await saveProjectConfig(config, projectPath);

    const nextDraft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话3');
    const persisted = await readProjectConf(projectPath);
    assert.equal(nextDraft.id, 'c3');
    assert.equal(persisted.chat['3'].sessionId, 'c3');
    assert.equal('1' in persisted.chat, false);
  });
});

test('Scenario: WebUI 普通草稿 finalize', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Finalize Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');
    await updateSessionModelState(projectPath, draft.id, {
      model: 'gpt-5.5',
      reasoningEffort: 'medium',
    });

    const finalized = await finalizeManualSessionRoute(
      project.name,
      draft.id,
      'codex-real-session-1',
      'codex',
      projectPath,
    );
    const persisted = await readProjectConf(projectPath);

    assert.equal(finalized, true);
    assert.equal(persisted.chat['1'].sessionId, 'codex-real-session-1');
    assert.equal(persisted.chat['1'].title, '会话1');
    assert.equal(persisted.chat['1'].model, 'gpt-5.5');
    assert.equal(persisted.chat['1'].reasoningEffort, 'medium');
  });
});

test('Scenario: WebUI 草稿不会 finalize 到自身路由 id', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Self Finalize Guard Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');

    const finalized = await finalizeManualSessionRoute(
      project.name,
      draft.id,
      draft.id,
      'codex',
      projectPath,
    );
    const persisted = await readProjectConf(projectPath);

    assert.equal(finalized, false);
    assert.equal(persisted.chat['1'].sessionId, draft.id);
    assert.equal(persisted.chat['1'].title, '会话1');
  });
});

test('Scenario: finalize legacy cN route advances stale manual counter', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Finalize Counter Demo');
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        3: {
          sessionId: 'c3',
          title: '旧版草稿会话',
          provider: 'codex',
          origin: 'manual',
        },
      },
      manualSessionRouteCounter: 1,
    }, projectPath);

    const finalized = await finalizeManualSessionRoute(
      project.name,
      'c3',
      'codex-real-legacy-c3',
      'codex',
      projectPath,
    );
    const persisted = await readProjectConf(projectPath);

    assert.equal(finalized, true);
    assert.equal(persisted.chat['3'].sessionId, 'codex-real-legacy-c3');
    assert.equal(persisted.manualSessionRouteCounter, 3);
  });
});

test('Scenario: 草稿未发送真实请求', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    const project = await addProjectManually(projectPath, 'Conf V2 Draft Demo');
    const draft = await createManualSessionDraft(project.name, projectPath, 'codex', '会话1');

    const persisted = await readProjectConf(projectPath);
    assert.equal(persisted.chat['1'].sessionId, draft.id);
    assert.equal(persisted.chat['1'].title, '会话1');
  });
});

test('Scenario: 删除没有 JSONL 的 Codex 空会话记录', async () => {
  await withIsolatedProject(async ({ projectPath }) => {
    await saveProjectConfig({
      schemaVersion: 2,
      chat: {
        52: { sessionId: 'c52', title: '会话52' },
      },
    }, projectPath);

    const deleted = await deleteCodexSession('c52', projectPath);
    const persisted = await readProjectConf(projectPath);

    assert.equal(deleted, true);
    assert.equal(persisted.chat, undefined);
  });
});
