/**
 * PURPOSE: Verify stable version tags determine the package manifests used by release CI.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseReleaseTag, prepareReleasePackage } from '../../scripts/prepare-release-package.mjs';

test('parseReleaseTag accepts stable version tags', () => {
  assert.equal(parseReleaseTag('v1.4.23'), '1.4.23');
  assert.equal(parseReleaseTag('1.4.23'), '1.4.23');
});

test('parseReleaseTag rejects refs that are not stable release tags', () => {
  for (const tagName of ['v1.4', 'v1.4.23-rc.1', 'main']) {
    assert.throws(() => parseReleaseTag(tagName), /stable SemVer/);
  }
});

test('Release workflow accepts a version from the main branch and publishes the generated tag', async () => {
  const workflow = await readFile(path.join(process.cwd(), '.github/workflows/npm-release.yml'), 'utf8');

  assert.match(workflow, /workflow_dispatch:[\s\S]*?inputs:[\s\S]*?version:/);
  assert.match(workflow, /GITHUB_REF_NAME[^\n]*!= "main"/);
  assert.match(workflow, /prepare-release-package\.mjs "\$\{version_input\}"/);
  assert.match(workflow, /release_tag: \$\{\{ steps\.package\.outputs\.tag \}\}/);
  assert.match(workflow, /gh release create "\$\{RELEASE_TAG\}"/);
});

test('prepareReleasePackage updates npm manifests from the tag version', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'ozw-release-package-'));
  try {
    execFileSync('git', ['init'], { cwd: tempDirectory, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: tempDirectory });
    execFileSync('git', ['config', 'user.email', 'release-test@example.invalid'], { cwd: tempDirectory });
    await writeFile(
      path.join(tempDirectory, 'package.json'),
      `${JSON.stringify({ name: '@xbugs221/ozw', version: '1.4.22' }, null, 2)}\n`,
    );
    await writeFile(
      path.join(tempDirectory, 'npm-shrinkwrap.json'),
      `${JSON.stringify({
        version: '1.4.22',
        packages: { '': { name: '@xbugs221/ozw', version: '1.4.22' }, 'node_modules/example': { version: '2.0.0' } },
      }, null, 2)}\n`,
    );
    await writeFile(path.join(tempDirectory, 'CHANGELOG.md'), '# Changelog\n\n## v1.4.22 - 2026-09-27\n\n- Previous release\n');
    execFileSync('git', ['add', '.'], { cwd: tempDirectory });
    execFileSync('git', ['commit', '-m', 'chore: previous release'], { cwd: tempDirectory, stdio: 'ignore' });
    execFileSync('git', ['tag', 'v1.4.22'], { cwd: tempDirectory });
    await writeFile(path.join(tempDirectory, 'change.txt'), 'next release change\n');
    execFileSync('git', ['add', '.'], { cwd: tempDirectory });
    execFileSync('git', ['commit', '-m', 'feat: add release improvement'], { cwd: tempDirectory, stdio: 'ignore' });

    assert.throws(
      () => prepareReleasePackage('v1.4.21', tempDirectory),
      /must be newer than v1\.4\.22/,
    );
    assert.equal(prepareReleasePackage('v1.4.23', tempDirectory), '1.4.23');

    const packageJson = JSON.parse(await readFile(path.join(tempDirectory, 'package.json'), 'utf8'));
    const shrinkwrap = JSON.parse(await readFile(path.join(tempDirectory, 'npm-shrinkwrap.json'), 'utf8'));
    assert.equal(packageJson.version, '1.4.23');
    assert.equal(shrinkwrap.version, '1.4.23');
    assert.equal(shrinkwrap.packages[''].version, '1.4.23');
    assert.equal(shrinkwrap.packages['node_modules/example'].version, '2.0.0');
    const changelog = await readFile(path.join(tempDirectory, 'CHANGELOG.md'), 'utf8');
    const releaseNotes = await readFile(path.join(tempDirectory, 'release-notes.md'), 'utf8');
    assert.match(changelog, /## v1\.4\.23 - \d{4}-\d{2}-\d{2}/);
    assert.match(changelog, /- feat: add release improvement/);
    assert.doesNotMatch(changelog, /- chore: previous release/);
    assert.ok(releaseNotes.startsWith(changelog.split('\n\n').slice(1, 3).join('\n\n')));
    assert.match(releaseNotes, /npm install -g @xbugs221\/ozw && ozw/);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
