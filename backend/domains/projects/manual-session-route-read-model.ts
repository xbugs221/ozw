/**
 * PURPOSE: Typed command/read entry for manual cN session routes, including
 * draft creation, provider binding, runtime lookup, and finalization.
 */
import {
  bindManualSessionProvider as bindManualSessionProviderInStore,
  finalizeManualSessionRoute as finalizeManualSessionRouteInStore,
  initManualSessionRoute as initManualSessionRouteInStore,
  type SessionRouteStoreDependencies,
} from './session-route-store.js';
import {
  buildManualSessionId,
  buildProjectChatRecord,
  findProjectChatRecord,
  getManualSessionDraftMap,
  getNextManualRouteIndex,
  getSessionWorkflowMetadataMap,
  isPlainRecord,
  loadProjectConfig,
  MANUAL_SESSION_DRAFTS_KEY,
  parseManualSessionRouteIndex,
  saveProjectConfig,
  SESSION_ORIGIN_MANUAL,
  SESSION_ORIGIN_WORKFLOW,
  SESSION_WORKFLOW_METADATA_BY_ID_KEY,
  writeManualSessionRouteCounter,
  writeSessionSummaryOverride,
  type LooseRecord,
} from './project-config-read-model.js';
import {
  clearProjectDirectoryCache,
  extractProjectDirectory,
} from './project-discovery-read-model.js';

type ProviderName = 'codex' | 'pi' | 'claude';

/**
 * Create a user-visible manual session draft before a provider session exists.
 */
export async function createManualSessionDraft(
  projectName = '',
  projectPath = '',
  provider: ProviderName = 'codex',
  label = '',
  options: LooseRecord = {},
): Promise<LooseRecord> {
  assertProvider(provider);
  const resolvedProjectPath = projectPath || await extractProjectDirectory(projectName);
  const config = await loadProjectConfig(resolvedProjectPath);
  const routeIndex = Number.isInteger(options.routeIndex) && options.routeIndex > 0
    ? Number(options.routeIndex)
    : getNextManualRouteIndex(config);
  const draftId = buildManualSessionId(routeIndex);
  const now = new Date().toISOString();
  const manualDrafts = {
    ...getManualSessionDraftMap(config),
    [draftId]: {
      id: draftId,
      provider,
      label: label || `会话${routeIndex}`,
      routeIndex,
      projectName,
      projectPath: resolvedProjectPath,
      createdAt: now,
      updatedAt: now,
      ...options,
      origin: options.workflowId ? SESSION_ORIGIN_WORKFLOW : SESSION_ORIGIN_MANUAL,
    },
  };
  config[MANUAL_SESSION_DRAFTS_KEY] = manualDrafts;
  config.chat = config.chat && typeof config.chat === 'object' && !Array.isArray(config.chat)
    ? config.chat
    : {};
  config.chat[String(routeIndex)] = buildProjectChatRecord(
    draftId,
    label || `会话${routeIndex}`,
    {},
    {},
    manualDrafts[draftId],
  );
  writeSessionSummaryOverride(config, draftId, label || `会话${routeIndex}`);
  writeManualSessionRouteCounter(config, resolvedProjectPath, routeIndex);
  await saveProjectConfig(config, resolvedProjectPath);
  clearProjectDirectoryCache();
  return {
    ...manualDrafts[draftId],
    title: label || `会话${routeIndex}`,
    summary: label || `会话${routeIndex}`,
    lastActivity: now,
  };
}

/**
 * Initialize a route record for a manual session.
 */
export function initManualSessionRoute(projectName = '', projectPath = '', draftSessionId = '', provider: ProviderName = 'codex') {
  return initManualSessionRouteInStore(projectName, projectPath, draftSessionId, provider, getSessionRouteStoreDependencies());
}

/**
 * Bind a manual route to the real provider session id.
 */
