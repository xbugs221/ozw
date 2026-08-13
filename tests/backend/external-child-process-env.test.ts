/**
 * PURPOSE: Execute fake oz, Git, and probe binaries to prove third-party
 * processes cannot inherit ozw authentication or private runtime paths.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cloneGitHubRepo } from '../../backend/domains/agent/github-operations.ts';
import { getGoWorkflowRunStatus } from '../../backend/domains/workflows/go-runner-client.ts';
import { createDirectoryArchive } from '../../backend/project-file-operations.ts';
import { runAsyncCommandProbe } from '../../backend/utils/async-command-probe.ts';

const SECRET_ENV = {
  API_KEY: 'legacy-api-secret',
  DATABASE_PATH: '/private/ozw.db',
  OZW_ACCESS_TOKEN: 'browser-secret',
  OZW_HOME: '/private/.ozw',
  OZW_JWT_SECRET_PATH: '/private/.jwt-secret',
};

/** Write a portable-enough POSIX fake executable used by real child-process calls. */
async function writeExecutable(filePath: string, lines: string[]): Promise<void> {
  /** The production test matrix already uses shell-based fake CLIs on Unix. */
  await fs.writeFile(filePath, ['#!/bin/sh', ...lines, ''].join('\n'), { mode: 0o755 });
}

