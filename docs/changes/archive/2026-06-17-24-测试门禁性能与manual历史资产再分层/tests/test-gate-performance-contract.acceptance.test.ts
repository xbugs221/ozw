/**
 * 文件目的：验证测试质量门耗时 profile 和 manual 历史资产处置合同。
 * 业务场景：测试优化必须可度量、可复查，不能通过把当前业务风险留在 manual 目录来削弱默认门禁。
 */
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_PATH = path.join(REPO_ROOT, 'test-results/24-test-gate-performance/source-audit.json');
const MANUAL_AUDIT_PATH = path.join(REPO_ROOT, 'test-results/24-test-gate-performance/manual-history-inventory.json');
const STANDARD_STATUSES = ['人工保留', '已迁移', '默认门禁候选', '待删除'];

/**
 * Read a repository file for contract assertions.
 */
async function readRepoFile(relativePath: string): Promise<string> {
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

/**
 * List current manual browser-history specs that need inventory status.
 */
async function listManualBrowserSpecs(): Promise<string[]> {
  const dir = path.join(REPO_ROOT, 'tests/manual/browser-history');
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.spec.ts'))
    .map((entry) => `tests/manual/browser-history/${entry.name}`)
    .sort();
}

/**
 * Extract standardized inventory status for one manual browser-history file.
 */
function extractInventoryStatus(inventory: string, relativePath: string): string | null {
  const escapedPath = relativePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = inventory.split(/\r?\n/).find((line) => new RegExp(`\\|\\s*\\\`${escapedPath}\\\``).test(line));
  if (!row) return null;
  return STANDARD_STATUSES.find((status) => row.includes(`| ${status} |`) || row.includes(`| \`${status}\` |`)) || null;
}

/**
 * Persist source audit and inventory evidence for reviewers.
 */
async function writeEvidence(sourceSnapshot: unknown, manualSnapshot: unknown): Promise<void> {
  await mkdir(path.dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(EVIDENCE_PATH, `${JSON.stringify(sourceSnapshot, null, 2)}\n`, 'utf8');
  await writeFile(MANUAL_AUDIT_PATH, `${JSON.stringify(manualSnapshot, null, 2)}\n`, 'utf8');
}

test('test timing profiles and manual inventory are measurable contracts', async () => {
  const packageJson = JSON.parse(await readRepoFile('package.json')) as { scripts?: Record<string, string> };
  const collectTimingSource = await readRepoFile('scripts/collect-test-timings.ts');
  const testingPerformanceDocs = await readRepoFile('docs/testing-performance.md');
  const inventory = await readRepoFile('docs/testing/manual-history-inventory.md');
  const manualSpecs = await listManualBrowserSpecs();
  const inventoryStatuses = Object.fromEntries(
    manualSpecs.map((relativePath) => [relativePath, extractInventoryStatus(inventory, relativePath)]),
  );
  const missingInventory = Object.entries(inventoryStatuses)
    .filter(([, status]) => !status)
    .map(([relativePath]) => relativePath);
  const sourceSnapshot = {
    scripts: packageJson.scripts || {},
    supportsTimingProfileEnv: /CBW_TEST_TIMING_PROFILE/.test(collectTimingSource),
    writesProfileOutput: /test-performance\/.*profile|profile.*test-performance|<profile>|\\$\{profile\}/.test(collectTimingSource),
    docsMentionProfiles: /qa:test:timing:fast|fast\/smoke\/full|profile/i.test(testingPerformanceDocs),
    pnpmTestScript: packageJson.scripts?.test || '',
  };
  const manualSnapshot = {
    manualSpecs,
    inventoryStatuses,
    missingInventory,
    standardStatuses: STANDARD_STATUSES,
  };

  await writeEvidence(sourceSnapshot, manualSnapshot);

  for (const scriptName of ['qa:test:timing:fast', 'qa:test:timing:smoke', 'qa:test:timing:full']) {
    assert.ok(packageJson.scripts?.[scriptName], `package.json 必须提供 ${scriptName}`);
  }
  assert.equal(sourceSnapshot.supportsTimingProfileEnv, true, 'collect-test-timings.ts 必须支持 CBW_TEST_TIMING_PROFILE');
  assert.equal(sourceSnapshot.writesProfileOutput, true, 'collect-test-timings.ts 必须按 profile 写入 test-results/test-performance/<profile>.json');
  assert.equal(sourceSnapshot.docsMentionProfiles, true, '测试性能文档必须说明 timing profiles');
  assert.match(sourceSnapshot.pnpmTestScript, /test:full/, 'pnpm test 必须继续委托完整 test:full 门禁');
  assert.deepEqual(missingInventory, [], '每个 manual browser-history spec 必须在 inventory 中有标准化状态');
  assert.ok(
    Object.values(inventoryStatuses).every((status) => status && STANDARD_STATUSES.includes(status)),
    'manual inventory 状态必须属于标准枚举',
  );
});
