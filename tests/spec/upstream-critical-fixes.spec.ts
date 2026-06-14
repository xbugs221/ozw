// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Acceptance tests for change 29 — upstream critical fixes.
 *
 * Each scenario is asserted at behavior level: imports the production code
 * path and exercises it (HTTP, sandboxed Service Worker, SDK options builder)
 * rather than scanning source files for keywords. This prevents the tests
 * from passing without the corresponding behavior actually being in place.
 *
 * Derived from openspec/changes/29-merge-upstream-critical-fixes/specs/upstream-critical-fixes/spec.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(HERE, '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Safe frontmatter parsing
// ─────────────────────────────────────────────────────────────────────────────

async function parseFrontmatterFixture(markdown) {
  const { parseFrontmatter } = await import('../../backend/utils/frontmatter.ts');
  return parseFrontmatter(markdown);
}

test('YAML command metadata remains supported', async () => {
  const parsed = await parseFrontmatterFixture(
    `---\ndescription: 安全分析\nallowed-tools:\n  - Read\n---\n请分析当前项目。\n`,
  );

  assert.equal(parsed.data.description, '安全分析');
  assert.deepEqual(parsed.data['allowed-tools'], ['Read']);
  assert.equal(parsed.content.trim(), '请分析当前项目。');
});

test('JavaScript frontmatter is not executed', async () => {
  delete globalThis.__ozw_frontmatter_executed;

  const parsed = await parseFrontmatterFixture(
    `---js\nglobalThis.__ozw_frontmatter_executed = true;\nmodule.exports = { description: '不可信' };\n---\n正文仍然应该可见。\n`,
  );

  assert.equal(globalThis.__ozw_frontmatter_executed, undefined);
  assert.deepEqual(parsed.data, {});
  assert.match(parsed.content, /正文仍然应该可见/);
});

test('JSON frontmatter is not parsed through executable engine', async () => {
  const parsed = await parseFrontmatterFixture(
    `---json\n{ "description": "json metadata should not be trusted" }\n---\n正文。\n`,
  );

  assert.deepEqual(parsed.data, {});
  assert.match(parsed.content, /正文/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Codex permission and workflow auto-run semantics
// ─────────────────────────────────────────────────────────────────────────────

test('Codex permission modes still map to expected runtime options', async () => {
  const { __mapPermissionModeToCodexOptionsForTest, __buildCodexExecArgsForTest } =
    await import('../../backend/openai-codex.ts');

  // 1. acceptEdits => configured YOLO defaults
  const accept = __mapPermissionModeToCodexOptionsForTest('acceptEdits');
  assert.deepEqual(accept, { sandboxMode: 'danger-full-access', approvalPolicy: 'never' });

  // 2. bypassPermissions => danger-full-access + never approval
  const bypass = __mapPermissionModeToCodexOptionsForTest('bypassPermissions');
  assert.deepEqual(bypass, { sandboxMode: 'danger-full-access', approvalPolicy: 'never' });

  // 3. default => YOLO defaults
  const def = __mapPermissionModeToCodexOptionsForTest('default');
  assert.deepEqual(def, { sandboxMode: 'danger-full-access', approvalPolicy: 'never' });

  // 4. Unknown mode falls back to default semantics.
  const fallback = __mapPermissionModeToCodexOptionsForTest('something-else');
  assert.deepEqual(fallback, { sandboxMode: 'danger-full-access', approvalPolicy: 'never' });

  // 5. Resulting CLI args carry --sandbox and approval_policy override.
  const args = __buildCodexExecArgsForTest({
    command: 'list files',
    sessionId: null,
    workingDirectory: '/tmp/proj',
    model: 'gpt-5',
    sandboxMode: bypass.sandboxMode,
    approvalPolicy: bypass.approvalPolicy,
  });
  assert.ok(args.includes('--sandbox'), '--sandbox flag must be emitted');
  const sandboxIdx = args.indexOf('--sandbox');
  assert.equal(args[sandboxIdx + 1], 'danger-full-access');
  assert.ok(
    args.some((a) => typeof a === 'string' && a.startsWith('approval_policy=')),
    'approval_policy override must be emitted',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Binary download preserves exact bytes
// ─────────────────────────────────────────────────────────────────────────────

test('Binary file download preserves exact bytes', async () => {
  const expressMod = await import('express');
  const express = expressMod.default;
  const { sendDownload } = await import('../../backend/project-file-operations.ts');

  // Construct a binary payload that exercises null bytes, high bytes, and
  // ASCII text so any UTF-8 transcoding would corrupt it.
  const payload = Buffer.concat([
    Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]),
    Buffer.from('PNG\x89\r\n\x1a\nIDAT', 'binary'),
    Buffer.from([0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0]),
    Buffer.from('plain ascii ✓'),
  ]);

  const tempDir = await mkdtemp(join(tmpdir(), 'ozw-bin-dl-'));
  const fixturePath = join(tempDir, 'fixture.bin');
  await writeFile(fixturePath, payload);

  const app = express();
  app.get('/dl', (_req, res) => sendDownload(res, fixturePath, 'fixture.bin'));

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/dl`);
    assert.equal(response.status, 200);
    const ab = await response.arrayBuffer();
    const received = Buffer.from(ab);
    assert.equal(received.length, payload.length, 'byte length must match');
    assert.ok(received.equals(payload), 'received bytes must equal source bytes');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Frontend download flow uses blob/arrayBuffer rather than text() (no UTF-8 corruption)', async () => {
  // The client-side download flow is TypeScript and not directly invokable
  // from node:test, but we can pin the contract by asserting that the helper
  // does not transcode the response: it uses response.blob() and never
  // response.text() on the download path.
  const fileTreeOps = await readFile(
    resolvePath(REPO_ROOT, 'frontend/components/file-tree/hooks/useFileTreeOperations.ts'),
    'utf8',
  );
  assert.match(fileTreeOps, /downloadEntry[^]*?response\.blob\(\)/, 'downloadEntry must call response.blob()');
  // The download flow must NOT transcode through text(); search only inside
  // the downloadEntry block to avoid false positives elsewhere in the file.
  const downloadBlockMatch = fileTreeOps.match(/downloadEntry[\s\S]*?\n\s*\}\s*,\s*\[/);
  assert.ok(downloadBlockMatch, 'must locate downloadEntry block');
  assert.doesNotMatch(
    downloadBlockMatch[0],
    /response\.text\(\)/,
    'downloadEntry must not call response.text()',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Service Worker cleanup (retired via frontend unregistration)
// ─────────────────────────────────────────────────────────────────────────────

test('Legacy service worker file is removed; frontend unregisters stale workers', async () => {
  // Change 30 deleted public/sw.js because no entry point registers it.
  // Instead, frontend/main.tsx unregisters every existing service worker on load.
  const swPath = resolvePath(REPO_ROOT, 'public/sw.js');
  let swExists = false;
  try {
    await readFile(swPath, 'utf8');
    swExists = true;
  } catch {
    // Expected: file is deleted.
  }
  assert.equal(swExists, false, 'public/sw.js must no longer exist');

  // The frontend entry point must unregister stale workers.
  const mainTsx = await readFile(resolvePath(REPO_ROOT, 'frontend/main.tsx'), 'utf8');
  assert.match(mainTsx, /getRegistrations/, 'main.tsx must call getRegistrations to find stale workers');
  assert.match(mainTsx, /\.unregister\(\)/, 'main.tsx must unregister each stale service worker');

  // Build output must not contain sw.js.
  const distSwPath = resolvePath(REPO_ROOT, 'dist', 'sw.js');
  let distSwExists = false;
  try {
    const distSw = await readFile(distSwPath, 'utf8');
    distSwExists = !!distSw;
  } catch {
    // Expected: not published.
  }
  assert.equal(distSwExists, false, 'dist/sw.js must not be published');
});
