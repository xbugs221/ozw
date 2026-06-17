/**
 * 文件目的：锁定 Pi queue、session identity 和工具卡配置的低状态业务行为。
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  buildPiQueueState,
  isPiQueueForActiveSession,
} from '../../frontend/components/chat/utils/piQueueState';
import {
  buildWorkflowNavigationOptions,
  isMessageForSelectedProject,
} from '../../frontend/components/chat/session/sessionIdentity';
import {
  getExecResultContent,
  getToolConfig,
  shouldHideToolResult,
} from '../../frontend/components/chat/tools/configs/toolConfigRegistry';

test('Pi queue state belongs to the visible route session, not only provider session id', () => {
  /**
   * Pi SDK 事件里的 provider session id 不能替代 ozw cN route identity，否则会显示到错误聊天页。
   */
  const state = buildPiQueueState({
    sessionId: 'provider-thread-9',
    ozwSessionId: 'c7',
    steering: ['steer A', 42, 'steer B'],
    followUp: ['follow A', null],
  });

  assert.deepEqual(state, {
    sessionId: 'c7',
    providerSessionId: 'provider-thread-9',
    steering: ['steer A', 'steer B'],
    followUp: ['follow A'],
  });
  assert.equal(isPiQueueForActiveSession(state, 'c7', null), true);
  assert.equal(isPiQueueForActiveSession(state, 'c8', 'c7'), false);
  assert.equal(buildPiQueueState({ steering: ['orphan'] }), null);
});

test('tool configs preserve fallback, hidden result, and executable output content', () => {
  /**
   * 工具卡注册表必须保留 fallback 命名、Bash 结果隐藏和 exec 输出去 envelope 语义。
   */
  const fallback = getToolConfig('unknown_tool');
  assert.equal(fallback.input.type, 'collapsible');
  assert.equal(fallback.input.title, 'Parameters');
  assert.equal(shouldHideToolResult('Bash', { output: 'hidden' }), true);
  assert.equal(shouldHideToolResult('Read', { output: 'hidden in compact file card' }), true);

  const contextBatch = getToolConfig('mcp__plugin_context-mode_context-mode__ctx_batch_execute');
  assert.equal(contextBatch.input.contentType, 'batch-execute');

  const content = getExecResultContent({
    output: [
      'Chunk ID: abc',
      'Wall time: 0.0000 seconds',
      'Output:',
      'actual command output',
    ].join('\n'),
  });
  assert.equal(content, 'actual command output');
});

test('session routing helpers keep workflow and project-scoped messages isolated', () => {
  /**
   * workflow child session 发起后续操作时，必须携带 workflow 路由上下文并按项目隔离 realtime 消息。
   */
  const project = { name: 'demo', fullPath: '/work/demo', path: '/work/demo' };
  const session = {
    id: 'workflow-review',
    __provider: 'pi',
    __projectName: 'demo',
    projectPath: '/work/demo',
    workflowId: 'run-1',
    stageKey: 'review_1',
  };

  assert.deepEqual(buildWorkflowNavigationOptions(project as any, session as any, 'codex'), {
    provider: 'pi',
    projectName: 'demo',
    projectPath: '/work/demo',
    workflowId: 'run-1',
    workflowStageKey: 'review_1',
  });
  assert.equal(isMessageForSelectedProject({ projectPath: '/work/demo' }, project as any, session as any), true);
  assert.equal(isMessageForSelectedProject({ projectPath: '/work/other' }, project as any, session as any), false);
});
