/**
 * PURPOSE: Verify Codex realtime event normalization preserves stable command ids
 * so the frontend can merge repeated lifecycle updates into one tool message.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { __transformCodexEventForTest } from '../../backend/openai-codex.ts';

type CodexEventResult = {
  itemType?: string;
  itemId?: string;
  lifecycle?: string;
  output?: string;
  exitCode?: number;
  message?: {
    content?: string;
    phase?: string;
  };
};

/**
 * Narrow Codex event normalization output for assertions in this test file.
 */
function transformCodexEventForAssertion(event: unknown): CodexEventResult {
  return __transformCodexEventForTest(event) as CodexEventResult;
}

test('command_execution events expose a stable itemId across lifecycle updates', () => {
  const started = transformCodexEventForAssertion({
    type: 'item.started',
    item: {
      id: 'cmd_123',
      type: 'command_execution',
      command: 'git status',
      status: 'in_progress',
    },
  });

  const completed = transformCodexEventForAssertion({
    type: 'item.completed',
    item: {
      id: 'cmd_123',
      type: 'command_execution',
      command: 'git status',
      aggregated_output: 'On branch main',
      exit_code: 0,
      status: 'completed',
    },
  });

  assert.equal(started.itemType, 'command_execution');
  assert.equal(started.itemId, 'cmd_123');
  assert.equal(started.lifecycle, 'item.started');

  assert.equal(completed.itemType, 'command_execution');
  assert.equal(completed.itemId, 'cmd_123');
  assert.equal(completed.lifecycle, 'item.completed');
  assert.equal(completed.output, 'On branch main');
  assert.equal(completed.exitCode, 0);
});

test('agent_message events preserve phase metadata for commentary-aware rendering', () => {
  const commentary = transformCodexEventForAssertion({
    type: 'item.completed',
    item: {
      type: 'agent_message',
      text: '正在继续排查',
      phase: 'commentary',
    },
  });

  assert.equal(commentary.itemType, 'agent_message');
  assert.equal(commentary.message?.content, '正在继续排查');
  assert.equal(commentary.message?.phase, 'commentary');
});
