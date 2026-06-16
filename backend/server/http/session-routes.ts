/**
 * 文件目的：定义会话消息、搜索、重命名、删除和 UI/model 状态 API 的注册边界。
 * 业务意义：route module 直接声明自身依赖，避免通过宽泛依赖隐藏权限边界。
 */

type LooseRecord = Record<string, any>;

export interface SessionRouteDeps {
    app: any; authenticateToken: any; handleGetSessionMessages: any; searchChatHistory: any; heavyReadCoalescer: any; renameSession: any; updateSessionUiState: any; getSessionModelState: any; updateSessionModelState: any; broadcastSessionModelStateUpdated: any; normalizeManualProvider: any; createManualSessionDraft: any; finalizeManualSessionRoute: any; deleteSession: any; extractProjectDirectory: any; broadcastProjectListInvalidated: any;
}

/**
 * 注册会话相关 HTTP 路由。
 */
export function registerSessionRoutes(deps: SessionRouteDeps): void {
    const { app, authenticateToken, handleGetSessionMessages, searchChatHistory, heavyReadCoalescer, renameSession, updateSessionUiState, getSessionModelState, updateSessionModelState, broadcastSessionModelStateUpdated, normalizeManualProvider, createManualSessionDraft, finalizeManualSessionRoute, deleteSession, extractProjectDirectory, broadcastProjectListInvalidated } = deps;

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

        const session = await createManualSessionDraft(req.params.projectName, projectPath, provider, label, {
            workflowId,
            stageKey,
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


    app.get('/api/projects/:projectName/sessions', authenticateToken, listLegacySessionsHandler);
    app.get('/api/projects/:projectName/sessions/:sessionId/messages', authenticateToken, getSessionMessagesHandler);
    app.get('/api/chat/search', authenticateToken, searchChatHistoryHandler);
    app.put('/api/projects/:projectName/sessions/:sessionId/rename', authenticateToken, renameSessionHandler);
    app.put('/api/projects/:projectName/sessions/:sessionId/ui-state', authenticateToken, updateSessionUiStateHandler);
    app.get('/api/projects/:projectName/sessions/:sessionId/model-state', authenticateToken, getSessionModelStateHandler);
    app.put('/api/projects/:projectName/sessions/:sessionId/model-state', authenticateToken, updateSessionModelStateHandler);
    app.post('/api/projects/:projectName/manual-sessions', authenticateToken, createManualSessionHandler);
    app.post('/api/projects/:projectName/manual-sessions/:sessionId/finalize', authenticateToken, finalizeManualSessionHandler);
    app.delete('/api/projects/:projectName/sessions/:sessionId', authenticateToken, deleteSessionHandler);
}
