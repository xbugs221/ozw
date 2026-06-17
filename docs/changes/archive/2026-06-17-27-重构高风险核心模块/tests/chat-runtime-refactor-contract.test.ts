/**
 * 文件目的：锁定聊天核心 hook 的重构目标。
 * 业务风险：session 加载、提交、实时事件和 streaming 合并若继续集中在长 hook 中，用户消息可能重复、错路由或丢失。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = process.cwd();

const HOOK_BUDGETS = [
  { path: 'frontend/components/chat/session/useChatSessionStateImpl.ts', maxLines: 850 },
  { path: 'frontend/components/chat/composer/useChatComposerStateImpl.ts', maxLines: 850 },
  { path: 'frontend/components/chat/hooks/useChatRealtimeHandlersImpl.ts', maxLines: 800 },
] as const;

const REQUIRED_CONTROLLERS = [
  {
    path: 'frontend/components/chat/session/chatSessionLifecycleController.ts',
    exports: ['buildSessionLoadPlan', 'applySessionLoadResult', 'buildVisibleMessageWindow'],
  },
  {
    path: 'frontend/components/chat/composer/composerSubmitRuntime.ts',
    exports: ['buildSubmitRequest', 'resolveSubmitDisabledReason', 'createPendingUserMessage'],
  },
  {
    path: 'frontend/components/chat/realtime/chatRealtimeEventRouter.ts',
    exports: ['routeChatRealtimeEvent', 'applyRealtimeSessionEvent'],
  },
  {
    path: 'frontend/components/chat/realtime/streamingMessageController.ts',
    exports: ['appendStreamingChunk', 'finalizeStreamingMessage'],
  },
] as const;

async function readRepoFile(relativePath: string): Promise<string> {
  /**
   * 读取真实聊天源码，验证重构后的职责归属。
   */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

function lineCount(source: string): number {
  /**
   * 统计 hook 文件行数，防止重构后继续把业务规则堆回 hook。
   */
  return source.split(/\r?\n/).length;
}

test('P0 chat hooks delegate lifecycle, submit, realtime, and streaming rules to controllers', async () => {
  for (const budget of HOOK_BUDGETS) {
    const source = await readRepoFile(budget.path);
    assert.ok(lineCount(source) <= budget.maxLines, `${budget.path} 必须不超过 ${budget.maxLines} 行，当前 ${lineCount(source)} 行`);
  }

  const combinedHookSource = await Promise.all(HOOK_BUDGETS.map((budget) => readRepoFile(budget.path))).then((parts) => parts.join('\n'));
  for (const controller of REQUIRED_CONTROLLERS) {
    assert.equal(existsSync(path.join(REPO_ROOT, controller.path)), true, `${controller.path} 必须存在`);
    const source = await readRepoFile(controller.path);
    assert.match(source, /PURPOSE|目的|session|composer|realtime|stream/i, `${controller.path} 必须说明业务目的`);
    for (const exportName of controller.exports) {
      assert.match(source, new RegExp(`export\\s+(function|const)\\s+${exportName}\\b`), `${controller.path} 必须导出 ${exportName}`);
      assert.match(combinedHookSource, new RegExp(`\\b${exportName}\\b`), `chat hooks 必须组合使用 ${exportName}`);
    }
  }

  const realtimeSource = await readRepoFile('frontend/components/chat/hooks/useChatRealtimeHandlersImpl.ts');
  assert.doesNotMatch(realtimeSource, /const\s+appendStreamingChunk\s*=/, 'appendStreamingChunk 必须迁入 streamingMessageController');
  assert.doesNotMatch(realtimeSource, /const\s+finalizeStreamingMessage\s*=/, 'finalizeStreamingMessage 必须迁入 streamingMessageController');
  assert.doesNotMatch(realtimeSource, /const\s+reloadCodexSessionMessages\s*=/, 'reloadCodexSessionMessages 必须迁出 realtime hook');
});
