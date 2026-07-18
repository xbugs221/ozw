/**
 * PURPOSE: Verify startup provider-index backfill cannot starve one provider
 * when another provider owns more transcript files than the global limit.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { selectProviderBackfillFiles } from '../../backend/domains/projects/project-index-backfill-selection.ts';

test('启动回填在三类 Provider 之间公平分配全局文件上限', () => {
  /** Keep the newest files from all providers inside the same total cap. */
  const selected = selectProviderBackfillFiles(
    ['codex-1.jsonl', 'codex-2.jsonl', 'codex-3.jsonl', 'codex-4.jsonl'],
    ['pi-1.jsonl', 'pi-2.jsonl', 'pi-3.jsonl', 'pi-4.jsonl'],
    ['claude-1.jsonl', 'claude-2.jsonl', 'claude-3.jsonl', 'claude-4.jsonl'],
    4,
  );

  assert.deepEqual(selected, [
    { provider: 'codex', filePath: 'codex-4.jsonl' },
    { provider: 'pi', filePath: 'pi-4.jsonl' },
    { provider: 'claude', filePath: 'claude-4.jsonl' },
    { provider: 'codex', filePath: 'codex-3.jsonl' },
  ]);
});

test('单侧文件不足时把剩余额度让给另一 Provider', () => {
  /** Preserve the global cap while still filling it when one provider is small. */
  const selected = selectProviderBackfillFiles(
    ['codex-only.jsonl'],
    ['pi-1.jsonl', 'pi-2.jsonl', 'pi-3.jsonl', 'pi-4.jsonl', 'pi-5.jsonl'],
    [],
    4,
  );

  assert.deepEqual(selected, [
    { provider: 'codex', filePath: 'codex-only.jsonl' },
    { provider: 'pi', filePath: 'pi-5.jsonl' },
    { provider: 'pi', filePath: 'pi-4.jsonl' },
    { provider: 'pi', filePath: 'pi-3.jsonl' },
  ]);
});

test('Codex 和 Pi 达到上限时仍会回填已有 Claude 会话', () => {
  /** Reserve a fair turn for Claude before any large provider exhausts the startup budget. */
  const selected = selectProviderBackfillFiles(
    Array.from({ length: 2_000 }, (_, index) => `codex-${index}.jsonl`),
    Array.from({ length: 2_000 }, (_, index) => `pi-${index}.jsonl`),
    ['claude-existing.jsonl'],
    2_000,
  );

  assert.deepEqual(selected.find((item) => item.provider === 'claude'), {
    provider: 'claude',
    filePath: 'claude-existing.jsonl',
  });
});
