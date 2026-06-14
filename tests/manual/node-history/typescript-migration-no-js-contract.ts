/**
 * Contract test: No .js/.jsx/.mjs/.cjs files remain in tracked source, script,
 * config, and test paths after the TypeScript migration.
 *
 * PURPOSE: Prevent accidental JS regressions from being committed.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

/**
 * Allowed JS shim exceptions with documented removal conditions.
 *
 * When an external tool cannot load TS config natively and the team confirms
 * the loader is short-lived, list the file here with an exit condition.
 *
 * Format: { path: string; reason: string; exitCondition: string }
 */
const JS_SHIM_EXCEPTIONS: Array<{ path: string; reason: string; exitCondition: string }> = [
  // No exceptions at migration time. All tracked source, config, and
  // test files have been renamed to .ts/.tsx.
];

describe('typescript-migration-no-js-contract', () => {
  it('tracked source tree contains no .js/.jsx/.mjs/.cjs files', () => {
    const raw = execFileSync('git', ['ls-files', '*.js', '*.jsx', '*.mjs', '*.cjs'], {
      encoding: 'utf8',
      cwd: process.cwd(),
    }).trim();

    const lines = raw ? raw.split('\n').filter(Boolean) : [];
    const exceptionPaths = new Set(JS_SHIM_EXCEPTIONS.map((entry) => entry.path));
    const violations = lines.filter((line) => !exceptionPaths.has(line));

    if (violations.length > 0) {
      console.error('JS violations detected in tracked files:');
      violations.forEach((path) => console.error(`  ${path}`));
    }

    assert.equal(
      violations.length,
      0,
      `Expected 0 tracked JS/JSX/MJS/CJS files, found ${violations.length}. ` +
      'If an exception is needed, add it to JS_SHIM_EXCEPTIONS with a removal condition.',
    );
  });

  it('exception list is documented and short', () => {
    for (const entry of JS_SHIM_EXCEPTIONS) {
      assert.ok(entry.path, `Exception entry missing path: ${JSON.stringify(entry)}`);
      assert.ok(entry.reason, `Exception ${entry.path} missing reason`);
      assert.ok(entry.exitCondition, `Exception ${entry.path} missing exit condition`);
    }
    assert.ok(
      JS_SHIM_EXCEPTIONS.length <= 5,
      `Exception list should stay small (<= 5), found ${JS_SHIM_EXCEPTIONS.length}`,
    );
  });
});
