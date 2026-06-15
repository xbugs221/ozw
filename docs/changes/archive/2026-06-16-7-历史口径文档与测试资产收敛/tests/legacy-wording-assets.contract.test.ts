/**
 * PURPOSE: Contract tests for proposal 7. They prevent current documentation,
 * production source, and active tests from drifting back to retired co/Codex SDK
 * wording while allowing archived historical records to remain intact.
 */
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_CONTRACTS = [
  'legacy-wording-audit -> test-results/legacy-wording/source-audit.json',
  'test-asset-audit -> test-results/legacy-wording/test-asset-audit.json',
  'manual-history-inventory -> test-results/legacy-wording/manual-history-inventory.json',
];

/**
 * Read a repository file as UTF-8 text.
 *
 * @param relativePath Path relative to the repository root.
 * @returns File contents.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * Recursively list files under a repository directory.
 *
 * @param relativeDir Directory relative to the repository root.
 * @returns Relative file paths.
 */
async function listFiles(relativeDir: string): Promise<string[]> {
  const absoluteDir = path.join(REPO_ROOT, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      return listFiles(relativePath);
    }
    return [relativePath];
  }));
  return nested.flat();
}

/**
 * Return true when a path is allowed to contain historical wording.
 *
 * @param relativePath Repository relative file path.
 * @returns Whether legacy wording is allowed.
 */
function allowsHistoricalWording(relativePath: string): boolean {
  return relativePath.startsWith('docs/changes/archive/') ||
    relativePath.includes('7-历史口径文档与测试资产收敛') ||
    relativePath.includes('legacy-wording-assets.contract.test.ts');
}

test('active docs and production source use current provider wording', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('legacy-wording-audit')));
  const files = [
    ...(await listFiles('backend')).filter((file) => file.endsWith('.ts')),
    ...(await listFiles('frontend')).filter((file) => file.endsWith('.ts') || file.endsWith('.tsx')),
    ...(await listFiles('docs/specs')).filter((file) => file.endsWith('.md')),
    'package.json',
  ];
  const offenders: string[] = [];

  for (const file of files) {
    if (allowsHistoricalWording(file)) continue;
    const source = await readRepoFile(file);
    if (/Codex SDK Thread|Thread\.runStreamed|Codex 手动消息直接进入 Codex SDK|co file protocol current path/i.test(source)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, [], `active docs/source still contain retired provider wording: ${offenders.join(', ')}`);
});

test('Codex app-server tests no longer use misleading native-sdk filenames', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('test-asset-audit')));
  const testFiles = (await listFiles('tests'))
    .filter((file) => /\.(test|spec)\.(ts|tsx)$/.test(file))
    .filter((file) => !allowsHistoricalWording(file));
  const offenders: string[] = [];

  for (const file of testFiles) {
    const source = await readRepoFile(file);
    const codexAppServerMeaning = /Codex app-server|sendCodexAppServerMessage|codex app-server/i.test(source);
    if (codexAppServerMeaning && /native-sdk|Codex SDK/i.test(path.basename(file))) {
      offenders.push(file);
    }
    if (codexAppServerMeaning && /PURPOSE:[^\n]*(Codex SDK|native SDKs)/i.test(source)) {
      offenders.push(`${file}#PURPOSE`);
    }
  }

  assert.deepEqual(offenders, [], `misleading app-server test names or PURPOSE text: ${offenders.join(', ')}`);
});

test('manual browser-history assets have an explicit disposition inventory', async () => {
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('manual-history-inventory')));
  const inventoryPath = 'docs/testing/manual-history-inventory.md';
  const inventory = await readRepoFile(inventoryPath);
  const browserHistoryDir = path.join(REPO_ROOT, 'tests/manual/browser-history');
  const exists = await stat(browserHistoryDir).then((entry) => entry.isDirectory()).catch(() => false);

  assert.ok(exists, 'tests/manual/browser-history directory must be audited before removing or migrating assets');
  const browserHistoryFiles = (await listFiles('tests/manual/browser-history')).filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'));
  assert.ok(browserHistoryFiles.length > 0, 'inventory contract expects existing browser-history assets to be classified');

  for (const file of browserHistoryFiles) {
    assert.match(inventory, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${file} must appear in the inventory`);
    assert.match(inventory, new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]{0,160}(迁移|保留|删除|待确认)`), `${file} must have a disposition`);
  }
});

test('test documentation explains active spec/e2e/manual boundaries', async () => {
  const testsReadme = await readRepoFile('tests/README.md');
  const specReadme = await readRepoFile('tests/spec/README.md');
  const e2eReadme = await readRepoFile('tests/e2e/README.md');

  assert.match(testsReadme, /manual\/browser-history/);
  assert.match(testsReadme, /默认门禁|default gate|不作为默认/);
  assert.match(specReadme, /provider runtime|Codex app-server|Pi native SDK/i);
  assert.match(e2eReadme, /真实页面|真实 API|真实数据库/);
});
