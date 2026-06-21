/**
 * 文件目的：定义项目 workflow 列表、详情、创建、恢复和终止 API 的注册边界。
 * 业务意义：route module 直接声明自身依赖，避免通过宽泛依赖隐藏权限边界。
 */

import type {
    AuthMiddleware,
    FsPromisesDeps,
    HeavyReadCoalescer,
    HttpRouteApp,
    LooseRecord,
    ProjectInvalidationEvent,
    ProjectLike,
    WorkflowLike,
} from './route-deps.js';

export interface WorkflowRouteDeps {
    app: HttpRouteApp;
    authenticateToken: AuthMiddleware;
    heavyReadCoalescer: HeavyReadCoalescer;
    fsPromises: FsPromisesDeps;
    extractProjectDirectory: (projectName: string) => Promise<string>;
    listProjectWorkflows: (projectPath: string) => Promise<WorkflowLike[]>;
    summarizeWorkflowForProjectList: (workflow: WorkflowLike) => WorkflowLike;
    getProjects: () => Promise<ProjectLike[]>;
    attachWorkflowMetadata: (project: ProjectLike) => Promise<ProjectLike> | ProjectLike;
    findProjectByName: (projectName: string) => ProjectLike | Promise<ProjectLike | null> | null;
    createProjectWorkflow: (project: ProjectLike, request: { title: unknown; objective: unknown; openspecChangeName: unknown }) => Promise<WorkflowLike>;
    watchGoWorkflowRun: (project: ProjectLike, workflow: WorkflowLike) => Promise<unknown>;
    broadcastProjectListInvalidated: (event: ProjectInvalidationEvent) => unknown;
    listProjectAdoptableOpenSpecChanges: (project: ProjectLike) => Promise<unknown[]>;
    getProjectWorkflow: (project: ProjectLike, workflowId: string) => Promise<WorkflowLike | null>;
    resumeWorkflowRun: (project: ProjectLike, workflowId: string) => Promise<WorkflowLike | null>;
    abortWorkflowRun: (project: ProjectLike, workflowId: string) => Promise<WorkflowLike | null>;
}

/**
 * 注册 workflow 相关 HTTP 路由。
 */
