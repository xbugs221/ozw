/**
 * 文件目的：定义 provider 用量余量和单会话 token usage API 的注册边界。
 * 业务意义：用量 API 读取 provider 本地状态，需要独立审计输入清洗和 provider 分支。
 */

/**
 * 注册用量相关 HTTP 路由。
 */
export function registerUsageRoutes(deps: any): void {
    /**
     * PURPOSE: Keep provider usage URLs in a small boundary where session id
     * sanitization and provider branching are easy to audit.
     */
    const { app, authenticateToken, handlers } = deps;
    app.get('/api/usage/remaining', authenticateToken, handlers.getUsageRemaining);
    app.get('/api/projects/:projectName/sessions/:sessionId/token-usage', authenticateToken, handlers.getSessionTokenUsage);
}
