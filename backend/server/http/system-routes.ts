/**
 * 文件目的：定义系统更新 HTTP API 的注册边界。
 * 业务意义：系统更新会执行安装命令，应与后端启动装配入口解耦，便于单独审查认证和执行目录。
 */

/**
 * 注册系统维护相关 HTTP route。
 */
import type {
    AuthMiddleware,
    HttpRouteApp,
    OsDeps,
    SpawnDeps,
} from './route-deps.js';

export interface SystemRouteDeps {
    app: HttpRouteApp;
    authenticateToken: AuthMiddleware;
    installMode: string;
    PKG_ROOT: string;
    os: OsDeps;
    spawn: SpawnDeps;
}

export function registerSystemRoutes(deps: SystemRouteDeps): void {
    /**
     * PURPOSE: Preserve the existing update command behavior while moving the
     * business URL ownership out of server bootstrap.
     */
    const { app, authenticateToken, installMode, PKG_ROOT, os, spawn } = deps;

    app.post('/api/system/update', authenticateToken, async (_req: any, res: any) => {
        try {
            const projectRoot = PKG_ROOT;

            console.log('Starting system update from directory:', projectRoot);

            const updateCommand = installMode === 'git'
                ? 'git checkout main && git pull && pnpm install'
                : 'npm install -g ozw@latest';

            const child = spawn('sh', ['-c', updateCommand], {
                cwd: installMode === 'git' ? projectRoot : os.homedir(),
                env: process.env,
            });

            let output = '';
            let errorOutput = '';

            child.stdout.on('data', (data: Buffer) => {
                const text = data.toString();
                output += text;
                console.log('Update output:', text);
            });

            child.stderr.on('data', (data: Buffer) => {
                const text = data.toString();
                errorOutput += text;
                console.error('Update error:', text);
            });

            child.on('close', (code: number | null) => {
                if (code === 0) {
                    res.json({
                        success: true,
                        output: output || 'Update completed successfully',
                        message: 'Update completed. Please restart the server to apply changes.',
                    });
                    return;
                }

                res.status(500).json({
                    success: false,
                    error: 'Update command failed',
                    output,
                    errorOutput,
                });
            });

            child.on('error', (error: Error) => {
                console.error('Update process error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message,
                });
            });
        } catch (error: any) {
            console.error('System update error:', error);
            res.status(500).json({
                success: false,
                error: error.message,
            });
        }
    });
}
