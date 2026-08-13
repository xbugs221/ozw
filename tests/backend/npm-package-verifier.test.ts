/**
 * PURPOSE: Keep the npm tarball verifier strict against missing compiled
 * modules, archive path tricks, and accidentally published credentials.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  auditProductionShrinkwrap,
  auditRelativeModuleClosure,
  containsPrivateKey,
  findForbiddenRule,
  findRelativeModuleSpecifiers,
  normalizeArchivePath,
  resolveRelativeModuleCandidates,
// @ts-ignore The executable verifier intentionally remains plain zero-dependency JavaScript.
} from '../../scripts/verify-npm-package.mjs';

/** 构造最小生产依赖锁，专门验证根依赖字段与 optional 标记。 */
function createProductionShrinkwrap(overrides: Record<string, unknown> = {}) {
  return {
    name: 'ozw',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': {
        name: 'ozw',
        version: '1.0.0',
        dependencies: { express: '^4.0.0' },
        optionalDependencies: { 'node-pty': '^1.1.0' },
        bin: { ozw: 'dist-node/backend/cli.js' },
        engines: { node: '>=24' },
      },
      'node_modules/node-pty': {
        version: '1.1.0',
        optional: true,
      },
    },
    ...overrides,
  };
}

const verifierPackageJson = {
  name: 'ozw',
  version: '1.0.0',
  dependencies: { express: '^4.0.0' },
  optionalDependencies: { 'node-pty': '^1.1.0' },
  bin: { ozw: 'dist-node/backend/cli.js' },
  engines: { node: '>=24' },
};

test('extracts static, export-from, side-effect, and literal dynamic imports', () => {
  const source = `
    import value from './value.js';
    import './side-effect.js';
    export { result } from '../shared/result.js';
    export * from './facade.js';
    const lazy = import('./lazy.js');
    const json = import('./data.json', { with: { type: 'json' } });
    const external = import('express');
    const computed = import('./plugins/' + name);
  `;

  assert.deepEqual(findRelativeModuleSpecifiers(source), [
    './value.js',
    './side-effect.js',
    '../shared/result.js',
    './facade.js',
    './lazy.js',
    './data.json',
  ]);
});

test('accepts a closed relative module graph and reports a missing compiled module', () => {
  const paths = new Set([
    'dist-node/backend/index.js',
    'dist-node/backend/runtime.js',
    'dist-node/frontend/components/overlay.js',
  ]);
  const sources = new Map([
    [
      'dist-node/backend/index.js',
      "import './runtime.js'; export * from '../frontend/components/overlay.js';",
    ],
    ['dist-node/backend/runtime.js', 'export const ready = true;'],
    ['dist-node/frontend/components/overlay.js', 'export const overlay = true;'],
  ]);

  assert.deepEqual(auditRelativeModuleClosure(paths, sources), []);
  paths.delete('dist-node/frontend/components/overlay.js');
  assert.deepEqual(auditRelativeModuleClosure(paths, sources), [
    'relative import is missing: dist-node/backend/index.js -> ../frontend/components/overlay.js',
  ]);
});

test('resolves extensionless imports inside dist-node and rejects escapes', () => {
  assert.deepEqual(
    resolveRelativeModuleCandidates('dist-node/backend/index.js', './runtime'),
    [
      'dist-node/backend/runtime',
      'dist-node/backend/runtime.js',
      'dist-node/backend/runtime.json',
      'dist-node/backend/runtime.node',
      'dist-node/backend/runtime/index.js',
      'dist-node/backend/runtime/index.json',
      'dist-node/backend/runtime/index.node',
    ],
  );
  assert.throws(
    () => resolveRelativeModuleCandidates('dist-node/backend/index.js', '../../outside.js'),
    /relative import escapes dist-node/u,
  );
});

test('rejects non-canonical archive paths', () => {
  assert.equal(normalizeArchivePath('package/dist-node/backend/index.js'), 'dist-node/backend/index.js');
  for (const unsafePath of [
    '../package/package.json',
    '/package/package.json',
    'package/../package.json',
    'package/dist-node\\backend\\index.js',
  ]) {
    assert.throws(() => normalizeArchivePath(unsafePath), /unsafe tar entry path/u);
  }
});

test('blocks credential artifacts and private-key content without rejecting code modules', () => {
  assert.equal(findForbiddenRule('dist-node/backend/release-credentials.pem')?.reason, 'credential file');
  assert.equal(findForbiddenRule('dist-node/backend/private-key.txt')?.reason, 'sensitive path');
  assert.equal(findForbiddenRule('dist-node/backend/private-key.js')?.reason, 'sensitive path');
  assert.equal(findForbiddenRule('dist-node/backend/credentials/service.json')?.reason, 'sensitive path');
  assert.equal(findForbiddenRule('dist-node/backend/security/jwt-secret.js'), undefined);
  assert.equal(findForbiddenRule('dist-node/backend/git-credential-env.js'), undefined);
  assert.equal(findForbiddenRule('dist-node/backend/security/access-token.js'), undefined);

  assert.equal(
    containsPrivateKey(Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\nredacted')),
    true,
  );
  assert.equal(containsPrivateKey(Buffer.from('export const label = "PRIVATE KEY";')), false);
});

test('accepts only node-pty as an optional production dependency', () => {
  assert.deepEqual(
    auditProductionShrinkwrap(verifierPackageJson, createProductionShrinkwrap()),
    [],
  );

  assert.match(
    auditProductionShrinkwrap(
      {
        ...verifierPackageJson,
        optionalDependencies: { 'node-pty': '^1.1.0', 'native-surprise': '^1.0.0' },
      },
      createProductionShrinkwrap(),
    ).join('\n'),
    /optionalDependencies must contain only node-pty/u,
  );
});

test('rejects required or incorrectly locked node-pty', () => {
  const requiredPackageJson = {
    ...verifierPackageJson,
    dependencies: { ...verifierPackageJson.dependencies, 'node-pty': '^1.1.0' },
  };
  assert.match(
    auditProductionShrinkwrap(requiredPackageJson, createProductionShrinkwrap()).join('\n'),
    /node-pty must not be a required dependency/u,
  );

  const shrinkwrap = createProductionShrinkwrap();
  shrinkwrap.packages['node_modules/node-pty'].optional = false;
  assert.match(
    auditProductionShrinkwrap(verifierPackageJson, shrinkwrap).join('\n'),
    /must mark node-pty optional/u,
  );
});
