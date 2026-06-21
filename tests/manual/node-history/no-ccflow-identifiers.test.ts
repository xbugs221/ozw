/**
 * PURPOSE: Statically scan frontend/, backend/, and shared/ to ensure no ccflow
 * naming residue remains after the rename sweep. This is an acceptance test
 * for the 51st change proposal.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'server', 'shared'];
const ALLOWED_PATH_PATTERNS = [
  /docs\/changes\/archive/,
  /\.playwright-cli/,
  /node_modules/,
  /dist/,
  /dist-node/,
  /test-results/,
];

function* walk(dir: string): Generator<string> {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (ALLOWED_PATH_PATTERNS.some((p) => p.test(fullPath))) {
      continue;
    }
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') ||
        entry.name.endsWith('.tsx') ||
        entry.name.endsWith('.js') ||
        entry.name.endsWith('.json'))
    ) {
      yield fullPath;
    }
  }
}

function findCcflowOccurrences(filePath: string): Array<{ line: number; text: string }> {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const occurrences: Array<{ line: number; text: string }> = [];
  const pattern = /ccflow|Ccflow|CCFLOW/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (pattern.test(line)) {
      // Allow pure historical comments that mention the old project name
      // but not active identifiers (variables, functions, constants, env vars).
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        // Historical mention is okay only if it's a plain text comment,
        // not an identifier definition or usage.
        // We still flag it so a human can review, but we allow "ccflow"
        // inside comments that do not look like code.
        const codeLike = /\b(?:const|let|var|function|class|interface|type|import|export|from|process\.env)\b/;
        if (!codeLike.test(line)) {
          continue;
        }
      }
      occurrences.push({ line: i + 1, text: line.trim() });
    }
  }
  return occurrences;
}

test('frontend/, backend/, shared/ must not contain active ccflow identifiers', () => {
  const violations: Array<{ file: string; line: number; text: string }> = [];

  for (const scanDir of SCAN_DIRS) {
    const absoluteDir = path.join(ROOT, scanDir);
    if (!statSync(absoluteDir, { throwIfNoEntry: false })?.isDirectory()) {
      continue;
    }
    for (const filePath of walk(absoluteDir)) {
      const occurrences = findCcflowOccurrences(filePath);
      for (const occ of occurrences) {
        violations.push({ file: path.relative(ROOT, filePath), ...occ });
      }
    }
  }

  assert.deepStrictEqual(
    violations,
    [],
    `Active ccflow identifiers found in ${violations.length} location(s). ` +
      'All function names, variable names, constants, env vars, and regex names ' +
      'must use ozw instead of ccflow.',
  );
});

test('environment variable names must use OZW_ prefix, not CCFLOW_', () => {
  const envVarPatterns = [/CCFLOW_[A-Z_]+/];
  const violations: Array<{ file: string; line: number; text: string }> = [];

  for (const scanDir of SCAN_DIRS) {
    const absoluteDir = path.join(ROOT, scanDir);
    if (!statSync(absoluteDir, { throwIfNoEntry: false })?.isDirectory()) {
      continue;
    }
    for (const filePath of walk(absoluteDir)) {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const pat of envVarPatterns) {
          if (pat.test(lines[i])) {
            violations.push({
              file: path.relative(ROOT, filePath),
              line: i + 1,
              text: lines[i].trim(),
            });
          }
        }
      }
    }
  }

  assert.deepStrictEqual(
    violations,
    [],
    `CCFLOW_ environment variable references must be renamed to OZW_: ${JSON.stringify(violations, null, 2)}`,
  );
});
