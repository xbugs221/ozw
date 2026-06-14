#!/usr/bin/env node
/**
 * PURPOSE: Print the Node-runner spec files so CI does not depend on a host
 * fd binary and does not accidentally run browser specs or archived tests.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

const specDir = path.resolve('tests/spec');

function listNodeSpecTests() {
  /**
   * Select top-level TypeScript files that belong to the node:test spec entry.
   */
  return readdirSync(specDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    .sort()
    .map((name) => path.join('tests/spec', name));
}

process.stdout.write(`${listNodeSpecTests().join(' ')}\n`);
