/**
 * 文件目的：验证未加载 Codex 历史线程的活动状态分类不会被更早轮次误导。
 * 业务意义：只有明确空闲的历史线程可以安全迁入共享 daemon。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCodexThreadActivity } from '../../backend/domains/codex-app-server/shared-thread-probe.ts';

test('最后一轮完成时忽略更早未收敛轮次', () => {
  /** 历史脏状态不能让当前已完成会话永久无法恢复。 */
  const state = classifyCodexThreadActivity({
    status: { type: 'notLoaded' },
    turns: [
      { status: 'interrupted', completedAt: null },
      { status: 'completed', completedAt: 1780000000 },
    ],
  });
  assert.equal(state, 'idle');
});

test('最后一轮明确活动时判为 active', () => {
  /** 共享或私有运行时明确报告活动时不得迁移。 */
  assert.equal(classifyCodexThreadActivity({
    status: { type: 'notLoaded' },
    turns: [{ status: 'inProgress', completedAt: null }],
  }), 'active');
});

test('最后一轮被映射为未完成 interrupted 时保持 unknown', () => {
  /** 另一私有 app-server 的活动轮次可能被 daemon 映射成此形态，应保守阻止。 */
  assert.equal(classifyCodexThreadActivity({
    status: { type: 'notLoaded' },
    turns: [{ status: 'interrupted', completedAt: null }],
  }), 'unknown');
});

test('已加载线程的 active 状态优先于轮次快照', () => {
  /** loaded thread 的线程级状态是共享 daemon 的直接真值。 */
  assert.equal(classifyCodexThreadActivity({
    status: { type: 'active' },
    turns: [],
  }), 'active');
});
