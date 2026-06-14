/**
 * 文件目的：用 Vitest 覆盖聊天运行状态动词池的低状态业务约束。
 * 业务场景：长运行会话的状态行需要从足够大的本地动词池随机展示单词，不能退回三个短语循环。
 * 失败含义：失败通常表示运行状态行重新变得单调，或随机选择会连续显示同一个词。
 */
import { describe, expect, test, vi } from 'vitest';

import {
  pickRandomRunningVerb,
  RUNNING_STATUS_VERBS,
  RUNNING_VERB_INTERVAL_MS,
} from '../../frontend/components/chat/constants/runningVerbs';

describe('chat running status verbs', () => {
  test('本地词表提供足够多的单个动词并按 5 秒替换', () => {
    /**
     * docstring: A long-running turn should feel alive without fetching words at runtime.
     */
    expect(RUNNING_STATUS_VERBS.length).toBeGreaterThanOrEqual(60);
    expect(RUNNING_VERB_INTERVAL_MS).toBe(5000);
    expect(RUNNING_STATUS_VERBS).not.toEqual(['Thinking', 'Reading context', 'Working']);

    for (const verb of RUNNING_STATUS_VERBS) {
      expect(verb).toMatch(/^[A-Z][a-z]+$/);
    }
  });

  test('随机选择避免连续重复当前动词', () => {
    /**
     * docstring: The visible status word should change on refresh when the pool allows it.
     */
    const currentVerb = RUNNING_STATUS_VERBS[0];
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    try {
      expect(pickRandomRunningVerb(currentVerb)).not.toBe(currentVerb);
    } finally {
      randomSpy.mockRestore();
    }
  });
});
