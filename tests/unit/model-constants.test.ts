/**
 * 文件目的：用 Vitest 覆盖共享模型常量的低状态业务约束。
 * 业务场景：模型列表改为运行时发现后，静态常量不能重新暴露过期 provider 选项。
 * 失败含义：失败通常表示共享模型常量回退到陈旧静态目录，可能误导用户选择不可用模型。
 */
import { describe, expect, test } from 'vitest';

import { CODEX_MODELS } from '../../shared/modelConstants';

describe('shared model constants', () => {
  test('不再导出 Claude provider 静态入口', async () => {
    /**
     * docstring: Dynamic discovery must remain the only source for removed provider catalogs.
     */
    const mod = await import('../../shared/modelConstants');

    expect('CLAUDE_MODELS' in mod).toBe(false);
  });

  test('Codex 默认模型来自 CLI 发现而不是静态常量', () => {
    /**
     * docstring: Empty defaults prevent stale static choices from shadowing runtime discovery.
     */
    expect(CODEX_MODELS.DEFAULT).toBe('');
    expect(CODEX_MODELS.OPTIONS).toEqual([]);
  });
});
