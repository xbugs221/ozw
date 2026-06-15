/**
 * 文件目的：注册从 bootstrap 拆出的后端业务 HTTP handler 组。
 * 业务意义：项目、工作流、会话、附件和用量接口拥有较多业务编排逻辑，应独立于服务启动入口。
 */
import { registerFileRoutes } from './file-routes.js';
import { registerAttachmentRoutes } from './http/attachment-routes.js';
import { registerProjectRoutes } from './http/project-routes.js';
import { registerSessionRoutes } from './http/session-routes.js';
import { registerUsageRoutes } from './http/usage-routes.js';
import { registerWorkflowRoutes } from './http/workflow-routes.js';

type LooseRecord = Record<string, any>;

/**
 * 注册后端业务 HTTP route 和对应 handler。
 */
export function registerBackendHttpRoutes(deps: any): void {
    /**
     * PURPOSE: Keep business handler orchestration outside bootstrap while
     * preserving dependency injection from the runtime assembly layer.
     */
    const {
        app, authenticateToken, path, fs, fsPromises, WORKSPACES_ROOT, validateWorkspacePath,
        resolveProjectRootWithHint, resolveReadableProjectPath, resolveProjectPath, buildMutationResponse,
        joinProjectChildPath, sanitizeEntryName, sanitizeUploadRelativePath, createDirectoryArchive,
        sendDownload, withLoggedFallback, classifyProjectFile, TEXT_SAMPLE_BYTES, mime,
        heavyReadCoalescer, getProjects, broadcastProgress, summarizeProjectForList,
        ensureGoRunnerWatchersForProjects, watchGoWorkflowRun, resolveProjectOverviewTarget,
        buildProjectOverviewReadModel, attachWorkflowMetadata, getCodexSessions, getPiSessions,
        extractProjectDirectory, listProjectWorkflows, summarizeWorkflowForProjectList, getProjectWorkflow,
        createProjectWorkflow, listProjectAdoptableOpenSpecChanges, resumeWorkflowRun, abortWorkflowRun,
        findProjectByName, handleGetSessionMessages, searchChatHistory, renameProject, renameSession,
        updateSessionUiState, getSessionModelState, updateSessionModelState, broadcastSessionModelStateUpdated,
        normalizeManualProvider, createManualSessionDraft, finalizeManualSessionRoute, getUsageRemaining,
        deleteSession, broadcastProjectListInvalidated, deleteProject, addProjectManually, fetch,
        CHAT_UPLOAD_ROOT, sanitizeFilename, persistChatUploads, os, getCodexSessionTokenUsage,
    } = deps;

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

                return buildProjectOverviewReadModel(project, {
                    summarizeProjectForList,
                    attachWorkflowMetadata,
                    getCodexSessions,
                    getPiSessions,
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

    const listWorkflowsHandler = async (req: any, res: any) => {
        try {
            const workflows = await heavyReadCoalescer.run(`projects:workflows:${req.params.projectName}`, async () => {
                // Resolve only the requested project; the sidebar summary endpoint
                // already watches all discovered projects after /api/projects.
                const projectPath = await extractProjectDirectory(req.params.projectName);
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
            const projects = await attachWorkflowMetadata(await getProjects());
            const project = findProjectByName(projects, req.params.projectName);
            if (!project) {
                return res.status(404).json({ error: 'Project not found' });
            }

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
            const projects = await attachWorkflowMetadata(await getProjects());
            const project = findProjectByName(projects, req.params.projectName);
            if (!project) {
                return res.status(404).json({ error: 'Project not found' });
            }

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
            const projects = await attachWorkflowMetadata(await getProjects());
            const project = findProjectByName(projects, req.params.projectName);
            if (!project) {
                return res.status(404).json({ error: 'Project not found' });
            }

            const workflow = await abortWorkflowRun(project, req.params.workflowId);
            if (!workflow) {
                return res.status(404).json({ error: 'Workflow not found' });
            }

            res.json({ success: true, workflow });
        } catch (error: any) {
            res.status(error.statusCode || 500).json({ error: error.message });
        }
    };

    const listLegacySessionsHandler = async (_req: any, res: any) => {
        res.status(410).json({ error: 'Claude sessions are no longer supported' });
    };

    // Get messages for a specific session
    const getSessionMessagesHandler = handleGetSessionMessages;

    // Search across visible chat history messages for supported provider sessions.
    const searchChatHistoryHandler = async (req: any, res: any) => {
        try {
            const query = typeof req.query.q === 'string' ? req.query.q : '';
            const mode = req.query.mode === 'jsonl' ? 'jsonl' : 'content';
            const results = await heavyReadCoalescer.run(
                `search:chat:${mode}:${query.trim()}`,
                async () => searchChatHistory(query, mode),
            );
            res.json({ success: true, results });
        } catch (error: any) {
            console.error('Error searching chat history:', error);
            res.status(500).json({ success: false, error: error.message });
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

    // Rename chat session endpoint
    const renameSessionHandler = async (req: any, res: any) => {
        try {
            const { summary, projectPath } = req.body;
            if (typeof summary !== 'string' || !summary.trim()) {
                return res.status(400).json({ error: 'Session summary is required' });
            }

            await renameSession(req.params.projectName, req.params.sessionId, summary, typeof projectPath === 'string' ? projectPath : '');
            void broadcastProjectListInvalidated({ reason: 'session-rename', changedProjectPath: await extractProjectDirectory(req.params.projectName) });
            res.json({ success: true });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    };

    const updateSessionUiStateHandler = async (req: any, res: any) => {
        try {
            const provider = normalizeManualProvider(req.body?.provider || 'codex');
            const projectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath.trim() : '';
            const state = await updateSessionUiState(req.params.projectName, req.params.sessionId, provider, {
                favorite: req.body?.favorite === true,
                pending: req.body?.pending === true,
                hidden: req.body?.hidden === true,
            }, projectPath);
            void broadcastProjectListInvalidated({
                reason: 'session-ui-state',
                changedProjectPath: projectPath || await extractProjectDirectory(req.params.projectName),
            });
            res.json({ success: true, state });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    };

    /**
     * Resolve the project config path used for session-scoped control state.
     */
    async function resolveSessionModelProjectPath(projectName: string, candidatePath = '') {
        if (typeof candidatePath === 'string' && candidatePath.trim()) {
            return candidatePath.trim();
        }
        return extractProjectDirectory(projectName);
    }

    const getSessionModelStateHandler = async (req: any, res: any) => {
        try {
            const projectPath = await resolveSessionModelProjectPath(
                String(req.params.projectName),
                typeof req.query?.projectPath === 'string' ? req.query.projectPath : '',
            );
            const state = await (getSessionModelState as any)(projectPath, String(req.params.sessionId));
            res.json({ success: true, state });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    };

    const updateSessionModelStateHandler = async (req: any, res: any) => {
        try {
            const projectPath = await resolveSessionModelProjectPath(
                String(req.params.projectName),
                typeof req.body?.projectPath === 'string' ? req.body.projectPath : '',
            );
            const state = await (updateSessionModelState as any)(projectPath, String(req.params.sessionId), {
                model: typeof req.body?.model === 'string' ? req.body.model : '',
                reasoningEffort: typeof req.body?.reasoningEffort === 'string' ? req.body.reasoningEffort : '',
                thinkingLevel: typeof req.body?.thinkingLevel === 'string' ? req.body.thinkingLevel : '',
                thinkingMode: typeof req.body?.thinkingMode === 'string' ? req.body.thinkingMode : '',
            });
            broadcastSessionModelStateUpdated({
                sourceUserId: req.user?.id || null,
                projectName: req.params.projectName,
                projectPath,
                sessionId: req.params.sessionId,
                provider: normalizeManualProvider(req.body?.provider || 'codex'),
                state,
            });
            res.json({ success: true, state });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    };

    const createManualSessionHandler = async (req: any, res: any) => {
        try {
            const provider = normalizeManualProvider(req.body?.provider);
            const label = typeof req.body?.label === 'string' ? req.body.label : '';
            const projectPath = typeof req.body?.projectPath === 'string' ? req.body.projectPath : '';
            const workflowId = typeof req.body?.workflowId === 'string' ? req.body.workflowId : '';
            const stageKey = typeof req.body?.stageKey === 'string' ? req.body.stageKey : '';
            const routeIndex = Number(req.body?.routeIndex);

            if (!label.trim()) {
                return res.status(400).json({ error: 'Session label is required' });
            }

            const session = await createManualSessionDraft(req.params.projectName, projectPath, provider, label, {
                workflowId,
                stageKey,
                routeIndex: Number.isInteger(routeIndex) && routeIndex > 0 ? routeIndex : undefined,
            });
            res.json({ success: true, session });
        } catch (error: any) {
            const status = /provider must/.test(error.message) ? 400 : 500;
            res.status(status).json({ error: error.message });
        }
    };

    const finalizeManualSessionHandler = async (req: any, res: any) => {
        try {
            const provider = normalizeManualProvider(req.body?.provider);
            const actualSessionId = typeof req.body?.actualSessionId === 'string' ? req.body.actualSessionId : '';

            if (!actualSessionId.trim()) {
                return res.status(400).json({ error: 'Actual session ID is required' });
            }

            const finalized = await finalizeManualSessionRoute(
                req.params.projectName,
                req.params.sessionId,
                actualSessionId,
                provider,
                typeof req.body?.projectPath === 'string' ? req.body.projectPath : '',
            );
            res.json({ success: true, finalized });
        } catch (error: any) {
            const status = /provider must/.test(error.message) ? 400 : 500;
            res.status(status).json({ error: error.message });
        }
    };

    // Get provider-level usage remaining metrics for UI status display.
    const getUsageRemainingHandler = async (req: any, res: any) => {
        try {
            const provider = normalizeManualProvider(req.query.provider || 'codex');
            const usageRemaining = await getUsageRemaining(provider);
            res.json(usageRemaining);
        } catch (error: any) {
            console.error('Error reading usage remaining:', error);
            res.status(500).json({ error: 'Failed to read usage remaining' });
        }
    };

    // Delete session endpoint
    const deleteSessionHandler = async (req: any, res: any) => {
        try {
            const { projectName, sessionId } = req.params;
            const provider = req.query.provider ? normalizeManualProvider(req.query.provider) : null;
            console.log(`[API] Deleting session: ${sessionId} from project: ${projectName}`);
            const sessionProjectPath = await extractProjectDirectory(projectName);
            await (deleteSession as any)(projectName, sessionId, provider);
            console.log(`[API] Session ${sessionId} deleted successfully`);
            void broadcastProjectListInvalidated({ reason: 'session-delete', changedProjectPath: sessionProjectPath });
            res.json({ success: true });
        } catch (error: any) {
            console.error(`[API] Error deleting session ${req.params.sessionId}:`, error);
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

    registerFileRoutes({
        app, authenticateToken, path, fs, fsPromises, WORKSPACES_ROOT, validateWorkspacePath,
        resolveProjectRootWithHint, resolveReadableProjectPath, resolveProjectPath, buildMutationResponse,
        joinProjectChildPath, sanitizeEntryName, sanitizeUploadRelativePath, createDirectoryArchive,
        sendDownload, withLoggedFallback, classifyProjectFile, TEXT_SAMPLE_BYTES, mime,
    });

    // Audio transcription endpoint
    const transcribeAudioHandler = async (req: any, res: any) => {
        try {
            const multer = (await import('multer')).default;
            const upload = multer({ storage: multer.memoryStorage() });

            // Handle multipart form data
            upload.single('audio')(req, res, async (err) => {
                if (err) {
                    return res.status(400).json({ error: 'Failed to process audio file' });
                }

                if (!req.file) {
                    return res.status(400).json({ error: 'No audio file provided' });
                }

                const apiKey = process.env.OPENAI_API_KEY;
                if (!apiKey) {
                    return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in server environment.' });
                }

                try {
                    // Create form data for OpenAI
                    const FormData = (await (Function('return import(\'form-data\')')() as Promise<any>)).default;
                    const formData = new FormData();
                    formData.append('file', req.file.buffer, {
                        filename: req.file.originalname,
                        contentType: req.file.mimetype
                    });
                    formData.append('model', 'whisper-1');
                    formData.append('response_format', 'json');
                    formData.append('language', 'en');

                    // Make request to OpenAI
                    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${apiKey}`,
                            ...formData.getHeaders()
                        },
                        body: formData
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
                    }

                    const data = await response.json();
                    let transcribedText = data.text || '';

                    // Check if enhancement mode is enabled
                    const mode = req.body.mode || 'default';

                    // If no transcribed text, return empty
                    if (!transcribedText) {
                        return res.json({ text: '' });
                    }

                    // If default mode, return transcribed text without enhancement
                    if (mode === 'default') {
                        return res.json({ text: transcribedText });
                    }

                    // Handle different enhancement modes
                    try {
                        const OpenAI = (await (Function('return import(\'openai\')')() as Promise<any>)).default;
                        const openai = new OpenAI({ apiKey });

                        let prompt, systemMessage, temperature = 0.7, maxTokens = 800;

                        switch (mode) {
                            case 'prompt':
                                systemMessage = 'You are an expert prompt engineer who creates clear, detailed, and effective prompts.';
                                prompt = `You are an expert prompt engineer. Transform the following rough instruction into a clear, detailed, and context-aware AI prompt.

    Your enhanced prompt should:
    1. Be specific and unambiguous
    2. Include relevant context and constraints
    3. Specify the desired output format
    4. Use clear, actionable language
    5. Include examples where helpful
    6. Consider edge cases and potential ambiguities

    Transform this rough instruction into a well-crafted prompt:
    "${transcribedText}"

    Enhanced prompt:`;
                                break;

                            case 'vibe':
                            case 'instructions':
                            case 'architect':
                                systemMessage = 'You are a helpful assistant that formats ideas into clear, actionable instructions for AI agents.';
                                temperature = 0.5; // Lower temperature for more controlled output
                                prompt = `Transform the following idea into clear, well-structured instructions that an AI agent can easily understand and execute.

    IMPORTANT RULES:
    - Format as clear, step-by-step instructions
    - Add reasonable implementation details based on common patterns
    - Only include details directly related to what was asked
    - Do NOT add features or functionality not mentioned
    - Keep the original intent and scope intact
    - Use clear, actionable language an agent can follow

    Transform this idea into agent-friendly instructions:
    "${transcribedText}"

    Agent instructions:`;
                                break;

                            default:
                                // No enhancement needed
                                break;
                        }

                        // Only make GPT call if we have a prompt
                        if (prompt) {
                            const completion = await openai.chat.completions.create({
                                model: 'gpt-4o-mini',
                                messages: [
                                    { role: 'system', content: systemMessage },
                                    { role: 'user', content: prompt }
                                ],
                                temperature: temperature,
                                max_tokens: maxTokens
                            });

                            transcribedText = completion.choices[0].message.content || transcribedText;
                        }

                    } catch (gptError: any) {
                        console.error('GPT processing error:', gptError);
                        // Fall back to original transcription if GPT fails
                    }

                    res.json({ text: transcribedText });

                } catch (error: any) {
                    console.error('Transcription error:', error);
                    res.status(500).json({ error: error.message });
                }
            });
        } catch (error: any) {
            console.error('Endpoint error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    // Chat attachment upload endpoint
    const uploadChatAttachmentsHandler = async (req: any, res: any) => {
        try {
            const multer = (await import('multer')).default;
            const uploadRoot = path.join(CHAT_UPLOAD_ROOT, String((req.user as any).id), '.incoming');

            await fsPromises.mkdir(uploadRoot, { recursive: true });

            /**
             * PURPOSE: Stage raw browser uploads in a temporary directory before we
             * move them into the final per-message batch tree under ~/ozw-uploads.
             */
            const storage = multer.diskStorage({
                destination: async (_request, _file, cb) => {
                    cb(null, uploadRoot);
                },
                filename: (_request, file, cb) => {
                    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
                    cb(null, `${uniqueSuffix}-${sanitizeFilename(file.originalname)}`);
                }
            });

            const upload = multer({
                storage,
                limits: {
                    fileSize: 25 * 1024 * 1024,
                    files: 100
                }
            });

            upload.array('attachments', 100)(req, res, async (err) => {
                let uploadedFiles: any[] = [];
                if (err) {
                    return res.status(400).json({ error: err.message });
                }

                if (!req.files || req.files.length === 0) {
                    return res.status(400).json({ error: 'No attachment files provided' });
                }

                try {
                    let parsedRelativePaths = null;
                    if (typeof req.body.relativePaths === 'string' && req.body.relativePaths) {
                        parsedRelativePaths = JSON.parse(req.body.relativePaths);
                        if (!Array.isArray(parsedRelativePaths) || parsedRelativePaths.length !== req.files.length) {
                            return res.status(400).json({ error: 'relativePaths must match uploaded files' });
                        }
                    }

                    uploadedFiles = Array.isArray(req.files) ? req.files : [];
                    const persistedBatch = await persistChatUploads(uploadedFiles, {
                        relativePaths: parsedRelativePaths,
                        userId: (req.user as any).id,
                    });

                    res.json({
                        rootPath: persistedBatch.rootPath,
                        attachments: persistedBatch.attachments,
                    });
                } catch (error: any) {
                    console.error('Error processing chat attachments:', error);
                    await Promise.all(uploadedFiles.map((file: any) => withLoggedFallback(fsPromises.unlink(file.path), undefined, 'cleanup failed chat attachment upload')));
                    res.status(500).json({ error: 'Failed to process chat attachments' });
                }
            });
        } catch (error: any) {
            console.error('Error in chat attachment upload endpoint:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    };

    // Get token usage for a specific session
    const getSessionTokenUsageHandler = async (req: any, res: any) => {
        try {
            const { projectName, sessionId } = req.params;
            const { provider = 'codex' } = req.query;
            const homeDir = os.homedir();

            // Allow only safe characters in sessionId
            const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '');
            if (!safeSessionId) {
                return res.status(400).json({ error: 'Invalid sessionId' });
            }

            const parsedContextWindow = parseInt(process.env.CONTEXT_WINDOW || '', 10);
            const contextWindow = Number.isFinite(parsedContextWindow) ? parsedContextWindow : 160000;

            if (provider === 'codex') {
                const tokenUsage = await getCodexSessionTokenUsage(safeSessionId, { homeDir });
                if (!tokenUsage) {
                    return res.status(204).send();
                }
                return res.json(tokenUsage);
            }

            res.status(410).json({ error: 'Claude sessions are no longer supported' });
        } catch (error: any) {
            console.error('Error reading session token usage:', error);
            res.status(500).json({ error: 'Failed to read session token usage' });
        }
    };

    registerProjectRoutes({
        app,
        authenticateToken,
        handlers: {
            listProjects: listProjectsHandler,
            getProjectOverview: getProjectOverviewHandler,
            renameProject: renameProjectHandler,
            deleteProject: deleteProjectHandler,
            createProject: createProjectHandler,
        },
    });
    registerWorkflowRoutes({
        app,
        authenticateToken,
        handlers: {
            listWorkflows: listWorkflowsHandler,
            createWorkflow: createWorkflowHandler,
            listOpenSpecChanges: listOpenSpecChangesHandler,
            getWorkflow: getWorkflowHandler,
            resumeWorkflowRun: resumeWorkflowRunHandler,
            abortWorkflowRun: abortWorkflowRunHandler,
        },
    });
    registerSessionRoutes({
        app,
        authenticateToken,
        handlers: {
            listLegacySessions: listLegacySessionsHandler,
            getSessionMessages: getSessionMessagesHandler,
            searchChatHistory: searchChatHistoryHandler,
            renameSession: renameSessionHandler,
            updateSessionUiState: updateSessionUiStateHandler,
            getSessionModelState: getSessionModelStateHandler,
            updateSessionModelState: updateSessionModelStateHandler,
            createManualSession: createManualSessionHandler,
            finalizeManualSession: finalizeManualSessionHandler,
            deleteSession: deleteSessionHandler,
        },
    });
    registerAttachmentRoutes({
        app,
        authenticateToken,
        handlers: {
            transcribeAudio: transcribeAudioHandler,
            uploadChatAttachments: uploadChatAttachmentsHandler,
        },
    });
    registerUsageRoutes({
        app,
        authenticateToken,
        handlers: {
            getUsageRemaining: getUsageRemainingHandler,
            getSessionTokenUsage: getSessionTokenUsageHandler,
        },
    });

}
