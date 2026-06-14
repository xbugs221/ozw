/**
 * 文件目的：维护手动 cN 会话路由的配置读写流程。
 * 业务意义：手动会话从草稿绑定到真实 Provider 会话是跨请求状态，独立边界能降低项目发现模块耦合。
 */

type ProviderName = 'codex' | 'pi';
type LooseRecord = Record<string, any>;

export type SessionRouteStoreDependencies = {
  extractProjectDirectory(projectName: string): Promise<string>;
  loadProjectConfig(projectPath?: string): Promise<LooseRecord>;
  saveProjectConfig(config: LooseRecord, projectPath?: string): Promise<void>;
  findProjectChatRecord(config: LooseRecord, sessionId: string): LooseRecord | null;
  getManualSessionDraftMap(config: LooseRecord): LooseRecord;
  parseManualSessionRouteIndex(sessionId: string): number | null;
  buildManualSessionId(routeIndex: number): string;
  buildProjectChatRecord(sessionId: string, title: string, modelState?: LooseRecord, uiState?: LooseRecord, metadata?: LooseRecord): LooseRecord;
  writeSessionSummaryOverride(config: LooseRecord, sessionId: string, summary: string): void;
  writeManualSessionRouteCounter(config: LooseRecord, projectPath: string, routeIndex: number): void;
  getSessionWorkflowMetadataMap(config: LooseRecord): LooseRecord;
  clearProjectDirectoryCache(): void;
  constants: {
    manualSessionDraftsKey: string;
    sessionWorkflowMetadataByIdKey: string;
    sessionOriginManual: string;
    sessionOriginWorkflow: string;
  };
};

/**
 * 校验 Provider 名称，保持手动路由只绑定已支持的会话来源。
 */
function assertProvider(provider: string): asserts provider is ProviderName {
  if (provider !== 'codex' && provider !== 'pi') {
    throw new Error('provider must be "codex" or "pi"');
  }
}

/**
 * 认领一个手动 cN 草稿路由，记录即将启动的 Provider。
 */
export async function initManualSessionRoute(
  projectName: string,
  projectPath: string,
  draftSessionId: string,
  provider: ProviderName = 'codex',
  deps: SessionRouteStoreDependencies,
): Promise<LooseRecord> {
  assertProvider(provider);
  if (typeof draftSessionId !== 'string' || !draftSessionId.trim()) {
    throw new Error('Draft session ID is required');
  }

  const resolvedProjectPath = projectPath || await deps.extractProjectDirectory(projectName);
  const config = await deps.loadProjectConfig(resolvedProjectPath);
  let draftRecord = deps.findProjectChatRecord(config, draftSessionId);
  if (!draftRecord?.record) {
    const manualDraftMap = deps.getManualSessionDraftMap(config);
    const manualDraft = manualDraftMap[draftSessionId];
    if (manualDraft) {
      const routeIndex = deps.parseManualSessionRouteIndex(draftSessionId)
        || (Number.isInteger(manualDraft?.routeIndex) ? manualDraft.routeIndex : null);
      if (Number.isInteger(routeIndex) && routeIndex > 0) {
        config.chat[String(routeIndex)] = deps.buildProjectChatRecord(
          draftSessionId,
          manualDraft.label || `会话${routeIndex}`,
          {},
          {},
          manualDraft,
        );
        draftRecord = { scope: 'chat', routeIndex: String(routeIndex), record: config.chat[String(routeIndex)] };
      }
    }
  }
  if (!draftRecord?.record) {
    return { started: false, reason: 'missing-draft' };
  }

  const updatedRecord = {
    ...draftRecord.record,
    provider,
  };
  delete updatedRecord.routeCancelFlag;
  if (draftRecord.scope === 'workflow') {
    return { started: false, reason: 'legacy-workflow-conf-disabled' };
  }
  config.chat[draftRecord.routeIndex] = updatedRecord;
  await deps.saveProjectConfig(config, resolvedProjectPath);
  deps.clearProjectDirectoryCache();
  return { started: true, record: updatedRecord };
}

/**
 * 在 Provider JSONL 确认前，为手动 cN 路由保存运行时 Provider 会话 id。
 */
export async function bindManualSessionProvider(
  projectName: string,
  projectPath: string,
  draftSessionId: string,
  providerSessionId: string,
  deps: SessionRouteStoreDependencies,
): Promise<boolean> {
  if (typeof draftSessionId !== 'string' || !draftSessionId.trim() || typeof providerSessionId !== 'string' || !providerSessionId.trim()) {
    return false;
  }

  const resolvedProjectPath = projectPath || await deps.extractProjectDirectory(projectName);
  const config = await deps.loadProjectConfig(resolvedProjectPath);
  let draftRecord = deps.findProjectChatRecord(config, draftSessionId);
  if (!draftRecord?.record) {
    const routeIndex = deps.parseManualSessionRouteIndex(draftSessionId);
    const routeRecord = Number.isInteger(routeIndex) && (routeIndex as number) > 0
      ? config?.chat?.[String(routeIndex as number)]
      : null;
    if (routeRecord) {
      draftRecord = { scope: 'chat', routeIndex: String(routeIndex), record: routeRecord };
    }
  }
  if (!draftRecord?.record) {
    return false;
  }

  const updatedRecord = {
    ...draftRecord.record,
    providerSessionId,
  };
  if (draftRecord.scope === 'workflow') {
    return false;
  }
  config.chat[draftRecord.routeIndex] = updatedRecord;
  await deps.saveProjectConfig(config, resolvedProjectPath);
  deps.clearProjectDirectoryCache();
  return true;
}

