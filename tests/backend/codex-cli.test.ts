/**
 * PURPOSE: Verify Codex CLI resolution works outside npm-script PATH injection.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  formatCodexCliNotFoundMessage,
  resolveCodexCliPath,
} from '../../backend/codex-cli.ts';

/**
 * Create a fake executable command in a temporary directory.
 */
async function writeFakeExecutable(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}

test('explicit CODEX_CLI_PATH wins over PATH and local bins', () => {
  const resolved = resolveCodexCliPath({
    env: {
      CODEX_CLI_PATH: '/opt/codex/bin/codex',
      PATH: '',
    },
    cwd: '/tmp/no-codex',
  });

  assert.equal(resolved, '/opt/codex/bin/codex');
});

test('local node_modules bin is used when service PATH omits codex', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-codex-cli-'));
  const localCodex = path.join(tempRoot, 'node_modules', '.bin', 'codex');
  await writeFakeExecutable(localCodex);

  const resolved = resolveCodexCliPath({
    env: {
      PATH: '',
    },
    cwd: tempRoot,
  });

  assert.equal(resolved, localCodex);
});

test('missing Codex CLI message explains deployment fixes', () => {
  const message = formatCodexCliNotFoundMessage('codex', {
    PATH: '/usr/bin',
    HOME: '/home/service',
  });

  assert.match(message, /Codex CLI executable not found/);
  assert.match(message, /CODEX_CLI_PATH/);
  assert.match(message, /PATH=\/usr\/bin/);
});
