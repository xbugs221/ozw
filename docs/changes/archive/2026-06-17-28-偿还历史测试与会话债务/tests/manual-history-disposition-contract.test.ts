/**
 * 文件目的：约束 manual/browser-history 历史资产必须被明确迁移、保留或删除。
 * 业务风险：大量历史浏览器回归只写“人工保留”会让默认门禁误以为风险已经覆盖。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const INVENTORY_PATH = 'docs/testing/manual-history-inventory.md';
const SNAPSHOT_PATH = path.join(REPO_ROOT, 'test-results/historical-debt/manual-history-disposition.json');
const ALLOWED_DISPOSITIONS = ['已迁移', '默认门禁候选', '人工保留', '待删除'] as const;

type InventoryRow = {
  file: string;
  disposition: string;
  reason: string;
};

test('manual browser-history assets have actionable disposition instead of vague retention', async () => {
  /**
   * 业务场景：审阅者必须能判断每个历史浏览器资产是已进默认门禁、仍需人工运行，还是应删除。
   */
  const inventory = await readRepoFile(INVENTORY_PATH);
  const rows = parseInventoryRows(inventory);
  const browserHistoryFiles = (await collectFiles('tests/manual/browser-history'))
    .filter((file) => /\.(ts|tsx)$/.test(file));
  const rowByFile = new Map(rows.map((row) => [row.file, row]));

  const missing = browserHistoryFiles.filter((file) => !rowByFile.has(file));
  assert.deepEqual(missing, [], `manual browser-history 文件必须全部进入处置清单: ${missing.join(', ')}`);

  const invalid = rows.filter((row) => !ALLOWED_DISPOSITIONS.includes(row.disposition as typeof ALLOWED_DISPOSITIONS[number]));
  assert.deepEqual(invalid, [], `处置状态只能使用固定枚举: ${JSON.stringify(invalid)}`);

  const defaultGateCandidates = rows.filter((row) => row.disposition === '默认门禁候选');
  assert.deepEqual(
    defaultGateCandidates,
    [],
    '执行完成后不得残留默认门禁候选；应迁入 tests/spec 或 tests/e2e，或解释为人工保留',
  );

  const weakManualRows = rows.filter((row) => {
    if (row.disposition !== '人工保留') return false;
    return !/当前业务价值|业务价值/.test(row.reason) ||
      !/前置|运行条件|环境/.test(row.reason) ||
      !/证据|evidence|trace|截图|log|test-results/.test(row.reason);
  });
  assert.deepEqual(
    weakManualRows,
    [],
    `人工保留项必须说明当前业务价值、运行前置条件和证据路径: ${JSON.stringify(weakManualRows)}`,
  );

  await mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  await writeFile(SNAPSHOT_PATH, `${JSON.stringify({ rows }, null, 2)}\n`, 'utf8');
});

function parseInventoryRows(source: string): InventoryRow[] {
  /**
   * 从 markdown 表格解析真实处置行，避免只检查文件是否存在。
   */
  return source.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('| `tests/manual/browser-history/'))
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
      return {
        file: cells[0].replace(/^`|`$/g, ''),
        disposition: cells[1],
        reason: cells[2] ?? '',
      };
    });
}

async function readRepoFile(relativePath: string): Promise<string> {
  /**
   * 读取仓库真实文档，确保执行器必须更新可审阅清单。
   */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

async function collectFiles(relativeDir: string): Promise<string[]> {
  /**
   * 收集当前 manual 历史资产，防止新增文件没有处置说明。
   */
  const absoluteDir = path.join(REPO_ROOT, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) return collectFiles(relativePath);
    return [relativePath];
  }));
  return nested.flat().sort();
}
