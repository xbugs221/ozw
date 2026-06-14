/**
 * PURPOSE: Register the oz change acceptance tests with the regular browser
 * spec suite by verifying the Playwright test file exists and contains the
 * expected test structure.  The actual browser tests execute through Playwright
 * and are tracked separately.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

function readRepoFile(relPath: string) {
  return fs.readFileSync(path.resolve(REPO_ROOT, relPath), 'utf8');
}

test('workflow presentation acceptance tests exist and cover multi-round display', async () => {
  const source = readRepoFile(
    'tests/manual/browser-history/workflow-presentation.spec.ts',
  );
  assert.match(source, /test\.describe\('多轮工作流呈现'/, 'must define the multi-round presentation test suite');
  assert.match(source, /项目卡片聚合审核和修复轮次/, 'must cover card-level review/repair round aggregation');
  assert.match(source, /详情角色行显示短会话链接/, 'must cover detail role-row session links');
  assert.match(source, /writeMultiRoundWorkflowFixture/, 'must seed a multi-round wo fixture');
});