/** Temporarily merge environment values and restore every touched key afterward. */
async function withEnvironment(values: NodeJS.ProcessEnv, callback: () => Promise<void>): Promise<void> {
  /** Isolate secret-bearing process.env mutations from the rest of the test process. */
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Assert fake process output contains useful user/provider env but no ozw secrets. */
function assertCapturedEnvironment(payload: Record<string, string>): void {
  /** HOME/XDG prove sanitization is selective rather than a blank environment. */
  for (const key of Object.keys(SECRET_ENV)) {
    assert.equal(payload[key], '', `${key} must not reach the executable`);
  }
  assert.equal(payload.HOME, '/users/example');
  assert.equal(payload.XDG_CONFIG_HOME, '/users/example/.config');
  assert.equal(payload.OPENAI_API_KEY, 'provider-key');
}

test('oz runner process receives provider and user env without ozw secrets', { skip: process.platform === 'win32' }, async () => {
  /** Business case: workflow plugins must not receive the Web UI token. */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-oz-env-'));
  const binDir = path.join(tempRoot, 'bin');
  await fs.mkdir(binDir);
  await writeExecutable(path.join(binDir, 'oz'), [
    'printf \'{"API_KEY":"%s","DATABASE_PATH":"%s","OZW_ACCESS_TOKEN":"%s","OZW_HOME":"%s","OZW_JWT_SECRET_PATH":"%s","HOME":"%s","XDG_CONFIG_HOME":"%s","OPENAI_API_KEY":"%s"}\\n\' "$API_KEY" "$DATABASE_PATH" "$OZW_ACCESS_TOKEN" "$OZW_HOME" "$OZW_JWT_SECRET_PATH" "$HOME" "$XDG_CONFIG_HOME" "$OPENAI_API_KEY"',
  ]);

  try {
    await withEnvironment({
      ...SECRET_ENV,
      HOME: '/users/example',
      OPENAI_API_KEY: 'provider-key',
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
      XDG_CONFIG_HOME: '/users/example/.config',
    }, async () => {
      const payload = await getGoWorkflowRunStatus(tempRoot, 'run-a');
      assertCapturedEnvironment(payload);
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('Git clone receives temporary credentials without ozw secrets', { skip: process.platform === 'win32' }, async () => {
  /** Business case: authenticated clones retain GIT_ASKPASS but not server auth. */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-git-env-'));
  const binDir = path.join(tempRoot, 'bin');
  const capturePath = path.join(tempRoot, 'git-env.json');
  const clonePath = path.join(tempRoot, 'clone');
  await fs.mkdir(binDir);
  await writeExecutable(path.join(binDir, 'git'), [
    'last=""; for argument in "$@"; do last="$argument"; done',
    'mkdir -p "$last"',
    'printf \'{"API_KEY":"%s","DATABASE_PATH":"%s","OZW_ACCESS_TOKEN":"%s","OZW_HOME":"%s","OZW_JWT_SECRET_PATH":"%s","HOME":"%s","XDG_CONFIG_HOME":"%s","OPENAI_API_KEY":"%s","GIT_ASKPASS":"%s","GIT_TERMINAL_PROMPT":"%s"}\\n\' "$API_KEY" "$DATABASE_PATH" "$OZW_ACCESS_TOKEN" "$OZW_HOME" "$OZW_JWT_SECRET_PATH" "$HOME" "$XDG_CONFIG_HOME" "$OPENAI_API_KEY" "$GIT_ASKPASS" "$GIT_TERMINAL_PROMPT" > "$FAKE_ENV_CAPTURE"',
  ]);

  try {
    await withEnvironment({
      ...SECRET_ENV,
      FAKE_ENV_CAPTURE: capturePath,
      HOME: '/users/example',
      OPENAI_API_KEY: 'provider-key',
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
      XDG_CONFIG_HOME: '/users/example/.config',
    }, async () => {
      await cloneGitHubRepo('https://github.com/example/repo.git', 'github-token', clonePath);
      const payload = JSON.parse(await fs.readFile(capturePath, 'utf8'));
      assertCapturedEnvironment(payload);
      assert.notEqual(payload.GIT_ASKPASS, '');
      assert.equal(payload.GIT_TERMINAL_PROMPT, '0');
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('generic executable probe sanitizes an explicitly supplied base env', { skip: process.platform === 'win32' }, async () => {
  /** Business case: future dependency probes inherit the safe boundary by default. */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-probe-env-'));
  const executable = path.join(tempRoot, 'probe');
  await writeExecutable(executable, [
    'printf \'{"API_KEY":"%s","DATABASE_PATH":"%s","OZW_ACCESS_TOKEN":"%s","OZW_HOME":"%s","OZW_JWT_SECRET_PATH":"%s","HOME":"%s","XDG_CONFIG_HOME":"%s","OPENAI_API_KEY":"%s"}\\n\' "$API_KEY" "$DATABASE_PATH" "$OZW_ACCESS_TOKEN" "$OZW_HOME" "$OZW_JWT_SECRET_PATH" "$HOME" "$XDG_CONFIG_HOME" "$OPENAI_API_KEY"',
  ]);

  try {
    const result = await runAsyncCommandProbe(executable, [], {
      env: {
        ...SECRET_ENV,
        HOME: '/users/example',
        OPENAI_API_KEY: 'provider-key',
        PATH: process.env.PATH,
        XDG_CONFIG_HOME: '/users/example/.config',
      },
    });
    assert.equal(result.status, 0);
    assertCapturedEnvironment(JSON.parse(result.stdout));
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('zip process preserves PATH while removing ozw secrets', { skip: process.platform === 'win32' }, async () => {
  /** Business case: folder downloads must not expose server auth to host tools. */
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-zip-env-'));
  const binDir = path.join(tempRoot, 'bin');
  const sourceDirectory = path.join(tempRoot, 'source');
  const capturePath = path.join(tempRoot, 'zip-env.json');
  await fs.mkdir(binDir);
  await fs.mkdir(sourceDirectory);
  await writeExecutable(path.join(binDir, 'zip'), [
    'printf \'{"API_KEY":"%s","DATABASE_PATH":"%s","OZW_ACCESS_TOKEN":"%s","OZW_HOME":"%s","OZW_JWT_SECRET_PATH":"%s","HOME":"%s","XDG_CONFIG_HOME":"%s","OPENAI_API_KEY":"%s"}\\n\' "$API_KEY" "$DATABASE_PATH" "$OZW_ACCESS_TOKEN" "$OZW_HOME" "$OZW_JWT_SECRET_PATH" "$HOME" "$XDG_CONFIG_HOME" "$OPENAI_API_KEY" > "$FAKE_ENV_CAPTURE"',
  ]);

  try {
    await withEnvironment({
      ...SECRET_ENV,
      FAKE_ENV_CAPTURE: capturePath,
      HOME: '/users/example',
      OPENAI_API_KEY: 'provider-key',
      PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
      XDG_CONFIG_HOME: '/users/example/.config',
    }, async () => {
      const archivePath = await createDirectoryArchive(sourceDirectory);
      assertCapturedEnvironment(JSON.parse(await fs.readFile(capturePath, 'utf8')));
      await fs.rm(path.dirname(String(archivePath)), { recursive: true, force: true });
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
