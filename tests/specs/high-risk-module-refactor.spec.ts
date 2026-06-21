/**
 * 文件目的：规格级保护高风险模块重构后的入口边界。
 * 业务风险：ProjectOverviewPanel、useChatSessionStateImpl 和 server-bootstrap 若重新膨胀，后续 workflow/session/server 修复难以审查。
 * Sources: 2026-06-17-27-重构高风险核心模块, 2026-06-17-28-偿还历史测试与会话债务
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const lineCount = (source: string) => source.split(/\r?\n/).length;

async function readSource(path: string): Promise<string> {
  /** 读取真实源码，保证规格测试检查生产入口而不是 mock fixture。 */
  return readFile(path, 'utf8');
}

test('high-risk-module-refactor keeps public entry files as thin boundaries', async () => {
  /** 入口文件应保留原路径，同时委托到拆出的 runtime 和控制器。 */
  const panel = await readSource('frontend/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx');
  const panelCore = await readSource('frontend/components/main-content/view/subcomponents/ProjectOverviewPanelCore.tsx');
  const sessionHook = await readSource('frontend/components/chat/session/useChatSessionStateImpl.ts');
  const sessionCore = await readSource('frontend/components/chat/session/useChatSessionStateCore.ts');
  const serverBootstrap = await readSource('backend/server/server-bootstrap.ts');
  const serverCore = await readSource('backend/server/server-bootstrap-core.ts');
  assert.match(panel, /ProjectOverviewPanelCore/);
  assert.match(sessionHook, /chatSessionLifecycleController/);
  assert.match(serverBootstrap, /server-bootstrap-core/);
  assert.ok(lineCount(panelCore) <= 40);
  assert.ok(lineCount(sessionCore) <= 40);
  assert.ok(lineCount(serverCore) <= 40);
  assert.doesNotMatch(panel, /\bvoid\s+/);
  assert.doesNotMatch(sessionHook, /\bvoid\s+/);
});

test('high-risk-module-refactor preserves project overview split contracts', async () => {
  /** Project overview 的生产入口必须依赖真实子模块，避免回退成单文件 UI。 */
  const panel = await readSource('frontend/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx');
  const runtime = await readSource('frontend/components/main-content/project-overview/ProjectOverviewPanelRuntime.impl.tsx');
  const requiredModules = [
    'frontend/components/main-content/project-overview/projectOverviewViewModel.ts',
    'frontend/components/main-content/project-overview/ProjectOverviewWorkflowGroups.tsx',
    'frontend/components/main-content/project-overview/ProjectOverviewSessionCards.tsx',
    'frontend/components/main-content/project-overview/ProjectOverviewActions.tsx',
  ];
  for (const modulePath of requiredModules) {
    await access(modulePath);
  }
  assert.ok(lineCount(panel) <= 700);
  assert.match(runtime, /ProjectOverviewWorkflowGroups/);
  assert.match(runtime, /ProjectOverviewSessionCards/);
  assert.match(runtime, /ProjectOverviewActions/);
  assert.doesNotMatch(panel, /const\s+(ChevronDown|ChevronRight|Clock|FolderOpen|MessageSquarePlus|Star|Trash2|X)\s*=/);
});

test('high-risk-module-refactor preserves chat runtime controller contracts', async () => {
  /** Chat hooks 保留兼容入口，但业务规则必须进入可单测 controller/runtime。 */
  const sessionHook = await readSource('frontend/components/chat/session/useChatSessionStateImpl.ts');
  const composerHook = await readSource('frontend/components/chat/composer/useChatComposerStateImpl.ts');
  const realtimeHook = await readSource('frontend/components/chat/hooks/useChatRealtimeHandlersImpl.ts');
  assert.ok(lineCount(sessionHook) <= 220);
  assert.ok(lineCount(composerHook) <= 220);
  assert.ok(lineCount(realtimeHook) <= 260);
  assert.match(sessionHook, /chatSessionLifecycleController/);
  assert.match(composerHook, /composerSubmitRuntime/);
  assert.match(realtimeHook, /chatRealtimeEventRouter|streamingMessageController/);
  await access('frontend/components/chat/session/chatSessionLifecycleController.ts');
  await access('frontend/components/chat/composer/composerSubmitRuntime.ts');
  await access('frontend/components/chat/realtime/chatRealtimeEventRouter.ts');
  await access('frontend/components/chat/realtime/streamingMessageController.ts');
  assert.doesNotMatch(realtimeHook, /function\s+reloadCodexSessionMessages/);
});

