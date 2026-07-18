/**
 * 文件目的：定义项目列表、项目概览和项目级变更 API 的注册边界。
 * 业务意义：route module 直接声明自身依赖，避免通过宽泛依赖隐藏权限边界。
 */

import type {
    AuthMiddleware,
    HeavyReadCoalescer,
    HttpRouteApp,
    ProjectInvalidationEvent,
    ProjectLike,
    WorkflowLike,
} from './route-deps.js';

export interface ProjectRouteDeps {
    app: HttpRouteApp;
    authenticateToken: AuthMiddleware;
    heavyReadCoalescer: HeavyReadCoalescer;
    getProjects: (broadcastProgress?: unknown, options?: { lightweightList?: boolean }) => Promise<ProjectLike[]>;
    broadcastProgress: unknown;
    summarizeProjectForList: (project: ProjectLike) => ProjectLike;
    ensureGoRunnerWatchersForProjects: (projects: ProjectLike[], watchGoWorkflowRun: (project: ProjectLike, workflow: WorkflowLike) => Promise<unknown>) => Promise<unknown>;
    watchGoWorkflowRun: (project: ProjectLike, workflow: WorkflowLike) => Promise<unknown>;
    resolveProjectOverviewTarget: (projectName: string, projectPathHint: unknown) => Promise<ProjectLike | null>;
    buildProjectOverviewReadModel: (project: ProjectLike, options: {
        summarizeProjectForList: (project: ProjectLike) => ProjectLike;
        attachWorkflowMetadata: (projects: ProjectLike[]) => Promise<ProjectLike[]>;
        getCodexSessions: (projectPath?: string) => Promise<unknown[]> | unknown[];
        getPiSessions: (projectPath?: string) => Promise<unknown[]> | unknown[];
        getClaudeSessions?: (projectPath?: string) => Promise<unknown[]> | unknown[];
    }) => Promise<ProjectLike>;
    attachWorkflowMetadata: (projects: ProjectLike[]) => Promise<ProjectLike[]>;
    attachProjectOverviewWorkflowMetadata?: (projects: ProjectLike[]) => Promise<ProjectLike[]>;
    syncProjectWorkflowOverviewIndex?: (projectPath: string) => Promise<unknown>;
    getCodexSessions: (projectPath?: string) => Promise<unknown[]> | unknown[];
    getPiSessions: (projectPath?: string) => Promise<unknown[]> | unknown[];
    getClaudeSessions: (projectPath?: string) => Promise<unknown[]> | unknown[];
    extractProjectDirectory: (projectName: string) => Promise<string>;
    renameProject: (projectName: string, displayName: string, projectPath?: string) => Promise<unknown>;
    deleteProject: (projectName: string, force: boolean, projectPath?: string) => Promise<unknown>;
    addProjectManually: (projectPath: string) => Promise<ProjectLike>;
    broadcastProjectListInvalidated: (event: ProjectInvalidationEvent) => unknown;
}

/**
 * 注册项目相关 HTTP 路由。
 */
export function registerProjectRoutes(deps: ProjectRouteDeps): void {
    const { app, authenticateToken, heavyReadCoalescer, getProjects, broadcastProgress, summarizeProjectForList, ensureGoRunnerWatchersForProjects, watchGoWorkflowRun, resolveProjectOverviewTarget, buildProjectOverviewReadModel, attachWorkflowMetadata, attachProjectOverviewWorkflowMetadata, syncProjectWorkflowOverviewIndex, getCodexSessions, getPiSessions, getClaudeSessions, extractProjectDirectory, renameProject, deleteProject, addProjectManually, broadcastProjectListInvalidated } = deps;

const listProjectsHandler = async (req: any, res: any) => {
    try {
        const projectSummaries = await heavyReadCoalescer.run('projects:list', async () => {
            const projects = await getProjects(broadcastProgress, { lightweightList: true });
            return projects.map(summarizeProjectForList);
        });
        res.json(projectSummaries);

        void ensureGoRunnerWatchersForProjects(projectSummaries, watchGoWorkflowRun).catch((error: any) => {
            console.warn('[projects] Background watcher registration failed:', error?.message || error);
        });
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
};

const getProjectOverviewHandler = async (req: any, res: any) => {
    try {
        const scopeProjectPath = typeof req.query?.projectPath === 'string' ? req.query.projectPath.trim() : '';
        const overview = await heavyReadCoalescer.run(`projects:overview:${scopeProjectPath || req.params.projectName}`, async () => {
            const project = await resolveProjectOverviewTarget(
                String(req.params.projectName || ''),
                req.query?.projectPath,
            );
            if (!project) {
                return null;
            }

            const projectPath = project.fullPath || project.path || '';
            if (projectPath && typeof syncProjectWorkflowOverviewIndex === 'function') {
                await syncProjectWorkflowOverviewIndex(projectPath);
            }

            return buildProjectOverviewReadModel(project, {
                summarizeProjectForList,
                attachWorkflowMetadata: attachProjectOverviewWorkflowMetadata || attachWorkflowMetadata,
                getCodexSessions,
                getPiSessions,
                getClaudeSessions,
            });
        });
        if (!overview) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json(overview);

        void ensureGoRunnerWatchersForProjects([overview], watchGoWorkflowRun).catch((error: any) => {
            console.warn('[projects:overview] Background watcher registration failed:', error?.message || error);
        });
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
};


// Rename project endpoint
const renameProjectHandler = async (req: any, res: any) => {
    try {
        const { displayName, projectPath } = req.body;
        const oldProjectPath = await extractProjectDirectory(req.params.projectName);
        await renameProject(req.params.projectName, displayName, projectPath);
        void broadcastProjectListInvalidated({ reason: 'project-rename', changedProjectPath: oldProjectPath });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};


// Delete project endpoint (force=true to delete with sessions)
const deleteProjectHandler = async (req: any, res: any) => {
    try {
        const { projectName } = req.params;
        const force = req.query.force === 'true';
        const projectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath.trim() : '';
        const deletedProjectPath = projectPath || await extractProjectDirectory(projectName);
        await deleteProject(projectName, force, projectPath);
        void broadcastProjectListInvalidated({ reason: 'project-delete', changedProjectPath: deletedProjectPath });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};


// Create project endpoint
const createProjectHandler = async (req: any, res: any) => {
    try {
        const { path: projectPath } = req.body;

        if (!projectPath || !projectPath.trim()) {
            return res.status(400).json({ error: 'Project path is required' });
        }

        const project = await addProjectManually(projectPath.trim());
        void broadcastProjectListInvalidated({ reason: 'project-create', changedProjectPath: projectPath.trim() });
        res.json({ success: true, project });
    } catch (error: any) {
        console.error('Error creating project:', error);
        res.status(500).json({ error: error.message });
    }
};


    app.get('/api/projects', authenticateToken, listProjectsHandler);
    app.get('/api/projects/:projectName/overview', authenticateToken, getProjectOverviewHandler);
    app.put('/api/projects/:projectName/rename', authenticateToken, renameProjectHandler);
    app.delete('/api/projects/:projectName', authenticateToken, deleteProjectHandler);
    app.post('/api/projects/create', authenticateToken, createProjectHandler);
}
