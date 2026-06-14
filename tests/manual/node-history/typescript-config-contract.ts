/**
 * Contract test: TypeScript configuration covers all core code paths and
 * does not use allowJs as a migration escape hatch.
 *
 * PURPOSE: Ensure typecheck remains strict after migration.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

interface TsconfigJson {
  compilerOptions?: {
    allowJs?: boolean;
    strict?: boolean;
  };
  references?: Array<{ path: string }>;
}

function readTsconfig(name: string): TsconfigJson {
  const fullPath = path.join(process.cwd(), name);
  return JSON.parse(readFileSync(fullPath, 'utf8'));
}

describe('typescript-config-contract', () => {
  it('root tsconfig uses project references, not allowJs', () => {
    const root = readTsconfig('tsconfig.json');
    assert.ok(
      !root.compilerOptions?.allowJs,
      'root tsconfig.json should not have allowJs',
    );
    assert.ok(
      Array.isArray(root.references) && root.references.length >= 3,
      'root tsconfig.json should reference web, node, and test sub-configs',
    );
    const refPaths = root.references?.map(r => r.path) || [];
    assert.ok(refPaths.includes('./tsconfig.test.json'), 'root must reference tsconfig.test.json');
  });

  it('web tsconfig has allowJs disabled and strict enabled', () => {
    const web = readTsconfig('tsconfig.web.json');
    assert.equal(
      web.compilerOptions?.allowJs,
      false,
      'tsconfig.web.json should have allowJs: false',
    );
    assert.ok(
      web.compilerOptions?.strict,
      'tsconfig.web.json should have strict: true',
    );
  });

  it('node tsconfig has allowJs disabled and strict enabled', () => {
    const node = readTsconfig('tsconfig.node.json');
    assert.equal(
      node.compilerOptions?.allowJs,
      false,
      'tsconfig.node.json should have allowJs: false',
    );
    assert.ok(
      node.compilerOptions?.strict,
      'tsconfig.node.json should have strict: true',
    );
  });

  it('package.json typecheck script uses tsc build mode', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const command = String(pkg.scripts?.typecheck || '');
    assert.ok(
      command.includes('tsc -b') || command.includes('tsc --build'),
      `typecheck script should use 'tsc -b' (build mode), got: ${command}`,
    );
    assert.ok(
      command.includes('--noEmit'),
      `typecheck script should use --noEmit, got: ${command}`,
    );
  });

  it('test tsconfig has allowJs:false and strict:true (design requirement)', () => {
    const test = readTsconfig('tsconfig.test.json');
    assert.equal(
      test.compilerOptions?.allowJs,
      false,
      'tsconfig.test.json should have allowJs: false',
    );
    assert.equal(
      test.compilerOptions?.strict,
      true,
      'tsconfig.test.json must have strict: true per design.md common requirements',
    );
  });

  it('package.json scripts no longer reference .js test or server entry points', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const scripts = pkg.scripts || {};

    // Server entry should use tsx or compiled output, not raw node .js
    const serverCmd = String(scripts.server || '');
    assert.ok(
      !/node\s+.*\.js\b/.test(serverCmd),
      `server script should not reference .js: ${serverCmd}`,
    );

    // Test commands should use tsx, not raw node .js
    const testServerCmd = String(scripts['test:server'] || '');
    assert.ok(
      !/node\s+--test\s+.*\.js\b/.test(testServerCmd),
      `test:server should not reference .js: ${testServerCmd}`,
    );
  });

  it('postinstall script uses tsx, not raw node', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const postinstall = String(pkg.scripts?.postinstall || '');
    assert.ok(
      postinstall.includes('tsx'),
      `postinstall should use tsx: ${postinstall}`,
    );
  });
});
