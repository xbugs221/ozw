/**
 * 文件目的：定义项目列表、项目概览和项目级变更 API 的注册边界。
 * 业务意义：项目读写会触发缓存、watcher 和 project invalidation，不应隐藏在服务入口中。
 */

/**
 * 注册项目相关 HTTP 路由。
 */
export function registerProjectRoutes(deps: any): void {
    /**
     * PURPOSE: Keep project URL ownership in this module while preserving the
     * bootstrap-provided business handlers and middleware.
     */
    const { app, authenticateToken, handlers } = deps;
    app.get('/api/projects', authenticateToken, handlers.listProjects);
    app.get('/api/projects/:projectName/overview', authenticateToken, handlers.getProjectOverview);
    app.put('/api/projects/:projectName/rename', authenticateToken, handlers.renameProject);
    app.delete('/api/projects/:projectName', authenticateToken, handlers.deleteProject);
    app.post('/api/projects/create', authenticateToken, handlers.createProject);
}
