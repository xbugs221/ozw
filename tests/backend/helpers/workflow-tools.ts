// @ts-nocheck -- Test helper used by strictness-deferred backend integration tests.
/**
 * PURPOSE: Provide fake oz flow CLI for backend tests that start the
 * real web server without depending on host-level workflow binaries.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function writeFakeWorkflowTools(binDir) {
  /** Write the minimal startup contracts required by runtime diagnostics. */
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(binDir, 'oz'), [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "oz-backend-test"; exit 0; fi',
    'if [ "$1" = "flow" ] && [ "$2" = "contract" ]; then echo \'{"version":"oz-flow-backend-test","json":true,"capabilities":["list-changes","run","resume","status","abort"]}\'; exit 0; fi',
    'echo "{}"',
  ].join('\n'), { mode: 0o755 });
}