/**
 * 将手动草稿路由绑定到 Provider 生成的真实会话 id。
 */
export async function finalizeManualSessionRoute(
  projectName: string,
  draftSessionId: string,
  actualSessionId: string,
  provider: ProviderName = 'codex',
  projectPath = '',
  deps: SessionRouteStoreDependencies,
): Promise<boolean> {
  assertProvider(provider);
  if (typeof draftSessionId !== 'string' || !draftSessionId.trim()) {
    throw new Error('Draft session ID is required');
  }
  if (typeof actualSessionId !== 'string' || !actualSessionId.trim()) {
    throw new Error('Actual session ID is required');
  }
  if (actualSessionId.trim() === draftSessionId.trim()) {
    return false;
  }

  const resolvedProjectPath = projectPath || await deps.extractProjectDirectory(projectName);
  const config = await deps.loadProjectConfig(resolvedProjectPath);
  const manualDraftMap = {
    ...deps.getManualSessionDraftMap(config),
  };
  const draft = manualDraftMap[draftSessionId];
  let draftRecord = deps.findProjectChatRecord(config, draftSessionId);
  if (!draft && !draftRecord?.record) {
    return false;
  }
  if (!draftRecord?.record) {
    const routeIndex = deps.parseManualSessionRouteIndex(draftSessionId)
      || (Number.isInteger(draft?.routeIndex) ? draft.routeIndex : null);
    if (Number.isInteger(routeIndex) && routeIndex > 0) {
      config.chat = config.chat && typeof config.chat === 'object' && !Array.isArray(config.chat)
        ? config.chat
        : {};
      config.chat[String(routeIndex)] = deps.buildProjectChatRecord(
        actualSessionId,
        draft?.label || `会话${routeIndex}`,
        {},
        {},
        draft || {},
      );
      draftRecord = { scope: 'chat', routeIndex: String(routeIndex), record: config.chat[String(routeIndex)] };
    }
  }
  const workflowId = typeof draft?.workflowId === 'string' && draft.workflowId.trim()
    ? draft.workflowId.trim()
    : typeof draftRecord?.record?.workflowId === 'string' && draftRecord.record.workflowId.trim()
      ? draftRecord.record.workflowId.trim()
      : draftRecord?.scope === 'workflow'
        ? `w${draftRecord.workflowIndex}`
        : '';
  const stageKey = typeof draft?.stageKey === 'string' && draft.stageKey.trim()
    ? draft.stageKey.trim()
    : typeof draftRecord?.record?.stageKey === 'string'
      ? draftRecord.record.stageKey
      : undefined;
  const workflowOwnedDraft = Boolean(workflowId);
  const expectedProvider = typeof draft?.provider === 'string' && draft.provider
    ? draft.provider
    : draftRecord?.record?.provider;

  if (expectedProvider && expectedProvider !== provider) {
    throw new Error(`Draft session provider mismatch: expected ${expectedProvider}, received ${provider}`);
  }
  const trimmedLabel = typeof draft?.label === 'string' && draft.label.trim()
    ? draft.label.trim()
    : typeof draftRecord?.record?.title === 'string'
      ? draftRecord.record.title.trim()
      : '';
  if (trimmedLabel) {
    deps.writeSessionSummaryOverride(config, actualSessionId, trimmedLabel);
  }
  if (draftRecord?.scope === 'chat') {
    const routeIndexNumber = Number(draftRecord.routeIndex);
    const routeSessionId = Number.isInteger(routeIndexNumber) && routeIndexNumber > 0
      ? deps.buildManualSessionId(routeIndexNumber)
      : '';
    if (routeSessionId && actualSessionId.trim() === routeSessionId) {
      return false;
    }
    config.chat[draftRecord.routeIndex] = {
      ...draftRecord.record,
      sessionId: actualSessionId,
      title: trimmedLabel || draftRecord.record.title,
      provider,
      workflowId,
      stageKey,
      origin: workflowOwnedDraft ? deps.constants.sessionOriginWorkflow : deps.constants.sessionOriginManual,
    };
    delete config.chat[draftRecord.routeIndex].routeInitToken;
    delete config.chat[draftRecord.routeIndex].providerSessionId;
    delete config.chat[draftRecord.routeIndex].routeCancelFlag;
    deps.writeManualSessionRouteCounter(config, resolvedProjectPath, routeIndexNumber);
    for (const [routeIdx, record] of Object.entries(config.chat || {})) {
      if (String(routeIdx) !== String(draftRecord.routeIndex) && (record as LooseRecord)?.sessionId === actualSessionId) {
        delete config.chat[routeIdx];
      }
    }
  }

  if (workflowOwnedDraft) {
    config[deps.constants.sessionWorkflowMetadataByIdKey] = {
      ...deps.getSessionWorkflowMetadataMap(config),
      [actualSessionId]: {
        workflowId,
        stageKey,
        provider,
        origin: deps.constants.sessionOriginWorkflow,
      },
    };
  }

  if (draft) {
    delete manualDraftMap[draftSessionId];
    if (Object.keys(manualDraftMap).length === 0) {
      delete config[deps.constants.manualSessionDraftsKey];
    } else {
      config[deps.constants.manualSessionDraftsKey] = manualDraftMap;
    }
  }

  await deps.saveProjectConfig(config, resolvedProjectPath);
  deps.clearProjectDirectoryCache();
  return true;
}
