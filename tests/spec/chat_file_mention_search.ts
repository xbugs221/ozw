/**
 * PURPOSE: Business regression for chat composer file references in large projects.
 * Users must be able to search a deep file path instead of scrolling through a long flat list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterMentionableFiles } from '../../frontend/components/chat/utils/fileMentionSearch.ts';

test('引用文件搜索能从大量项目文件中模糊定位深层业务文件', () => {
  const fillerFiles = Array.from({ length: 120 }, (_, index) => ({
    name: `noise-${index}.ts`,
    path: `packages/noise-${index}.ts`,
  }));
  const businessFile = {
    name: 'OrderSettlementPolicy.ts',
    path: 'services/billing/rules/OrderSettlementPolicy.ts',
  };

  const files = [...fillerFiles, businessFile];
  const results = filterMentionableFiles(files, 'set pol');

  assert.equal(results[0]?.path, businessFile.path);
  assert.equal(filterMentionableFiles(files, 'billing policy')[0]?.path, businessFile.path);
  assert.ok(
    results.length < fillerFiles.length,
    '搜索结果应该收敛到可选择范围，而不是继续要求用户滚动完整文件列表',
  );
});

test('引用文件默认列表限制结果数量，避免大仓库一次渲染过多行', () => {
  const files = Array.from({ length: 120 }, (_, index) => ({
    name: `file-${index}.ts`,
    path: `src/generated/file-${index}.ts`,
  }));

  assert.equal(filterMentionableFiles(files, '').length, 80);
});
