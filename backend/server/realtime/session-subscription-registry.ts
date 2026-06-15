/**
 * 文件目的：定义会话私有 realtime subscription 的 registry 边界。
 * 业务意义：私有会话消息必须按 session/provider/project 所有权投递，不能退化为同用户全量广播。
 */

/**
 * 创建会话订阅匹配器。
 */
export function createSessionSubscriptionRegistry(deps: any = {}) {
    const subscriptions = deps.subscriptions || new WeakMap<object, any>();

    const collectStableSessionIds = (value: any): Set<string> => {
        const ids = new Set<string>();
        for (const key of ['sessionId', 'ozwSessionId', 'ozw_session_id', 'providerSessionId', 'provider_session_id', 'clientRequestId', 'client_request_id']) {
            const candidate = typeof value?.[key] === 'string' ? value[key].trim() : '';
            if (candidate) {
                ids.add(candidate);
            }
        }
        return ids;
    };

    return {
        setClientScope(client: object, scope: any) {
            subscriptions.set(client, scope || {});
        },
        getClientScope(client: object) {
            return subscriptions.get(client) || null;
        },
        clientMatchesSession(client: object, session: any) {
            const scope = subscriptions.get(client);
            if (!scope || !session) {
                return false;
            }
            /**
             * PURPOSE: Private realtime delivery must match a concrete session
             * identity. User/provider are only filters; they are not sufficient
             * ownership proof for Codex/Pi deltas.
             */
            if (session.userId && scope.userId !== session.userId) {
                return false;
            }
            if (session.provider && scope.provider !== session.provider) {
                return false;
            }

            const scopedIds = collectStableSessionIds(scope);
            const eventIds = collectStableSessionIds(session);
            if (scopedIds.size === 0 || eventIds.size === 0) {
                return false;
            }
            for (const eventId of eventIds) {
                if (scopedIds.has(eventId)) {
                    return true;
                }
            }
            return false;
        },
    };
}
