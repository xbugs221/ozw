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
  clearRuntimeDependencyDiagnosticsCacheForTest,
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
    const diagnostics = await checkRequiredRuntimeDependencies();
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
    const diagnostics = await getRuntimeDependencyDiagnostics();
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
    const diagnostics = await getRuntimeDependencyDiagnostics();
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
    const diagnostics = await getRuntimeDependencyDiagnostics();
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
    const diagnostics = await getRuntimeDependencyDiagnostics();
    assert.equal(diagnostics.commands.oz.graph.available, false);
    assert.equal(diagnostics.commands.oz.graph.contract_declared, false);
    assert.match(diagnostics.commands.oz.graph.detail, /did not advertise/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runtime diagnostics report an incompatible oz flow contract without blocking startup', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-runtime-bin-'));
  await writeFakeCommand(binDir, 'oz', fakeOzBody({
    contract: '{"version":"oz-flow-test","json":true,"capabilities":["list-changes","run","status"]}',
  }));
  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  try {
    const diagnostics = await getRuntimeDependencyDiagnostics();
    assert.equal(diagnostics.ok, false);
    assert.equal(diagnostics.commands.oz.contract.ok, false);
    assert.deepEqual(diagnostics.commands.oz.contract.missing, ['resume', 'abort']);
    assert.equal((await checkRequiredRuntimeDependencies()).ok, false);
  } finally {
    process.env.PATH = previousPath;
  }
});

test('runtime diagnostics report a missing oz CLI without blocking startup', async () => {
  const previousPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const diagnostics = await getRuntimeDependencyDiagnostics();
    assert.equal(diagnostics.ok, false);
    assert.equal(diagnostics.commands.oz.command_path, '');
    assert.match(diagnostics.commands.oz.version.error, /PATH/);
    assert.equal((await checkRequiredRuntimeDependencies()).ok, false);
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
    const diagnostics = await getRuntimeDependencyDiagnostics();
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

test('runtime diagnostics keep the event loop responsive and reuse concurrent success', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-runtime-async-bin-'));
  const countPath = path.join(binDir, 'count');
  await writeFakeCommand(binDir, 'oz', [
    '#!/bin/sh',
    `printf x >> '${countPath}'`,
    'sleep 0.15',
    'if [ "$1" = "--version" ]; then echo oz-async; exit 0; fi',
    'if [ "$1" = "flow" ] && [ "$2" = "contract" ]; then',
    '  echo \'{"json":true,"capabilities":["list-changes","run","resume","status","abort","graph"]}\'',
    '  exit 0',
    'fi',
    'exit 1',
  ].join('\n'));
  process.env.PATH = `${binDir}${path.delimiter}${previousPath || ''}`;
  clearRuntimeDependencyDiagnosticsCacheForTest();
  try {
    let timerFired = false;
    setTimeout(() => { timerFired = true; }, 20);
    const [first, second] = await Promise.all([
      getRuntimeDependencyDiagnostics(),
      getRuntimeDependencyDiagnostics(),
    ]);
    assert.equal(timerFired, true, 'child probes must not block timers');
    assert.equal(first.ok, true);
    assert.deepEqual(second, first);
    assert.equal((await fs.readFile(countPath, 'utf8')).length, 2, 'concurrent requests must share version and contract probes');

    await getRuntimeDependencyDiagnostics();
    assert.equal((await fs.readFile(countPath, 'utf8')).length, 2, 'successful diagnostics must use the bounded cache');
  } finally {
    clearRuntimeDependencyDiagnosticsCacheForTest();
    process.env.PATH = previousPath;
    await fs.rm(binDir, { recursive: true, force: true });
  }
});

test('failed runtime diagnostics are retried instead of cached', async () => {
  const previousPath = process.env.PATH;
  const binDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-runtime-retry-bin-'));
  process.env.PATH = binDir;
  clearRuntimeDependencyDiagnosticsCacheForTest();
  try {
    assert.equal((await getRuntimeDependencyDiagnostics()).ok, false);
    await writeFakeCommand(binDir, 'oz', fakeOzBody({
      contract: '{"json":true,"capabilities":["list-changes","run","resume","status","abort","graph"]}',
    }));
    assert.equal((await getRuntimeDependencyDiagnostics()).ok, true);
  } finally {
    clearRuntimeDependencyDiagnosticsCacheForTest();
    process.env.PATH = previousPath;
    await fs.rm(binDir, { recursive: true, force: true });
  }
});
