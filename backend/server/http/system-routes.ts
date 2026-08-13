/**
 * 文件目的：定义系统更新 HTTP API 的注册边界。
 * 业务意义：保留旧路由兼容性，但只告知手动升级方式，绝不在服务进程内执行供应链命令。
 */

import type {
    AuthMiddleware,
    HttpRouteApp,
} from './route-deps.js';

export interface SystemRouteDeps {
    app: HttpRouteApp;
    authenticateToken: AuthMiddleware;
    installMode: string;
}

/**
 * Return the documented manual upgrade command for the detected install mode.
 */
export function getManualUpgradeCommand(installMode: string): string {
    return installMode === 'git'
        ? 'git pull --ff-only && pnpm install && pnpm run build'
        : 'npm update -g ozw';
}

/**
 * Register the compatibility route without granting it process execution.
 */
export function registerSystemRoutes(deps: SystemRouteDeps): void {
    const { app, authenticateToken, installMode } = deps;

    app.post('/api/system/update', authenticateToken, (_req: any, res: any) => {
        const message = 'Automatic updates are disabled. Run the command manually, then restart ozw.';
        res.status(409).json({
            success: false,
            manual: true,
            code: 'MANUAL_UPDATE_REQUIRED',
            command: getManualUpgradeCommand(installMode),
            message,
            error: message,
        });
    });
}