export function registerWorkflowRoutes(deps: WorkflowRouteDeps): void {
    const { app, authenticateToken, heavyReadCoalescer, fsPromises, extractProjectDirectory, listProjectWorkflows, summarizeWorkflowForProjectList, getProjects, createProjectWorkflow, watchGoWorkflowRun, broadcastProjectListInvalidated, listProjectAdoptableOpenSpecChanges, getProjectWorkflow, resumeWorkflowRun, abortWorkflowRun } = deps;

const listWorkflowsHandler = async (req: any, res: any) => {
    try {
        const workflows = await heavyReadCoalescer.run(`projects:workflows:${req.params.projectName}`, async () => {
            // Resolve only the requested project; the sidebar summary endpoint
            // already watches all discovered projects after /api/projects.
            const projectPath = await resolveExistingWorkflowProjectPath(
                String(req.params.projectName),
                typeof req.query?.projectPath === 'string' ? req.query.projectPath : '',
            );
            if (!projectPath) {
                return null;
            }
            try {
                const stat = await fsPromises.stat(projectPath);
                if (!stat.isDirectory()) {
                    return null;
                }
            } catch {
                return null;
            }
            return (await listProjectWorkflows(projectPath)).map(summarizeWorkflowForProjectList);
        });
        if (!workflows) {
            return res.status(404).json({ error: 'Project not found' });
        }
        res.json(workflows);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Resolve a project-scoped workflow request to an existing project directory.
 */
async function resolveExistingWorkflowProjectPath(projectName: string, requestedProjectPath = '') {
    /**
     * PURPOSE: Support both reversible legacy project names and live-only
     * project route identifiers whose synthetic names cannot be decoded.
     */
    const normalizedRequestedPath = typeof requestedProjectPath === 'string' ? requestedProjectPath.trim() : '';
    if (normalizedRequestedPath) {
        try {
            const stat = await fsPromises.stat(normalizedRequestedPath);
            if (stat.isDirectory()) {
                return normalizedRequestedPath;
            }
        } catch {
            // Fall through to legacy name resolution and project-list lookup.
        }
    }

    const extractedPath = await extractProjectDirectory(projectName);
    try {
        const stat = await fsPromises.stat(extractedPath);
        if (stat.isDirectory()) {
            return extractedPath;
        }
    } catch {
        // Fall through to the authoritative project list mapping.
    }

    const projects = await getProjects();
    const matchedProject = projects.find((project: any) => (
        project.name === projectName
        || project.routePath === projectName
        || project.fullPath === projectName
        || project.path === projectName
    ));
    const projectPath = matchedProject?.fullPath || matchedProject?.path || '';
    if (!projectPath) {
        return '';
    }
    try {
        const stat = await fsPromises.stat(projectPath);
        return stat.isDirectory() ? projectPath : '';
    } catch {
        return '';
    }
}

const createWorkflowHandler = async (req: any, res: any) => {
    try {
        const requestedProjectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath : '';
        const projectPath = await resolveExistingWorkflowProjectPath(String(req.params.projectName), requestedProjectPath);
        if (!projectPath) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const project = { name: req.params.projectName, fullPath: projectPath, path: projectPath };

        const workflow = await createProjectWorkflow(project, {
            title: req.body?.title,
            objective: req.body?.objective,
            openspecChangeName: req.body?.openspecChangeName,
        });
        await watchGoWorkflowRun(project, workflow);
        void broadcastProjectListInvalidated({ reason: 'workflow-create', changedProjectPath: project.fullPath || project.path || '' });
        res.status(201).json(workflow);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

const listOpenSpecChangesHandler = async (req: any, res: any) => {
    try {
        // Lightweight path resolution: avoid full getProjects() + attachWorkflowMetadata()
        // which scans all provider sessions across every project (~2.7s overhead).
        const requestedProjectPath = typeof req.query?.projectPath === 'string'
            ? req.query.projectPath.trim()
            : '';
        const projectPath = requestedProjectPath || await extractProjectDirectory(req.params.projectName);
        // Validate the resolved path points to a real project directory.
        // extractProjectDirectory can map arbitrary strings to paths via the
        // dash-to-slash fallback; unknown project names must still return 404.
        try {
            const stat = await fsPromises.stat(projectPath);
            if (!stat.isDirectory()) {
                return res.status(404).json({ error: 'Project not found' });
            }
        } catch {
            return res.status(404).json({ error: 'Project not found' });
        }
        const changes = await listProjectAdoptableOpenSpecChanges({ fullPath: projectPath, name: req.params.projectName });
        res.json({ changes });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

const getWorkflowHandler = async (req: any, res: any) => {
    try {
        const workflow = await heavyReadCoalescer.run(
            `projects:workflow:${req.params.projectName}:${req.params.workflowId}`,
            async () => {
                const projectPath = await resolveExistingWorkflowProjectPath(
                    String(req.params.projectName),
                    typeof req.query?.projectPath === 'string' ? req.query.projectPath : '',
                );
                if (!projectPath) {
                    return { missingProject: true };
                }

                const project = { name: req.params.projectName, fullPath: projectPath, path: projectPath };
                return getProjectWorkflow(project, req.params.workflowId);
            },
        );
        if ((workflow as LooseRecord)?.missingProject) {
            return res.status(404).json({ error: 'Project not found' });
        }
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json(workflow);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

const resumeWorkflowRunHandler = async (req: any, res: any) => {
    try {
        const requestedProjectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath : '';
        const projectPath = await resolveExistingWorkflowProjectPath(String(req.params.projectName), requestedProjectPath);
        if (!projectPath) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const project = { name: req.params.projectName, fullPath: projectPath, path: projectPath };

        const workflow = await resumeWorkflowRun(project, req.params.workflowId);
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        await watchGoWorkflowRun(project, workflow);
        res.json({ success: true, workflow });
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
};

const abortWorkflowRunHandler = async (req: any, res: any) => {
    try {
        const requestedProjectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath : '';
        const projectPath = await resolveExistingWorkflowProjectPath(String(req.params.projectName), requestedProjectPath);
        if (!projectPath) {
            return res.status(404).json({ error: 'Project not found' });
        }
        const project = { name: req.params.projectName, fullPath: projectPath, path: projectPath };

        const workflow = await abortWorkflowRun(project, req.params.workflowId);
        if (!workflow) {
            return res.status(404).json({ error: 'Workflow not found' });
        }

        res.json({ success: true, workflow });
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ error: error.message });
    }
};


    app.get('/api/projects/:projectName/workflows', authenticateToken, listWorkflowsHandler);
    app.post('/api/projects/:projectName/workflows', authenticateToken, createWorkflowHandler);
    app.get('/api/projects/:projectName/openspec/changes', authenticateToken, listOpenSpecChangesHandler);
    app.get('/api/projects/:projectName/workflows/:workflowId', authenticateToken, getWorkflowHandler);
    app.post('/api/projects/:projectName/workflows/:workflowId/resume-run', authenticateToken, resumeWorkflowRunHandler);
    app.post('/api/projects/:projectName/workflows/:workflowId/abort-run', authenticateToken, abortWorkflowRunHandler);
}
