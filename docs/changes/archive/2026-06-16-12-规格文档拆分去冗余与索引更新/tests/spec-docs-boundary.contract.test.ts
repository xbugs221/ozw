/**
 * PURPOSE: Contract test for proposal 12. It audits the real docs/specs tree
 * so long mixed-topic specs are split and the current documentation has a
 * searchable index tied to executable tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SPECS_DIR = path.join(REPO_ROOT, 'docs', 'specs');

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
 * Return all active markdown spec filenames.
 *
 * @returns Markdown filenames under docs/specs.
 */
async function listSpecMarkdownFiles(): Promise<string[]> {
  const entries = await readdir(SPECS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
}

test('docs/specs has an index with domains, test entries, and source owners', async () => {
  const indexPath = path.join(REPO_ROOT, 'docs/specs/index.md');
  assert.equal(existsSync(indexPath), true, 'docs/specs/index.md must exist');
  const index = await readRepoFile('docs/specs/index.md');

  for (const term of ['项目', 'Provider', 'Workflow', '聊天', 'runtime', '测试', '安全']) {
    assert.match(index, new RegExp(term, 'i'), `spec index must include domain ${term}`);
  }
  assert.match(index, /pnpm exec|pnpm run/, 'spec index must include executable test commands');
  assert.match(index, /backend\/|frontend\/|tests\//, 'spec index must list source or test owners');
});

test('active specs stay below the reviewable length limit', async () => {
  const specFiles = await listSpecMarkdownFiles();
  const overLimit: Array<{ file: string; lines: number }> = [];

  for (const file of specFiles) {
    const source = await readRepoFile(`docs/specs/${file}`);
    const lines = source.split(/\r?\n/).length;
    if (lines > 450) {
      overLimit.push({ file, lines });
    }
  }

  assert.deepEqual(overLimit, [], `active specs over 450 lines: ${overLimit.map((item) => `${item.file}:${item.lines}`).join(', ')}`);
});

test('mixed long specs are split into focused documents', async () => {
  const expectedSplitDocs = [
    'repo-simplification.md',
    'typescript-tooling.md',
    'runtime-dependencies.md',
    'provider-indexing.md',
    'chat-performance.md',
    'workflow-compatibility.md',
    'pi-session-controls.md',
    'pi-session-recovery.md',
    'pi-tool-card-rendering.md',
  ];

  for (const file of expectedSplitDocs) {
    const relativePath = `docs/specs/${file}`;
    assert.equal(existsSync(path.join(REPO_ROOT, relativePath)), true, `${relativePath} must exist after spec split`);
    const source = await readRepoFile(relativePath);
    assert.match(source, /### 需求：|## 需求：/, `${relativePath} must keep requirement headings`);
    assert.match(source, /测试|入口路径|pnpm/, `${relativePath} must keep test traceability`);
  }
});

test('current active docs do not describe old provider paths as the main path', async () => {
  const specFiles = await listSpecMarkdownFiles();
  const violations: string[] = [];
  const stalePatterns = [
    /Codex[^。\n]*Thread\/runStreamed/i,
    /Codex[^。\n]*@openai\/codex-sdk/i,
    /Codex[^。\n]*native-sdk/i,
  ];

  for (const file of specFiles) {
    const source = await readRepoFile(`docs/specs/${file}`);
    if (/legacy|history|historical|compat|历史|兼容/i.test(file)) {
      continue;
    }
    for (const pattern of stalePatterns) {
      if (pattern.test(source)) {
        violations.push(`${file}:${pattern.source}`);
      }
    }
  }

  assert.deepEqual(violations, [], `active current specs still contain stale provider path wording: ${violations.join(', ')}`);
});

test('README and taxonomy continue to point at real test entry files', async () => {
  const testsReadme = await readRepoFile('tests/README.md');
  const taxonomy = await readRepoFile('tests/spec/test_suite_taxonomy.ts');
  const docsReadme = await readRepoFile('docs/changes/README.md');

  assert.match(testsReadme, /tests\/backend|tests\/spec|tests\/e2e|tests\/manual/, 'tests README must describe current test categories');
  assert.match(taxonomy, /test_suite_taxonomy|tests\/README\.md/, 'taxonomy test must still validate README guidance');
  assert.match(docsReadme, /active change proposals|docs\/specs|tests\//i, 'docs changes README must explain active proposals and durable specs');
});
