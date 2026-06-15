/**
 * 文件目的：定义会话消息、搜索、重命名、删除和 UI/model 状态 API 的注册边界。
 * 业务意义：会话 API 与 realtime 私有投递强相关，需要独立边界便于审查所有权。
 */

/**
 * 注册会话相关 HTTP 路由。
 */
export function registerSessionRoutes(deps: any): void {
    /**
     * PURPOSE: Route session ownership through one registration boundary so
     * realtime-sensitive handlers stay visible during review.
     */
    const { app, authenticateToken, handlers } = deps;
    app.get('/api/projects/:projectName/sessions', authenticateToken, handlers.listLegacySessions);
    app.get('/api/projects/:projectName/sessions/:sessionId/messages', authenticateToken, handlers.getSessionMessages);
    app.get('/api/chat/search', authenticateToken, handlers.searchChatHistory);
    app.put('/api/projects/:projectName/sessions/:sessionId/rename', authenticateToken, handlers.renameSession);
    app.put('/api/projects/:projectName/sessions/:sessionId/ui-state', authenticateToken, handlers.updateSessionUiState);
    app.get('/api/projects/:projectName/sessions/:sessionId/model-state', authenticateToken, handlers.getSessionModelState);
    app.put('/api/projects/:projectName/sessions/:sessionId/model-state', authenticateToken, handlers.updateSessionModelState);
    app.post('/api/projects/:projectName/manual-sessions', authenticateToken, handlers.createManualSession);
    app.post('/api/projects/:projectName/manual-sessions/:sessionId/finalize', authenticateToken, handlers.finalizeManualSession);
    app.delete('/api/projects/:projectName/sessions/:sessionId', authenticateToken, handlers.deleteSession);
}
