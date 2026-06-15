/**
 * 文件目的：定义项目 workflow 列表、详情、创建、恢复和终止 API 的注册边界。
 * 业务意义：workflow 生命周期依赖 Go runner watcher，应与通用项目 API 和服务启动解耦。
 */

/**
 * 注册 workflow 相关 HTTP 路由。
 */
export function registerWorkflowRoutes(deps: any): void {
    /**
     * PURPOSE: Keep workflow lifecycle URLs grouped with their runner watcher
     * behavior instead of hiding route ownership in the backend entry.
     */
    const { app, authenticateToken, handlers } = deps;
    app.get('/api/projects/:projectName/workflows', authenticateToken, handlers.listWorkflows);
    app.post('/api/projects/:projectName/workflows', authenticateToken, handlers.createWorkflow);
    app.get('/api/projects/:projectName/openspec/changes', authenticateToken, handlers.listOpenSpecChanges);
    app.get('/api/projects/:projectName/workflows/:workflowId', authenticateToken, handlers.getWorkflow);
    app.post('/api/projects/:projectName/workflows/:workflowId/resume-run', authenticateToken, handlers.resumeWorkflowRun);
    app.post('/api/projects/:projectName/workflows/:workflowId/abort-run', authenticateToken, handlers.abortWorkflowRun);
}
