/**
 * PURPOSE: 约束活跃文档、生产源码和测试资产继续使用当前 Provider 口径，
 * 并要求 manual/browser-history 历史测试资产有可复查处置清单。
 *
 * Sources: 2026-06-16-7-历史口径文档与测试资产收敛
 * Sources: 2026-06-17-28-偿还历史测试与会话债务
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
const ALLOWED_MANUAL_DISPOSITIONS = ['已迁移', '人工保留', '待删除', '待确认'] as const;

async function readRepoFile(relativePath: string): Promise<string> {
  /**
   * PURPOSE: 从仓库根读取真实源码和文档，避免规格测试只验证局部 fixture。
   */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

async function listFiles(relativeDir: string): Promise<string[]> {
  /**
   * PURPOSE: 递归列出真实仓库文件，让旧口径审计覆盖当前活跃目录。
   */
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

function allowsHistoricalWording(relativePath: string): boolean {
  /**
   * PURPOSE: 保留归档事实和本合同自身的旧字符串匹配规则，不把历史记录机械改写。
   */
  return relativePath.startsWith('docs/changes/archive/') ||
    relativePath.includes('historical-provider-wording-assets.spec.ts');
}

test('active docs and production source use current provider wording', async () => {
  /**
   * 业务场景：维护者搜索活跃文档和源码时，只应看到当前 Provider 运行边界。
   */
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
  /**
   * 业务场景：测试文件名、标题和 PURPOSE 必须帮助审阅者判断真实运行路径。
   */
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
    const misleadingPurposePattern = new RegExp(
      'PURPOSE:[^\\n]*' +
        '(Codex SDK|native SDKs)',
      'i',
    );
    if (codexAppServerMeaning && misleadingPurposePattern.test(source)) {
      offenders.push(`${file}#PURPOSE`);
    }
  }

  assert.deepEqual(offenders, [], `misleading app-server test names or PURPOSE text: ${offenders.join(', ')}`);
});

test('manual browser-history assets have an explicit disposition inventory', async () => {
  /**
   * 业务场景：历史 browser 资产不能无人负责地停留在 manual 目录。
   */
  assert.ok(EVIDENCE_CONTRACTS.some((entry) => entry.includes('manual-history-inventory')));
  const inventoryPath = 'docs/testing/manual-history-inventory.md';
  const inventory = await readRepoFile(inventoryPath);
  const browserHistoryDir = path.join(REPO_ROOT, 'tests/manual/browser-history');
  const exists = await stat(browserHistoryDir).then((entry) => entry.isDirectory()).catch(() => false);

  assert.ok(exists, 'tests/manual/browser-history directory must be audited before removing or migrating assets');
  const browserHistoryFiles = (await listFiles('tests/manual/browser-history')).filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'));
  assert.ok(browserHistoryFiles.length > 0, 'inventory contract expects existing browser-history assets to be classified');

  for (const file of browserHistoryFiles) {
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(inventory, new RegExp(escaped), `${file} must appear in the inventory`);
    assert.match(inventory, new RegExp(`${escaped}[\\s\\S]{0,160}(迁移|保留|删除|待确认)`), `${file} must have a disposition`);
  }

  const rows = parseManualInventoryRows(inventory);
  const invalid = rows.filter((row) => !ALLOWED_MANUAL_DISPOSITIONS.includes(row.disposition as typeof ALLOWED_MANUAL_DISPOSITIONS[number]));
  assert.deepEqual(invalid, [], `manual history disposition must use the durable enum: ${JSON.stringify(invalid)}`);

  const gateCandidates = rows.filter((row) => row.disposition === '默认门禁候选');
  assert.deepEqual(gateCandidates, [], 'manual browser-history must not leave default gate candidates after debt repayment');

  const weakManualRows = rows.filter((row) => {
    if (row.disposition !== '人工保留') return false;
    return !/当前业务价值|业务价值/.test(row.reason) ||
      !/前置|运行条件|环境/.test(row.reason) ||
      !/证据|evidence|trace|截图|log|test-results/.test(row.reason);
  });
  assert.deepEqual(weakManualRows, [], `manual retention rows need value, prerequisite, and evidence: ${JSON.stringify(weakManualRows)}`);
});

function parseManualInventoryRows(source: string): Array<{ file: string; disposition: string; reason: string }> {
  /**
   * PURPOSE: 解析真实处置清单，确保人工保留不是只有笼统状态。
   */
  return source.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('| `tests/manual/browser-history/'))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
      return {
        file: cells[0].replace(/^`|`$/g, ''),
        disposition: cells[1] ?? '',
        reason: cells[2] ?? '',
      };
    });
}

test('test documentation explains active spec/e2e/manual boundaries', async () => {
  /**
   * 业务场景：后续新增测试时，维护者应能从 README 判断该放入哪个测试入口。
   */
  const testsReadme = await readRepoFile('tests/README.md');
  const specReadme = await readRepoFile('tests/spec/README.md');
  const e2eReadme = await readRepoFile('tests/e2e/README.md');

  assert.match(testsReadme, /manual\/browser-history/);
  assert.match(testsReadme, /默认门禁|default gate|不作为默认/);
  assert.match(specReadme, /provider runtime|Codex app-server|Pi native SDK/i);
  assert.match(e2eReadme, /真实页面|真实 API|真实数据库/);
});