export function bindManualSessionProvider(projectName = '', projectPath = '', draftSessionId = '', providerSessionId = '') {
  return bindManualSessionProviderInStore(projectName, projectPath, draftSessionId, providerSessionId, getSessionRouteStoreDependencies());
}

/**
 * Read runtime route metadata for a manual session id.
 */
export async function getManualSessionRouteRuntime(projectName = '', projectPath = '', draftSessionId = ''): Promise<LooseRecord | null> {
  const resolvedProjectPath = projectPath || await extractProjectDirectory(projectName);
  const config = await loadProjectConfig(resolvedProjectPath);
  const record = findProjectChatRecord(config, draftSessionId);
  if (record?.record) {
    const routeIndex = Number(record.routeIndex);
    const routeSessionId = Number.isInteger(routeIndex) && routeIndex > 0 ? buildManualSessionId(routeIndex) : '';
    return {
      ...record.record,
      routeIndex,
      draftSessionId,
      providerSessionId: resolveManualRouteProviderSessionId(record.record, draftSessionId, routeSessionId),
    };
  }
  const draft = getManualSessionDraftMap(config)[draftSessionId];
  if (!draft) {
    return null;
  }
  return {
    ...draft,
    routeIndex: draft.routeIndex || parseManualSessionRouteIndex(draftSessionId),
    draftSessionId,
    providerSessionId: draft.providerSessionId || '',
  };
}

/**
 * Finalize a manual route after provider startup has produced the real id.
 */
export function finalizeManualSessionRoute(
  projectName = '',
  draftSessionId = '',
  actualSessionId = '',
  provider: ProviderName = 'codex',
  projectPath = '',
) {
  return finalizeManualSessionRouteInStore(
    projectName,
    draftSessionId,
    actualSessionId,
    provider,
    projectPath,
    getSessionRouteStoreDependencies(),
  );
}

/**
 * Update a default manual cN route title from the first user request.
 */
export async function updateManualSessionTitleFromFirstRequest(
  projectName = '',
  projectPath = '',
  draftSessionId = '',
  provider: ProviderName = 'codex',
  firstRequest = '',
): Promise<LooseRecord> {
  assertProvider(provider);
  const firstRequestTitle = summarizeManualSessionTitle(firstRequest);
  if (!firstRequestTitle) {
    return { updated: false, reason: 'empty-request' };
  }

  const resolvedProjectPath = projectPath || await extractProjectDirectory(projectName);
  const config = await loadProjectConfig(resolvedProjectPath);
  const record = findProjectChatRecord(config, draftSessionId, provider);
  if (!record?.record || record.scope !== 'chat') {
    return { updated: false, reason: 'missing-route' };
  }

  const routeIndex = Number(record.routeIndex);
  const routeSessionId = Number.isInteger(routeIndex) && routeIndex > 0
    ? buildManualSessionId(routeIndex)
    : '';
  const currentTitle = String(record.record.title || record.record.summary || '').trim();
  if (!isDefaultManualSessionTitle(currentTitle, routeIndex, draftSessionId)) {
    return { updated: false, reason: 'custom-title' };
  }

  const routeTitle = summarizeManualSessionTitle(firstRequest, 20, false) || firstRequestTitle;
  const now = new Date().toISOString();
  config.chat = isPlainRecord(config.chat) ? { ...config.chat } : {};
  config.chat[record.routeIndex] = {
    ...record.record,
    provider: record.record.provider || provider,
    title: firstRequestTitle,
    routeTitle,
    summary: firstRequestTitle,
    updatedAt: now,
  };

  const manualDrafts = {
    ...getManualSessionDraftMap(config),
  };
  if (isPlainRecord(manualDrafts[draftSessionId])) {
    manualDrafts[draftSessionId] = {
      ...manualDrafts[draftSessionId],
      label: firstRequestTitle,
      title: firstRequestTitle,
      routeTitle,
      summary: firstRequestTitle,
      updatedAt: now,
    };
    config[MANUAL_SESSION_DRAFTS_KEY] = manualDrafts;
  }

  writeSessionSummaryOverride(config, draftSessionId, firstRequestTitle);
  const providerSessionId = resolveManualRouteProviderSessionId(config.chat[record.routeIndex], draftSessionId, routeSessionId);
  if (providerSessionId) {
    writeSessionSummaryOverride(config, providerSessionId, firstRequestTitle);
  }

  await saveProjectConfig(config, resolvedProjectPath);
  clearProjectDirectoryCache();
  return { updated: true, title: firstRequestTitle, routeTitle };
}

