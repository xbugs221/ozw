/**
 * 文件目的：组装 Provider 会话列表读模型，隔离项目首页会话展示的纯业务规则。
 * 业务意义：Codex/Pi 会话列表需要合并手动 cN 草稿、隐藏底层 provider session，并过滤 workflow 子会话。
 */

type LooseRecord = Record<string, any>;

export type ProviderSessionListInput = {
  provider: 'codex' | 'pi' | string;
  providerSessions: LooseRecord[];
  manualDrafts: LooseRecord[];
  workflowOwnedSessionIds?: Set<string> | null;
  includeHidden?: boolean;
  excludeWorkflowChildSessions?: boolean;
};

/**
 * 判断一个会话是否属于 workflow 子会话，兼容 provider 原始 id 和手动路由绑定 id。
 */
function isWorkflowOwnedProviderSession(session: LooseRecord, workflowOwnedSessionIds?: Set<string> | null): boolean {
  if (!(workflowOwnedSessionIds instanceof Set)) {
    return false;
  }
  return [
    session?.id,
    session?.providerSessionId,
    session?.provider_session_id,
    session?.sourceSessionId,
    session?.source_session_id,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .some((sessionId) => workflowOwnedSessionIds.has(sessionId));
}

/**
 * 判断 session 是否应从普通列表隐藏；UI 层已标注 hidden/archived 时 read model 负责最终过滤。
 */
function isHiddenArchivedSession(session: LooseRecord): boolean {
  return session?.hidden === true || session?.archived === true || session?.isArchived === true;
}

/**
 * 读取手动 cN 草稿绑定的底层 provider session id，用于避免列表中重复显示。
 */
function getBoundProviderSessionId(session: LooseRecord): string {
  return String(session?.providerSessionId || session?.provider_session_id || '').trim();
}

/**
 * 构建 Provider 会话列表：手动 cN 草稿优先显示，底层 provider session 去重，workflow 子会话可从普通列表过滤。
 */
export function buildProviderSessionListReadModel(input: ProviderSessionListInput): LooseRecord[] {
  const {
    providerSessions = [],
    manualDrafts = [],
    workflowOwnedSessionIds = null,
    includeHidden = false,
    excludeWorkflowChildSessions = false,
  } = input;

  const normalizedDrafts = manualDrafts.filter((session) => {
    if (!session?.id) {
      return false;
    }
    if (!excludeWorkflowChildSessions) {
      return true;
    }
    return session.origin !== 'workflow' && !isWorkflowOwnedProviderSession(session, workflowOwnedSessionIds);
  });

  const boundProviderSessionIds = new Set(
    normalizedDrafts
      .map((session) => getBoundProviderSessionId(session))
      .filter(Boolean),
  );

  const standaloneProviderSessions = providerSessions.filter((session) => {
    if (!session?.id || boundProviderSessionIds.has(String(session.id))) {
      return false;
    }
    if (!excludeWorkflowChildSessions) {
      return true;
    }
    return session.origin !== 'workflow' && !isWorkflowOwnedProviderSession(session, workflowOwnedSessionIds);
  });

  const sessions = Array.from(
    new Map([...standaloneProviderSessions, ...normalizedDrafts].map((session) => [session?.id, session])).values(),
  )
    .filter((session) => includeHidden || !isHiddenArchivedSession(session))
    .sort((sessionA, sessionB) => new Date(sessionB.lastActivity || 0).getTime() - new Date(sessionA.lastActivity || 0).getTime());

  return sessions;
}
