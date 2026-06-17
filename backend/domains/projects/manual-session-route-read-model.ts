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

type ProviderName = 'codex' | 'pi';

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
  if (provider !== 'codex' && provider !== 'pi') {
    throw new Error('provider must be "codex" or "pi"');
  }
}
