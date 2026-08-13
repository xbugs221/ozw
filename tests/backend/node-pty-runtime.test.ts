/**
 * 文件目的：回归验证 macOS node-pty spawn-helper 的最小权限修复与文件类型保护。
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { prepareNodePtyRuntime } from '../../backend/server/node-pty-runtime.ts';

/**
 * 在隔离目录构造最小 node-pty 包结构，并自动清理测试文件。
 */
async function withFakeNodePty(run: (fixture: {
    packageJsonPath: string;
    helperPath: string;
    packagePath: string;
}) => Promise<void>): Promise<void> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-node-pty-runtime-'));
    const packagePath = path.join(directory, 'node-pty');
    const helperPath = path.join(packagePath, 'prebuilds', 'darwin-arm64', 'spawn-helper');
    const packageJsonPath = path.join(packagePath, 'package.json');
    try {
        await fs.mkdir(path.dirname(helperPath), { recursive: true });
        await fs.writeFile(packageJsonPath, '{}\n');
        await run({ packageJsonPath, helperPath, packagePath });
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

test('Darwin preparation changes only the current node-pty helper to mode 0755', async () => {
    /** Prove a packaged 0644 helper becomes executable and a sibling architecture is untouched. */
    await withFakeNodePty(async ({ packageJsonPath, helperPath, packagePath }) => {
        const siblingHelper = path.join(packagePath, 'prebuilds', 'darwin-x64', 'spawn-helper');
        await fs.writeFile(helperPath, 'helper', { mode: 0o644 });
        await fs.mkdir(path.dirname(siblingHelper), { recursive: true });
        await fs.writeFile(siblingHelper, 'sibling', { mode: 0o644 });

        prepareNodePtyRuntime({
            platform: 'darwin',
            arch: 'arm64',
            resolvePackageJson: () => packageJsonPath,
        });

        assert.equal((await fs.stat(helperPath)).mode & 0o777, 0o755);
        assert.equal((await fs.stat(siblingHelper)).mode & 0o777, 0o644);
        assert.equal(await fs.readFile(helperPath, 'utf8'), 'helper');

        prepareNodePtyRuntime({
            platform: 'darwin',
            arch: 'arm64',
            resolvePackageJson: () => packageJsonPath,
        });
        assert.equal((await fs.stat(helperPath)).mode & 0o777, 0o755);
    });
});

test('non-Darwin preparation does not resolve or modify node-pty files', () => {
    /** Keep Windows and Linux outside this Darwin-specific workaround. */
    let resolved = false;
    prepareNodePtyRuntime({
        platform: 'linux',
        resolvePackageJson: () => {
            resolved = true;
            throw new Error('must not resolve');
        },
    });
    assert.equal(resolved, false);
});

test('Darwin preparation rejects symlinks and reports the exact safe recovery action', async () => {
    /** Ensure an attacker-controlled link cannot redirect chmod to another file. */
    await withFakeNodePty(async ({ packageJsonPath, helperPath, packagePath }) => {
        const targetPath = path.join(packagePath, 'unrelated-file');
        await fs.writeFile(targetPath, 'target', { mode: 0o600 });
        await fs.symlink(targetPath, helperPath);

        assert.throws(
            () => prepareNodePtyRuntime({
                platform: 'darwin',
                arch: 'arm64',
                resolvePackageJson: () => packageJsonPath,
            }),
            (error: unknown) => error instanceof Error
                && error.message.includes(helperPath)
                && error.message.includes('regular file')
                && error.message.includes('mode 0755'),
        );
        assert.equal((await fs.stat(targetPath)).mode & 0o777, 0o600);
    });
});

test('Darwin preparation rejects a directory instead of widening its permissions', async () => {
    /** A malformed package layout must fail actionably without chmod on non-files. */
    await withFakeNodePty(async ({ packageJsonPath, helperPath }) => {
        await fs.mkdir(helperPath);
        await fs.chmod(helperPath, 0o700);
        const originalMode = (await fs.stat(helperPath)).mode & 0o777;

        assert.throws(
            () => prepareNodePtyRuntime({
                platform: 'darwin',
                arch: 'arm64',
                resolvePackageJson: () => packageJsonPath,
            }),
            /expected a regular file/u,
        );
        assert.equal((await fs.stat(helperPath)).mode & 0o777, originalMode);
    });
});
