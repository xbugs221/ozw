/**
 * 文件目的：保护 28 号偿债提案不得撤销 27 号高风险模块拆分意图。
 * 业务风险：如果为修旧测试把新边界合回巨型文件，后续会话和项目首页修复会重新变得难审查。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = process.cwd();

test('proposal 28 documents latest-number intent precedence', async () => {
  /**
   * 业务场景：旧测试和新意图冲突时，执行器必须知道按编号更大的提案同步更新。
   */
  const files = [
    'docs/changes/28-偿还历史测试与会话债务/brief.md',
    'docs/changes/28-偿还历史测试与会话债务/design.md',
    'docs/changes/28-偿还历史测试与会话债务/task.md',
  ];
  for (const file of files) {
    const source = await readRepoFile(file);
    assert.match(source, /编号更大|最新.*意图|提案意图优先/);
    assert.match(source, /27.*重构高风险核心模块|27 号/);
  }
});

test('proposal 27 high-risk boundaries remain split while debt is repaired', async () => {
  /**
   * 业务场景：偿还历史债务不能把 27 号已经拆出的边界重新合并回旧入口。
   */
  const panel = await readRepoFile('frontend/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx');
  const runtime = await readRepoFile('frontend/components/main-content/view/subcomponents/ProjectOverviewPanelRuntime.tsx');
  const sessionHook = await readRepoFile('frontend/components/chat/session/useChatSessionStateImpl.ts');
  const composerHook = await readRepoFile('frontend/components/chat/composer/useChatComposerStateImpl.ts');
  const realtimeHook = await readRepoFile('frontend/components/chat/hooks/useChatRealtimeHandlersImpl.ts');
  const serverBootstrap = await readRepoFile('backend/server/server-bootstrap.ts');
  const dispatcher = await readRepoFile('backend/server/realtime/chat-command-dispatcher.ts');
  const fileRoutes = await readRepoFile('backend/server/file-routes.ts');

  assert.match(panel, /ProjectOverviewPanelCore/);
  assert.match(runtime, /ProjectOverviewWorkflowGroups/);
  assert.match(runtime, /ProjectOverviewSessionCards/);
  assert.match(runtime, /ProjectOverviewActions/);
  assert.match(sessionHook, /chatSessionLifecycleController/);
  assert.match(composerHook, /composerSubmitRuntime/);
  assert.match(realtimeHook, /chatRealtimeEventRouter|streamingMessageController/);
  assert.match(serverBootstrap, /server-bootstrap-core/);
  assert.match(dispatcher, /chat-command-router|chat-command-runtime/);
  assert.match(fileRoutes, /file-routes-impl|file-routes-runtime/);

  await access(path.join(REPO_ROOT, 'docs/changes/archive/2026-06-17-27-重构高风险核心模块/tests/project-overview-refactor-contract.test.ts'));
  await access(path.join(REPO_ROOT, 'docs/changes/archive/2026-06-17-27-重构高风险核心模块/tests/chat-runtime-refactor-contract.test.ts'));
  await access(path.join(REPO_ROOT, 'docs/changes/archive/2026-06-17-27-重构高风险核心模块/tests/backend-boundary-refactor-contract.test.ts'));
});

async function readRepoFile(relativePath: string): Promise<string> {
  /**
   * 读取真实源码和提案文档，确保 28 号执行不会回退 27 号边界。
   */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}
