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
 * Convert session activity into a stable sort key.
 */
function getSessionActivityTimeMs(session: LooseRecord): number {
  /**
   * PURPOSE: Missing timestamps are old data, not current activity, so they
   * must not crowd newer provider JSONL sessions out of limited overview lists.
   */
  const parsed = new Date(session?.lastActivity || session?.updated_at || session?.createdAt || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 判断路由标题是否仍是新建手动会话时生成的占位值。
 */
function isGeneratedManualRouteTitle(value: unknown, routeSession: LooseRecord): boolean {
  /**
   * PURPOSE: Distinguish generated cN labels from user renames so provider
   * transcript titles can repair TUI sessions without overwriting custom names.
   */
  const title = String(value || '').trim();
  const routeIndex = Number(routeSession?.routeIndex);
  if (!title) {
    return true;
  }
  if (title === 'New Session') {
    return true;
  }
  return Number.isInteger(routeIndex) && routeIndex > 0 && (
    title === `会话${routeIndex}` || title === `c${routeIndex}`
  );
}

/**
 * 保留自定义路由标题，但让 Provider 首条用户消息替换生成占位值。
 */
function mergeSessionTitle(
  providerValue: unknown,
  routeValue: unknown,
  routeSession: LooseRecord,
): unknown {
  /**
   * PURPOSE: Route metadata owns explicit renames; provider transcripts own the
   * title when terminal-created routes never left their generated placeholder.
   */
  return isGeneratedManualRouteTitle(routeValue, routeSession)
    ? (providerValue || routeValue)
    : routeValue;
}

/**
 * Merge one persisted cN route with the authoritative provider header.
 */
function mergeRoutedProviderSession(providerSession: LooseRecord, routeSession: LooseRecord): LooseRecord {
  /**
   * PURPOSE: Old auto-import routes may have no origin. A repaired JSONL header
   * that marks the provider thread as workflow-owned must not be overwritten by
   * that stale empty value.
   */
  return {
    ...providerSession,
    ...routeSession,
    title: mergeSessionTitle(providerSession.title, routeSession.title, routeSession),
    routeTitle: mergeSessionTitle(providerSession.routeTitle, routeSession.routeTitle, routeSession),
    summary: mergeSessionTitle(providerSession.summary, routeSession.summary, routeSession),
    origin: providerSession.origin === 'workflow'
      ? 'workflow'
      : (routeSession.origin || providerSession.origin),
    sourceSessionId: providerSession.sourceSessionId
      || providerSession.source_session_id
      || routeSession.sourceSessionId
      || routeSession.source_session_id,
    lastActivity: providerSession.lastActivity || routeSession.lastActivity,
    updated_at: providerSession.updated_at || routeSession.updated_at,
    createdAt: routeSession.createdAt || providerSession.createdAt,
  };
}

/**
 * 判断旧版本误记为 manual 的 workflow 角色会话，避免历史内部子任务污染手动列表。
 */
function isLegacyWorkflowRolePromptSession(session: LooseRecord): boolean {
  /**
   * PURPOSE: Hide historical workflow subagent sessions created before origin
   * metadata was persisted, while keeping ordinary user-created prompts visible.
   */
  if (session?.origin === 'workflow' || session?.workflowId || session?.stageKey) {
    return true;
  }
  const text = String(session?.title || session?.summary || session?.name || '').trim();
  if (!text) {
    return false;
  }
  return /^你是\s+[^，。]{1,40}(?:测试员|研究员|侦察员|审核员|规划员|执行员|修复员|归档员)，职责：/.test(text);
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
    if (session.origin === 'workflow' || session.workflowId || session.stageKey) {
      return false;
    }
    if (input.provider === 'pi' && !getBoundProviderSessionId(session) && session.origin === 'manual') {
      return false;
    }
    if (!excludeWorkflowChildSessions) {
      return true;
    }
    return !isLegacyWorkflowRolePromptSession(session) && !isWorkflowOwnedProviderSession(session, workflowOwnedSessionIds);
  });

  const boundProviderSessionIds = new Set(
    normalizedDrafts
      .map((session) => getBoundProviderSessionId(session))
      .filter(Boolean),
  );
  const providerById = new Map(providerSessions.map((session) => [String(session.id || ''), session]));

  const standaloneProviderSessions = providerSessions.filter((session) => {
    if (!session?.id || boundProviderSessionIds.has(String(session.id))) {
      return false;
    }
    if (!excludeWorkflowChildSessions) {
      return true;
    }
    return !isLegacyWorkflowRolePromptSession(session) && !isWorkflowOwnedProviderSession(session, workflowOwnedSessionIds);
  });

  const routedSessions = normalizedDrafts.map((session) => {
    const providerSessionId = getBoundProviderSessionId(session);
    const providerSession = providerSessionId ? providerById.get(providerSessionId) : null;
    return providerSession
      ? mergeRoutedProviderSession(providerSession, session)
      : session;
  });

  const sessions = Array.from(
    new Map([...standaloneProviderSessions, ...routedSessions].map((session) => [session?.id, session])).values(),
  )
    .filter((session) => !excludeWorkflowChildSessions || (
      !isLegacyWorkflowRolePromptSession(session)
      && !isWorkflowOwnedProviderSession(session, workflowOwnedSessionIds)
    ))
    .filter((session) => includeHidden || !isHiddenArchivedSession(session))
    .sort((sessionA, sessionB) => getSessionActivityTimeMs(sessionB) - getSessionActivityTimeMs(sessionA));

  return sessions;
}