/**
 * Delete a manual session route when the owning session is removed.
 */
export async function deleteSession(projectName = '', sessionId = '', provider: ProviderName | null = null): Promise<boolean> {
  const projectPath = await extractProjectDirectory(projectName);
  const config = await loadProjectConfig(projectPath);
  const record = findProjectChatRecord(config, sessionId, provider);
  if (!record?.record || record.scope !== 'chat') {
    return false;
  }
  delete config.chat[record.routeIndex];
  await saveProjectConfig(config, projectPath);
  clearProjectDirectoryCache();
  return true;
}

/**
 * Resolve the real provider session id for a manual route runtime record.
 */
function resolveManualRouteProviderSessionId(record: LooseRecord, draftSessionId: string, routeSessionId: string): string {
  const providerSessionId = String(record.providerSessionId || '');
  if (providerSessionId) {
    return providerSessionId;
  }
  const sessionId = String(record.sessionId || '');
  return sessionId && sessionId !== draftSessionId && sessionId !== routeSessionId ? sessionId : '';
}

/**
 * Check whether a route title is still the generated route-number label.
 */
function isDefaultManualSessionTitle(title: string, routeIndex: number, draftSessionId: string): boolean {
  /**
   * PURPOSE: Preserve user-provided labels while allowing the redundant
   * generated 会话N placeholder to become the first real request title.
   */
  if (!title) {
    return true;
  }
  if (Number.isInteger(routeIndex) && routeIndex > 0 && title === `会话${routeIndex}`) {
    return true;
  }
  return title === draftSessionId || title === 'New Session';
}

/**
 * Normalize a user request into a compact manual-session title.
 */
function summarizeManualSessionTitle(text: unknown, maxLength = 50, ellipsis = true): string {
  /**
   * PURPOSE: Store enough of the user's first request for list scanning while
   * keeping route titles bounded for compact cards.
   */
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(normalized);
  if (chars.length <= maxLength) {
    return normalized;
  }
  return ellipsis ? `${chars.slice(0, maxLength).join('')}...` : chars.slice(0, maxLength).join('');
}

/**
 * Build dependencies for session-route-store without importing a runtime core.
 */
function getSessionRouteStoreDependencies(): SessionRouteStoreDependencies {
  return {
    extractProjectDirectory,
    loadProjectConfig,
    saveProjectConfig,
    findProjectChatRecord,
    getManualSessionDraftMap,
    parseManualSessionRouteIndex,
    buildManualSessionId,
    buildProjectChatRecord,
    writeSessionSummaryOverride,
    writeManualSessionRouteCounter,
    getSessionWorkflowMetadataMap,
    clearProjectDirectoryCache,
    constants: {
      manualSessionDraftsKey: MANUAL_SESSION_DRAFTS_KEY,
      sessionWorkflowMetadataByIdKey: SESSION_WORKFLOW_METADATA_BY_ID_KEY,
      sessionOriginManual: SESSION_ORIGIN_MANUAL,
      sessionOriginWorkflow: SESSION_ORIGIN_WORKFLOW,
    },
  };
}

/**
 * Ensure manual routes only bind supported provider histories.
 */
function assertProvider(provider: string): asserts provider is ProviderName {
  if (provider !== 'codex' && provider !== 'pi' && provider !== 'claude') {
    throw new Error('provider must be "codex", "pi" or "claude"');
  }
}
