/**
 * 文件目的：在 macOS 创建 PTY 前，安全恢复 node-pty spawn-helper 的可执行权限。
 * 业务意义：npm 包可能把该原生辅助程序解包为 0644，必须在最小文件范围内修复后才能启动终端。
 */
import { chmodSync, lstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

type PrepareNodePtyOptions = {
    platform?: NodeJS.Platform;
    arch?: string;
    resolvePackageJson?: () => string;
};

const require = createRequire(import.meta.url);

/**
 * 解析当前 node-pty 安装中与 Darwin 架构严格对应的 spawn-helper。
 */
function resolveDarwinSpawnHelper(arch: string, resolvePackageJson: () => string): string {
    const packageJsonPath = resolvePackageJson();
    return path.join(path.dirname(packageJsonPath), 'prebuilds', `darwin-${arch}`, 'spawn-helper');
}

/**
 * 在 Darwin 上校验并幂等修复 node-pty spawn-helper；其他平台不做文件操作。
 */
export function prepareNodePtyRuntime(options: PrepareNodePtyOptions = {}): void {
    const platform = options.platform ?? process.platform;
    if (platform !== 'darwin') return;

    const arch = options.arch ?? process.arch;
    let helperPath = 'node-pty spawn-helper';

    try {
        helperPath = resolveDarwinSpawnHelper(
            arch,
            options.resolvePackageJson ?? (() => require.resolve('node-pty/package.json')),
        );
        const helperStat = lstatSync(helperPath);
        if (helperStat.isSymbolicLink() || !helperStat.isFile()) {
            throw new Error('expected a regular file and refused to follow or modify it');
        }
        if ((helperStat.mode & 0o777) !== 0o755) {
            chmodSync(helperPath, 0o755);
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
            `Cannot prepare the macOS node-pty helper at ${helperPath}: ${reason}. `
            + 'Reinstall ozw, or make this exact spawn-helper a regular file with mode 0755.',
            { cause: error },
        );
    }
}