test('high-risk-module-refactor preserves backend boundary contracts', async () => {
  /** 后端 public entry 应是装配层，安全规则和分发规则保留在专门模块。 */
  const bootstrap = await readSource('backend/server/server-bootstrap.ts');
  const dispatcher = await readSource('backend/server/realtime/chat-command-dispatcher.ts');
  const fileRoutes = await readSource('backend/server/file-routes.ts');
  assert.ok(lineCount(bootstrap) <= 160);
  assert.ok(lineCount(dispatcher) <= 180);
  assert.ok(lineCount(fileRoutes) <= 180);
  assert.match(dispatcher, /chat-command-router|chat-command-runtime/);
  assert.match(fileRoutes, /file-routes-impl|file-routes-runtime/);
  await access('backend/server/realtime/chat-client-scope-store.ts');
  await access('backend/server/realtime/chat-command-router.ts');
  await access('backend/server/files/file-route-helpers.ts');
  await access('backend/server/files/file-tree-routes.ts');
  await access('backend/server/files/file-mutation-routes.ts');
  await access('backend/server/files/file-download-routes.ts');
  assert.doesNotMatch(bootstrap, /function\s+(classifyProjectFile|acceptChatRequestId|extractUrlsFromText)\b/);
});

test('high-risk-module-refactor keeps durable docs and default tests', async () => {
  /** 默认测试和规格文档必须跟随源码边界，避免只依赖归档 change tests。 */
  const doc = await readSource('docs/specs/high-risk-module-refactor.md');
  const requiredFiles = [
    'tests/unit/project-overview-view-model.test.ts',
    'tests/unit/chat-runtime-controllers.test.ts',
    'tests/backend/server-boundary-refactor.test.ts',
    'tests/specs/high-risk-module-refactor.spec.ts',
  ];
  for (const filePath of requiredFiles) {
    const source = await readSource(filePath);
    assert.match(source, /(ProjectOverview|chat|server|high-risk)/i);
  }
  assert.match(doc, /ProjectOverviewPanel/);
  assert.match(doc, /Chat session|chat/i);
  assert.match(doc, /Backend bootstrap|server-bootstrap/i);
  assert.match(doc, /验证命令/);
  assert.match(doc, /剩余风险/);
});

test('historical debt repayment keeps proposal 27 split as the latest boundary intent', async () => {
  /** 旧测试修复不能把 27 号已经拆出的高风险入口重新合并。 */
  const archivedSpec = await readSource('docs/changes/archive/2026-06-17-28-偿还历史测试与会话债务/spec.md');
  const archivedBrief = await readSource('docs/changes/archive/2026-06-17-28-偿还历史测试与会话债务/brief.md');
  const archivedTask = await readSource('docs/changes/archive/2026-06-17-28-偿还历史测试与会话债务/task.md');

  for (const source of [archivedSpec, archivedBrief, archivedTask]) {
    assert.match(source, /27.*重构高风险核心模块|27 号/);
  }
  assert.match(archivedBrief, /编号更大|最新.*意图|提案意图优先/);
  assert.match(archivedTask, /编号更大|最新.*意图|提案意图优先/);

  await access('docs/changes/archive/2026-06-17-27-重构高风险核心模块/tests/project-overview-refactor-contract.test.ts');
  await access('docs/changes/archive/2026-06-17-27-重构高风险核心模块/tests/chat-runtime-refactor-contract.test.ts');
  await access('docs/changes/archive/2026-06-17-27-重构高风险核心模块/tests/backend-boundary-refactor-contract.test.ts');
});
