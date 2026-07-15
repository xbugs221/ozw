#!/usr/bin/env node
/**
 * PURPOSE: List staged test files so pre-commit never repeats tests that were
 * not modified in the current commit.
 */

const TEST_PREFIXES = [
  ['tests/unit/', 'unit'],
  ['tests/backend/', 'backend'],
  ['tests/spec/', 'node-spec'],
  ['tests/specs/', 'browser-spec'],
  ['tests/e2e/', 'e2e'],
];

function normalize(relativePath) {
  /** Convert Git paths to the slash-separated format used by test prefixes. */
  return relativePath.replace(/^\.\//, '').replaceAll('\\', '/');
}

function classifyTest(file) {
  /** Select the test runner that owns a staged test file. */
  for (const [prefix, runner] of TEST_PREFIXES) {
    if (!file.startsWith(prefix)) {
      continue;
    }
    if ((runner === 'unit' || runner === 'backend') && !file.endsWith('.test.ts')) {
      return null;
    }
    if ((runner === 'browser-spec' || runner === 'e2e') && !/\.spec\.tsx?$/.test(file)) {
      return null;
    }
    if (runner === 'node-spec' && file.endsWith('.spec.ts')) {
      return 'browser-spec';
    }
    if (runner === 'node-spec' && file.slice(prefix.length).includes('/')) {
      return null;
    }
    return runner;
  }
  return null;
}

function listStagedTests(stagedFiles) {
  /** Keep only changed test files, de-duplicated and grouped by their runner. */
  return [...new Set(stagedFiles.map((file) => {
    const runner = classifyTest(file);
    return runner ? `${runner}\t${file}` : null;
  }).filter(Boolean))].sort();
}

const stagedFiles = process.argv.slice(2).map(normalize);
const stagedTests = listStagedTests(stagedFiles);
process.stdout.write(`${stagedTests.join('\n')}${stagedTests.length > 0 ? '\n' : ''}`);
