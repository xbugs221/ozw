// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify Claude residual cleanup and duplicate date-prefix deduplication
 * as defined in spec.md for change 2026-05-13-22.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(HERE, '..');

const readSource = (path) => readFile(resolvePath(REPO_ROOT, path), 'utf8');
const fileExists = async (path) => {
  try {
    await access(resolvePath(REPO_ROOT, path));
    return true;
  } catch {
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Claude SDK incompatible module removed
// ─────────────────────────────────────────────────────────────────────────────

test('backend/claude-sdk.js does not exist', async () => {
  assert.equal(await fileExists('backend/claude-sdk.js'), false, 'backend/claude-sdk.js must be deleted');
});

test('no production code references claude-sdk', () => {
  try {
    const result = execFileSync(
      'rg', ['-l', "claude-sdk", 'backend/', 'frontend/', 'shared/'],
      { encoding: 'utf8', cwd: REPO_ROOT }
    );
    const files = result.trim().split('\n').filter(Boolean);
    assert.deepEqual(files, [], 'no production code should reference claude-sdk');
  } catch (err) {
    // rg exit code 1 = no matches found (desired state)
    if (err && typeof err === 'object' && 'status' in err && err.status === 1) {
      return;
    }
    throw err;
  }
});

test('tests/backend/claude-sdk.unsupported.test.js does not exist', async () => {
  assert.equal(
    await fileExists('tests/backend/claude-sdk.unsupported.test.js'),
    false,
    'claude-sdk unsupported test must be deleted',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. CLAUDE_MODELS removed from shared constants
// ─────────────────────────────────────────────────────────────────────────────

test('shared/modelConstants.ts does not export CLAUDE_MODELS', async () => {
  const source = await readSource('shared/modelConstants.ts');
  assert.doesNotMatch(source, /CLAUDE_MODELS/);
  assert.doesNotMatch(source, /Claude-compatible/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ProcessingStatus component removed; bottom status bar deleted
// ─────────────────────────────────────────────────────────────────────────────

test('ClaudeStatus.tsx no longer exists', async () => {
  assert.equal(
    await fileExists('frontend/components/chat/view/subcomponents/ClaudeStatus.tsx'),
    false,
    'ClaudeStatus.tsx must not exist',
  );
});

test('ProcessingStatus.tsx has been removed (bottom status bar deleted)', async () => {
  assert.equal(
    await fileExists('frontend/components/chat/view/subcomponents/ProcessingStatus.tsx'),
    false,
    'ProcessingStatus.tsx must have been removed per oz change 33',
  );
});

test('no claudeStatus state variable remains in frontend chat code', async () => {
  try {
    execFileSync(
      'rg', ['-l', '-e', 'claudeStatus', '-e', 'setClaudeStatus', 'frontend/components/chat/'],
      { encoding: 'utf8', cwd: REPO_ROOT, stdio: 'pipe' }
    );
    assert.fail('rg should have exited with 1 (no matches)');
  } catch (err) {
    // rg exits 1 when no matches; exits >1 on error
    assert.equal(err.status, 1, 'rg should find no matches');
  }
});

test('processingStatus state has been removed from chat hooks', async () => {
  const source = await readSource('frontend/components/chat/hooks/useChatSessionState.ts');
  assert.doesNotMatch(source, /processingStatus/);
  assert.doesNotMatch(source, /setProcessingStatus/);
});

test('ProcessingStatus component is no longer rendered in ChatComposer', async () => {
  const source = await readSource('frontend/components/chat/view/subcomponents/ChatComposer.tsx');
  assert.doesNotMatch(source, /import ProcessingStatus from/);
  assert.doesNotMatch(source, /<ProcessingStatus\s/);
  assert.doesNotMatch(source, /status=\{processingStatus\}/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. No duplicate date prefixes in tests/ or archive/
// ─────────────────────────────────────────────────────────────────────────────

const DUP_DATE_RE = /^\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}-/;

test('no duplicate date prefix files in tests/', async () => {
  const entries = await readdir(resolvePath(REPO_ROOT, 'tests'), { recursive: true, withFileTypes: true });
  const dupPre = entries.filter((e) => e.isFile() && DUP_DATE_RE.test(e.name));
  assert.deepEqual(dupPre.map((e) => e.name), [], 'no duplicate date prefix test files should remain');
});

test('no duplicate date prefix dirs in docs/changes/archive/', async () => {
  const entries = await readdir(resolvePath(REPO_ROOT, 'docs/changes/archive'), { withFileTypes: true });
  const dupPre = entries.filter((e) => e.isDirectory() && DUP_DATE_RE.test(e.name));
  assert.deepEqual(dupPre.map((e) => e.name), [], 'no duplicate date prefix archive dirs should remain');
});

test('playwright.spec.config.js does not reference old dup date paths', async () => {
  const config = await readSource('playwright.spec.config.ts');
  assert.doesNotMatch(config, /2026-05-11-2026-05-11/);
  assert.doesNotMatch(config, /2026-05-10-2026-05-10/);
  assert.doesNotMatch(config, /2026-05-13-2026-05-13/);
});

test('archive docs do not reference old duplicate date file paths', () => {
  // Search archive content for old dup-date path strings (e.g. tests/2026-05-10-2026-05-10-).
  // Exclude the current dedup change's own archive (its design.md documents old→new mappings).
  // rg exits 1 (not found) which is the desired state.
  try {
    const result = execFileSync(
      'rg', [
        '-l',
        '-e', 'tests/20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]-20[0-9][0-9]-[0-9][0-9]-[0-9][0-9]-',
        '-g', '!docs/changes/archive/2026-05-13-22-清理Claude残留和重复日期命名/**',
        'docs/changes/archive/',
      ],
      { encoding: 'utf8', cwd: REPO_ROOT }
    );
    const files = result.trim().split('\n').filter(Boolean);
    assert.deepEqual(
      files,
      [],
      'archive docs must not reference any old duplicate date-prefix test paths',
    );
  } catch (err) {
    // rg exit code 1 = no matches found (OK)
    if (err && typeof err === 'object' && 'status' in err && err.status === 1) {
      return;
    }
    throw err;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. README presents current provider support accurately
// ─────────────────────────────────────────────────────────────────────────────

test('README does not list Claude as current chat provider', async () => {
  const readme = await readSource('README.md');
  assert.doesNotMatch(readme, /支持 Claude \/ Codex 会话/);
  assert.doesNotMatch(readme, /Claude Code.*OpenAI Codex CLI/);
  assert.match(readme, /Codex.*OpenCode/);
  assert.match(readme, /wo runner/);
  // ozw is described as light Web shell, not a Claude frontend
  assert.match(readme, /Web 工作台/);
});

test('non-archive docs do not describe Claude as current chat provider', () => {
  // Check internal docs (excluding changes/archive) for Claude-as-current-provider wording.
  // Patterns: "Claude、Codex", "Claude 或 Codex", "Claude, Codex" as current providers.
  const currentProviderPatterns = [
    'Claude.*Codex.*前端|Claude.*Codex.*展示|Claude.*Codex.*聊天|Claude.*Codex.*消息',
    '统一 Claude|选择 Claude|Claude 或 Codex',
    'Claude 和 Codex.*支持|把 Claude.*接到',
    '负责把 Claude',
  ];
  for (const pattern of currentProviderPatterns) {
    try {
      const result = execFileSync(
        'rg', [
          '-l',
          '-e', pattern,
          '-g', '!docs/changes/',
          '-g', '!docs/changes/archive/',
          'docs/',
        ],
        { encoding: 'utf8', cwd: REPO_ROOT }
      );
      const files = result.trim().split('\n').filter(Boolean);
      assert.deepEqual(
        files,
        [],
        `non-archive docs must not describe Claude as current provider (pattern: ${pattern})`,
      );
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && err.status === 1) {
        continue;
      }
      throw err;
    }
  }
});
