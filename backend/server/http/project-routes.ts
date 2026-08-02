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
    listUnscopedHermesSessions: () => Promise<{ sessions: unknown[]; diagnostics: unknown[] }>;
}

/**
 * 注册项目相关 HTTP 路由。
 */
export function registerProjectRoutes(deps: ProjectRouteDeps): void {
    const { app, authenticateToken, heavyReadCoalescer, getProjects, broadcastProgress, summarizeProjectForList, ensureGoRunnerWatchersForProjects, watchGoWorkflowRun, resolveProjectOverviewTarget, buildProjectOverviewReadModel, attachWorkflowMetadata, attachProjectOverviewWorkflowMetadata, syncProjectWorkflowOverviewIndex, getCodexSessions, getPiSessions, getClaudeSessions, extractProjectDirectory, renameProject, deleteProject, addProjectManually, broadcastProjectListInvalidated, listUnscopedHermesSessions } = deps;
    let cachedUnscopedHermes = { sessions: [] as unknown[], diagnostics: [] as unknown[] };
    let unscopedHermesRefresh: Promise<{ sessions: unknown[]; diagnostics: unknown[] }> | null = null;

    /**
     * Refresh optional Hermes history once without putting its disk scan on the
     * lightweight project-list response path.
     */
    const refreshUnscopedHermes = async () => {
        /** PURPOSE: Coalesce slow NAS reads while keeping the last complete snapshot visible. */
        if (unscopedHermesRefresh) {
            return unscopedHermesRefresh;
        }
        unscopedHermesRefresh = Promise.resolve(listUnscopedHermesSessions())
            .then((snapshot) => {
                cachedUnscopedHermes = snapshot;
                return snapshot;
            })
            .finally(() => {
                unscopedHermesRefresh = null;
            });
        return unscopedHermesRefresh;
    };

const listProjectsHandler = async (req: any, res: any) => {
    try {
        const projectSummaries = await heavyReadCoalescer.run('projects:list', async () => {
            const projects = await getProjects(broadcastProgress, { lightweightList: true });
            const summaries = projects.map(summarizeProjectForList);
            if (cachedUnscopedHermes.sessions.length > 0) {
                summaries.push({
                    name: 'hermes-unscoped',
                    displayName: '未归属 Hermes 会话',
                    path: '',
                    fullPath: '',
                    routePath: '/hermes-unscoped',
                    source: 'hermes-unscoped',
                    readOnlyProviderCollection: true,
                    sessions: [],
                    sessionMeta: { hasMore: false, total: cachedUnscopedHermes.sessions.length },
                });
            }
            return summaries;
        });
        res.json(projectSummaries);

        const previousHermesCount = cachedUnscopedHermes.sessions.length;
        setImmediate(() => {
            /** PURPOSE: Let the HTTP response flush before optional SQLite, filesystem, and watcher work starts. */
            void refreshUnscopedHermes()
                .then((snapshot) => {
                    if (snapshot.sessions.length !== previousHermesCount) {
                        void broadcastProjectListInvalidated({ reason: 'hermes-unscoped-refresh' });
                    }
                })
                .catch((error: any) => {
                    console.warn('[projects] Background Hermes refresh failed:', error?.message || error);
                });
            void ensureGoRunnerWatchersForProjects(projectSummaries, watchGoWorkflowRun).catch((error: any) => {
                console.warn('[projects] Background watcher registration failed:', error?.message || error);
            });
        });
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
};

const getProjectOverviewHandler = async (req: any, res: any) => {
    try {
        const scopeProjectPath = typeof req.query?.projectPath === 'string' ? req.query.projectPath.trim() : '';
        const overview = await heavyReadCoalescer.run(`projects:overview:${scopeProjectPath || req.params.projectName}`, async () => {
            if (req.params.projectName === 'hermes-unscoped') {
                const unscoped = await refreshUnscopedHermes();
                return {
                    name: 'hermes-unscoped',
                    displayName: '未归属 Hermes 会话',
                    path: '',
                    fullPath: '',
                    routePath: '/hermes-unscoped',
                    source: 'hermes-unscoped',
                    readOnlyProviderCollection: true,
                    sessions: [], codexSessions: [], piSessions: [], claudeSessions: [],
                    hermesSessions: unscoped.sessions,
                    hermesDiagnostics: unscoped.diagnostics,
                    workflows: [], batches: [],
                    sessionMeta: { hasMore: false, total: unscoped.sessions.length },
                };
            }
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

        setImmediate(() => {
            /** PURPOSE: Flush the overview response before watcher setup touches project storage. */
            void ensureGoRunnerWatchersForProjects([overview], watchGoWorkflowRun).catch((error: any) => {
                console.warn('[projects:overview] Background watcher registration failed:', error?.message || error);
            });
        });
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
};


// Rename project endpoint
const renameProjectHandler = async (req: any, res: any) => {
    try {
        if (req.params.projectName === 'hermes-unscoped') {
            return res.status(405).json({ error: 'Read-only provider collections cannot be renamed' });
        }
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
        if (projectName === 'hermes-unscoped') {
            return res.status(405).json({ error: 'Read-only provider collections cannot be deleted' });
        }
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
    app.get('/api/hermes/unscoped-sessions', authenticateToken, async (_req: any, res: any) => {
        try {
            res.json(await refreshUnscopedHermes());
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });
    app.get('/api/projects/:projectName/overview', authenticateToken, getProjectOverviewHandler);
    app.put('/api/projects/:projectName/rename', authenticateToken, renameProjectHandler);
    app.delete('/api/projects/:projectName', authenticateToken, deleteProjectHandler);
    app.post('/api/projects/create', authenticateToken, createProjectHandler);
}
