/**
 * 文件目的：集中定义 WebSocket 公共广播的 registry 边界。
 * 业务意义：公共刷新、workflow 变化和会话变化都从这里形成可审查的投递接口。
 */

type RuntimeClient = { readyState?: number; send(payload: string): void };
type LooseRecord = Record<string, any>;

/**
 * 创建一组公共 broadcast helper。
 */
export function createBroadcastRegistry(deps: any) {
    const { connectedClients, WebSocket, clearProjectDirectoryCache, isGetProjectsRunningRef } = deps;

    const sendToOpenClients = (payload: unknown) => {
        const message = JSON.stringify(payload);
        connectedClients.forEach((client: RuntimeClient) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    };

    return {
        broadcastProgress(progress: LooseRecord) {
            sendToOpenClients({ type: 'loading_progress', ...progress });
        },
        broadcastSessionChanged(payload: LooseRecord) {
            sendToOpenClients({ type: 'session_changed', ...payload, timestamp: new Date().toISOString() });
        },
        broadcastWorkflowChanged(payload: LooseRecord) {
            sendToOpenClients({ type: 'workflow_changed', ...payload, timestamp: new Date().toISOString() });
        },
        async broadcastProjectsUpdated(payload: LooseRecord = {}) {
            if (isGetProjectsRunningRef?.value) {
                return;
            }
            clearProjectDirectoryCache?.();
            sendToOpenClients({
                type: 'project_list_invalidated',
                reason: `manual-refresh:${payload.watchProvider || 'workflow'}:${payload.changeType || 'change'}`,
                changedFile: payload.changedFile || '',
                timestamp: new Date().toISOString(),
            });
        },
    };
}
