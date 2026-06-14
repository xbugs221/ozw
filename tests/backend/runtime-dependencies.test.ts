// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify ozw startup diagnostics depend only on the external oz CLI
 * JSON/version contract visible through PATH.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import {
  checkRequiredRuntimeDependencies,
  getRuntimeDependencyDiagnostics,
} from '../../backend/runtime-dependencies.ts';

/**
 * Create one executable fake CLI in a temporary PATH directory.
 */
async function writeFakeCommand(binDir, name, body) {
  const filePath = path.join(binDir, name);
  await fs.writeFile(filePath, body, { mode: 0o755 });
  return filePath;
}

/**
 * Build a fake oz executable with configurable oz flow behavior.
 */
function fakeOzBody({ contract, graphHelp, versionExit = 0 }) {
  return [
    '#!/bin/sh',
    `if [ "$1" = "--version" ]; then echo oz-test; exit ${versionExit}; fi`,
    'if [ "$1" = "flow" ] && [ "$2" = "contract" ]; then',
    `  echo '${contract}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "flow" ] && [ "$2" = "graph" ] && [ "$3" = "--help" ]; then',
    graphHelp || '  echo "Usage: oz flow graph"',
    graphHelp?.includes('exit ') ? '' : '  exit 0',
    'fi',
    'echo "{}"',
  ].filter(Boolean).join('\n');
}

test('runtime diagnostics report fake oz from PATH', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-runtime-bin-'));
  await writeFakeCommand(binDir, 'oz', fakeOzBody({
    contract: '{"version":"oz-flow-test","json":true,"capabilities":["list-changes","run","resume","status","abort"]}',
  }));
  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  try {
    const diagnostics = checkRequiredRuntimeDependencies();
    assert.equal(diagnostics.ok, true);
    assert.equal(diagnostics.commands.oz.command_path, path.join(binDir, 'oz'));
    assert.match(diagnostics.commands.oz.version.output, /oz-test/);
    assert.equal(diagnostics.commands.oz.contract.ok, true);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runtime diagnostics report graph capability when declared in oz flow contract', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-runtime-bin-'));
  await writeFakeCommand(binDir, 'oz', fakeOzBody({
    contract: '{"version":"oz-flow-test","json":true,"capabilities":["list-changes","run","resume","status","abort","graph"]}',
  }));
  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  try {
    const diagnostics = getRuntimeDependencyDiagnostics();
    assert.equal(diagnostics.commands.oz.graph.available, true);
    assert.equal(diagnostics.commands.oz.graph.contract_declared, true);
    assert.equal(diagnostics.commands.oz.graph.error, '');
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runtime diagnostics detect graph capability via oz flow graph --help fallback when contract omits it', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-runtime-bin-'));
  await writeFakeCommand(binDir, 'oz', fakeOzBody({
    contract: '{"version":"oz-flow-test","json":true,"capabilities":["list-changes","run","resume","status","abort"]}',
    graphHelp: '  echo "Usage: oz flow graph [--format json]"; exit 0',
  }));
  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  try {
    const diagnostics = getRuntimeDependencyDiagnostics();
    assert.equal(diagnostics.commands.oz.graph.available, true);
    assert.equal(diagnostics.commands.oz.graph.contract_declared, false);
    assert.match(diagnostics.commands.oz.graph.detail, /detected via oz flow graph --help/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runtime diagnostics detect graph via --help output even when exit code is non-zero', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-runtime-bin-'));
  await writeFakeCommand(binDir, 'oz', fakeOzBody({
    contract: '{"version":"oz-flow-test","json":true,"capabilities":["list-changes","run","resume","status","abort"]}',
    graphHelp: '  echo "用法：oz flow graph --change <change-name> --format json|mermaid|dagu"; exit 1',
  }));
  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  try {
    const diagnostics = getRuntimeDependencyDiagnostics();
    assert.equal(diagnostics.commands.oz.graph.available, true);
    assert.equal(diagnostics.commands.oz.graph.contract_declared, false);
    assert.match(diagnostics.commands.oz.graph.detail, /exit 1/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runtime diagnostics report graph unavailable when contract and --help both lack support', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-runtime-bin-'));
  await writeFakeCommand(binDir, 'oz', fakeOzBody({
    contract: '{"version":"oz-flow-test","json":true,"capabilities":["list-changes","run","resume","status","abort"]}',
    graphHelp: '  echo "Usage: oz flow graph"; exit 0',
  }));
  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  try {
    const diagnostics = getRuntimeDependencyDiagnostics();
    assert.equal(diagnostics.commands.oz.graph.available, false);
    assert.equal(diagnostics.commands.oz.graph.contract_declared, false);
    assert.match(diagnostics.commands.oz.graph.detail, /did not advertise/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runtime diagnostics fail when oz flow lacks JSON workflow contract', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-runtime-bin-'));
  await writeFakeCommand(binDir, 'oz', fakeOzBody({
    contract: '{"version":"oz-flow-test","json":true,"capabilities":["list-changes","run","status"]}',
  }));
  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  try {
    const diagnostics = getRuntimeDependencyDiagnostics();
    assert.equal(diagnostics.ok, false);
    assert.equal(diagnostics.commands.oz.contract.ok, false);
    assert.deepEqual(diagnostics.commands.oz.contract.missing, ['resume', 'abort']);
    assert.throws(() => checkRequiredRuntimeDependencies(), /oz flow contract/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runtime diagnostics fail clearly when required CLI is missing', () => {
  const previousPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const diagnostics = getRuntimeDependencyDiagnostics();
    assert.equal(diagnostics.ok, false);
    assert.equal(diagnostics.commands.oz.command_path, '');
    assert.match(diagnostics.commands.oz.version.error, /PATH/);
    assert.throws(() => checkRequiredRuntimeDependencies(), /Missing from PATH: oz/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runtime diagnostics include command, subcommand and PATH in failure summaries', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-runtime-failure-bin-'));
  await writeFakeCommand(binDir, 'oz', [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo oz-broken >&2; exit 2; fi',
    'if [ "$1" = "flow" ] && [ "$2" = "contract" ]; then echo contract-broken >&2; exit 3; fi',
    'exit 1',
  ].join('\n'));
  process.env.PATH = binDir;
  try {
    const diagnostics = getRuntimeDependencyDiagnostics();
    assert.match(diagnostics.commands.oz.version.error, /oz --version failed/);
    assert.match(diagnostics.commands.oz.version.error, /oz-broken/);
    assert.match(diagnostics.commands.oz.version.error, /PATH=/);
    assert.match(diagnostics.commands.oz.contract.error, /oz flow contract --json failed/);
    assert.match(diagnostics.commands.oz.contract.error, /contract-broken/);
    assert.match(diagnostics.commands.oz.contract.error, /PATH=/);
  } finally {
    process.env.PATH = previousPath;
  }
});
