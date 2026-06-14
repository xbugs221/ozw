import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  BUILTIN_ALIAS_NAMESPACE,
  builtinAliasBaseDir,
  isCommandPathAllowed,
  scanCommandsDirectory,
} from '../../backend/routes/commands.ts';

test('built-in aliases are scanned as slash commands', async () => {
  const commands = await scanCommandsDirectory(
    builtinAliasBaseDir,
    builtinAliasBaseDir,
    BUILTIN_ALIAS_NAMESPACE,
  );

  const names = commands.map((command) => command.name).sort();

  assert.deepEqual(names, [
    '/analysis',
    '/archive',
    '/explore',
    '/fix',
    '/git-clean',
    '/git-review',
    '/git-summary',
    '/propose',
  ]);
  assert.ok(commands.every((command) => command.namespace === BUILTIN_ALIAS_NAMESPACE));
  assert.ok(commands.every((command) => command.description));
});

test('built-in aliases do not expose retired OpenSpec CLI entrypoints', async () => {
  const commands = await scanCommandsDirectory(
    builtinAliasBaseDir,
    builtinAliasBaseDir,
    BUILTIN_ALIAS_NAMESPACE,
  );

  for (const command of commands) {
    const content = await fs.readFile(command.path, 'utf8');
    assert.equal(
      /\bopenspec\s+(?:list|status|new|archive|instructions)\b|instructions\s+apply/i.test(content),
      false,
      `${command.name} still references retired OpenSpec CLI commands`,
    );
  }
});

test('archive alias uses the confirmed oz archive JSON contract', async () => {
  const archivePath = path.join(builtinAliasBaseDir, 'archive.md');
  const content = await fs.readFile(archivePath, 'utf8');

  assert.match(content, /oz archive "<name>" --yes --json/);
  assert.doesNotMatch(content, /oz archive "<name>" --json/);
});

test('command paths are restricted to command directories', () => {
  assert.equal(
    isCommandPathAllowed(path.join(builtinAliasBaseDir, 'propose.md')),
    true,
  );
  assert.equal(isCommandPathAllowed(path.resolve('package.json')), false);
});
