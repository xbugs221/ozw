/**
 * PURPOSE: Own oz flow workflow status-summary marker and runtime-state rules.
 */
import path from 'node:path';
import {
  collectDagTargetsByStage,
  mergeStageArtifacts,
  mergeStageSessions,
} from './dag-read-model.js';
import {
  acceptedProviderFromSessionKey,
  inferSubagentRoleStage,
  isKnownProvider,
} from './session-refs.js';
import {
  LEGACY_STAGE_ORDER,
  mapStageStatus,
  parseFixStage,
  stageDisplayText,
  stageLabel,
} from './stage-taxonomy.js';

type StageStatus = Record<string, any>;
type SessionRef = Record<string, any>;
type RunnerProcess = Record<string, any>;
type ArtifactRef = Record<string, any>;

const TERMINAL_METADATA_STAGES = new Set(['done']);
const SUBSTAGE_TITLES: Record<string, string> = {
  planning: '规划提案',
  acceptance: '验收计划',
  execution: '提案落地',
  verification: '审核',
  ready_for_acceptance: '待验收',
  review_1: '需求与范围覆盖',
  repair_1: '初修产物',
  review_2: '实现风险与回归',
  repair_2: '再修产物',
  review_3: '验收与交付闭环',
  repair_3: '三修产物',
  qa_1: 'QA 验收',
  qa_2: 'QA2 验收',
  qa_3: 'QA3 验收',
  qa: 'QA 验收',
  archive: '归档',
};

export const COMPLETED_STATUSES = ['completed', 'done', 'success', 'succeeded', 'archived'];
export const ACTIVE_STATUSES = ['running', 'active', 'in_progress'];
export const FAILED_STATUSES = ['failed', 'error', 'aborted'];

/**
 * Return a snake_case runner field value.
 */
function pick(object: Record<string, any> | null | undefined, snakeKey: string): any {
  return object?.[snakeKey];
}

/**
 * Return the explicit stage from an oz flow process row, accepting current and
 * historical field spellings.
 */
function pickProcessStage(process: RunnerProcess): string {
  return String(
    pick(process, 'stage')
    || pick(process, 'stage_key')
    || process?.stageKey
    || '',
  ).trim();
}

/**
 * Parse oz flow runner stage keys into sortable workflow positions.
 */
function parseRunnerStage(stage: unknown): { known: boolean; displayable: boolean; order: number } {
  const normalized = String(stage || '').trim();
  if (!normalized || TERMINAL_METADATA_STAGES.has(normalized)) {
    return { known: true, displayable: false, order: Number.POSITIVE_INFINITY };
  }
  if (normalized === 'execution') {
    return { known: true, displayable: true, order: 0 };
  }
  if (normalized === 'acceptance') {
    return { known: true, displayable: true, order: -10 };
  }
  if (Object.prototype.hasOwnProperty.call(LEGACY_STAGE_ORDER, normalized)) {
    return { known: true, displayable: true, order: LEGACY_STAGE_ORDER[normalized] };
  }
  if (normalized === 'archive') {
    return { known: true, displayable: true, order: Number.MAX_SAFE_INTEGER - 1 };
  }
  if (normalized === 'qa') {
    return { known: true, displayable: true, order: Number.MAX_SAFE_INTEGER - 2 };
  }
  const reviewMatch = normalized.match(/^review_(\d+)$/);
  if (reviewMatch) {
    const iteration = Number(reviewMatch[1]);
    if (Number.isInteger(iteration) && iteration > 0) {
      return { known: true, displayable: true, order: iteration * 3 - 2 };
    }
  }
  const qaMatch = normalized.match(/^qa_(\d+)$/);
  if (qaMatch) {
    const iteration = Number(qaMatch[1]);
    if (Number.isInteger(iteration) && iteration > 0) {
      return { known: true, displayable: true, order: iteration * 3 - 1 };
    }
  }
  const fixIteration = parseFixStage(normalized);
  if (fixIteration) {
    return { known: true, displayable: true, order: fixIteration * 3 };
  }
  return { known: false, displayable: true, order: Number.MAX_SAFE_INTEGER };
}

/**
 * Resolve the planning session ref from oz flow state.sessions using the current
 * contract with legacy fallback for older runs.
 */
function resolvePlannerSessionRef(
  sessions: Record<string, any>,
  workflowConfig: Record<string, any> | undefined,
  childSessions: SessionRef[],
  runId: unknown,
): Record<string, any> | null {
  if (!sessions || typeof sessions !== 'object') {
    return null;
  }

  const planningStages = pick(workflowConfig, 'stages');
  const planningTool = String(pick(pick(planningStages, 'planning'), 'tool') || 'codex').trim();
  const knownProviders = ['codex', 'pi'];
  const priorityKeys: string[] = [];

  priorityKeys.push(`${planningTool}:planner`);
  for (const provider of knownProviders) {
    const key = `${provider}:planner`;
    if (!priorityKeys.includes(key)) {
      priorityKeys.push(key);
    }
  }
  priorityKeys.push('planner');

  priorityKeys.push(`${planningTool}:planning`);
  for (const provider of knownProviders) {
    const key = `${provider}:planning`;
    if (!priorityKeys.includes(key)) {
      priorityKeys.push(key);
    }
  }
  priorityKeys.push('planning');

  for (const key of priorityKeys) {
    if (sessions[key]) {
      const sessionId = String(sessions[key]).trim();
      const parsed = acceptedProviderFromSessionKey(key);
      if (!parsed.accepted) {
        continue;
      }
      const provider = parsed.provider;
      const session = (childSessions || []).find((entry) => entry.id === sessionId);
      if (session) {
        return {
          sessionId,
          provider,
          role: 'planner',
          stageKey: 'planning',
          address: session.address,
          routePath: session.routePath,
        };
      }

      return {
        sessionId,
        provider,
        role: 'planner',
        stageKey: 'planning',
        routePath: `/runs/${encodeURIComponent(String(runId || ''))}/sessions/by-id/${encodeURIComponent(sessionId)}`,
      };
    }
  }

  return null;
}

/**
 * Resolve a session provider by scanning state.sessions.
 */
function resolveSessionProviderFromState(sessionId: unknown, sessions: Record<string, any>): string {
  if (!sessionId) return 'codex';
  for (const [key, value] of Object.entries(sessions || {})) {
    if (String(value).trim() === String(sessionId).trim()) {
      const parsed = acceptedProviderFromSessionKey(key);
      if (parsed.accepted && parsed.provider) {
        return parsed.provider;
      }
    }
  }
  return 'codex';
}

/**
 * Decide whether a runner status means completed work.
 */
export function isCompletedStatus(status: unknown): boolean {
  return COMPLETED_STATUSES.includes(String(status || '').toLowerCase());
}

/**
 * Decide whether a runner status means active work.
 */
export function isActiveStatus(status: unknown): boolean {
  return ACTIVE_STATUSES.includes(String(status || '').toLowerCase());
}

/**
 * Decide whether a runner status means blocked work.
 */
export function isBlockedStatus(status: unknown): boolean {
  return String(status || '').toLowerCase() === 'blocked';
}

/**
 * Render the compact marker used by oz flow status/watch summary rows.
 */
export function markerForStageStatus(stageKey: string, currentStage: string, status: unknown): string {
  const normalized = String(status || '').toLowerCase();
  if (stageKey === currentStage && isActiveStatus(normalized)) {
    return '→';
  }
  if (isCompletedStatus(normalized)) {
    return '✓';
  }
  if (FAILED_STATUSES.includes(normalized)) {
    return '✗';
  }
  if (isBlockedStatus(normalized)) {
    return '⊘';
  }
  return ' ';
}

/**
 * Build normalized stage statuses from runner state and current stage fallback.
 */
export function buildStageStatuses(
  state: Record<string, any>,
  currentStage: string,
  rawStatus: string,
  warnings: string[],
): StageStatus[] {
  const stages = pick(state, 'stages') || {};
  const processes = Array.isArray(pick(state, 'processes')) ? pick(state, 'processes') : [];
  const sessions = pick(state, 'sessions') || {};
  const processStageStatuses = new Map<string, string>();
  const stageKeys = new Set<string>();
  if (currentStage && parseRunnerStage(currentStage).displayable) {
    stageKeys.add(currentStage);
  }
  for (const stage of Object.keys(stages && typeof stages === 'object' ? stages : {})) {
    const parsedStage = parseRunnerStage(stage);
    if (!parsedStage.displayable) {
      continue;
    }
    stageKeys.add(stage);
    if (!parsedStage.known) {
      warnings.push(`Unknown runner stage: ${stage}`);
    }
  }
  for (const process of processes) {
    const stage = pickProcessStage(process);
    const parsedStage = parseRunnerStage(stage);
    if (!stage || !parsedStage.displayable) {
      continue;
    }
    stageKeys.add(stage);
    if (!parsedStage.known) {
      warnings.push(`Unknown runner process stage: ${stage}`);
    }
    const status = String(pick(process, 'status') || '').trim();
    if (status && !processStageStatuses.has(stage)) {
      processStageStatuses.set(stage, status);
    }
  }
  for (const key of Object.keys(sessions && typeof sessions === 'object' ? sessions : {})) {
    const parsed = acceptedProviderFromSessionKey(key);
    if (!parsed.accepted) {
      continue;
    }
    const role = String(parsed.role || '').trim();
    const roleStage = inferSubagentRoleStage(role)
      || (/^(?:review_\d+|fix_\d+|repair_\d+|qa_\d+)$/.test(role) ? role : '');
    const parsedStage = parseRunnerStage(roleStage);
    if (roleStage && parsedStage.displayable) {
      stageKeys.add(roleStage);
    }
  }
  const workflowConfig = pick(state, 'workflow_config');
  const configStages = pick(workflowConfig, 'stages');
  if (configStages && typeof configStages === 'object' && 'planning' in configStages && !stageKeys.has('planning')) {
    stageKeys.add('planning');
  }
  return [...stageKeys].sort((left, right) => {
    const leftStage = parseRunnerStage(left);
    const rightStage = parseRunnerStage(right);
    if (leftStage.order !== rightStage.order) {
      return leftStage.order - rightStage.order;
    }
    return left.localeCompare(right);
  }).map((key) => ({
    key,
    label: stageLabel(key),
    status: mapStageStatus(key === currentStage ? rawStatus : (stages[key] || processStageStatuses.get(key) || 'pending')),
    provider: 'codex',
  }));
}

/**
 * Match oz flow display jsonl labels to the runner session id they are derived from.
 */
function sessionMatchesJsonlName(sessionId: unknown, jsonlName: unknown, logPath = ''): boolean {
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedJsonlName = path.posix.basename(String(jsonlName || '').trim());
  const normalizedLogName = path.posix.basename(String(logPath || '').trim());
  if (!normalizedSessionId || !normalizedJsonlName) {
    return false;
  }
  return normalizedJsonlName === `${normalizedSessionId}.jsonl`
    || normalizedJsonlName.replace(/\.jsonl$/i, '') === normalizedSessionId
    || normalizedJsonlName === normalizedLogName;
}

/**
 * Return the most readable jsonl label for a runner process link.
 */
function sessionJsonlLabel(sessionId: unknown, logPath = ''): string {
  const logName = path.posix.basename(String(logPath || '').trim());
  if (/\.jsonl$/i.test(logName)) {
    return logName;
  }
  return `${sessionId}.jsonl`;
}

/**
 * Match oz flow checklist jsonl labels to runner child sessions.
 */
function findSessionRefForStage(
  stageKey: string,
  childSessions: SessionRef[],
  runnerProcesses: RunnerProcess[],
  warnings: string[],
  jsonlName: string,
): Record<string, any> | null {
  const hasJsonlName = Boolean(String(jsonlName || '').trim());
  if (!hasJsonlName && !parseRunnerStage(stageKey).known) {
    return null;
  }
  const stageProcess = runnerProcesses.find((entry) => entry.stage === stageKey && entry.sessionId);
  const stageSession = childSessions.find((session) => (
    session.stageKey === stageKey
    && session.address === stageKey
    && (!hasJsonlName || sessionMatchesJsonlName(session.id, jsonlName, stageProcess?.logPath))
  )) || childSessions.find((session) => (
    session.stageKey === stageKey
    && session.routePath?.endsWith(`/sessions/${stageKey}`)
    && (!hasJsonlName || sessionMatchesJsonlName(session.id, jsonlName, stageProcess?.logPath))
  )) || childSessions.find((session) => (
    session.stageKey === stageKey
    && (!hasJsonlName || sessionMatchesJsonlName(session.id, jsonlName, stageProcess?.logPath))
  ));
  if (stageSession) {
    return {
      label: jsonlName || sessionJsonlLabel(stageSession.id, stageProcess?.logPath),
      sessionId: stageSession.id,
      provider: stageSession.provider || 'codex',
      stageKey,
      address: stageSession.address,
      routePath: stageSession.routePath,
    };
  }
  const process = runnerProcesses.find((entry) => (
    entry.stage === stageKey
    && entry.sessionId
    && (!hasJsonlName || sessionMatchesJsonlName(entry.sessionId, jsonlName, entry.logPath))
  ));
  if (process) {
    return {
      label: jsonlName || sessionJsonlLabel(process.sessionId, process.logPath),
      sessionId: process.sessionId,
      provider: process.provider || 'codex',
      stageKey,
      routePath: `/runs/${encodeURIComponent(childSessions[0]?.workflowId || '')}/sessions/by-id/${encodeURIComponent(process.sessionId)}`,
    };
  }
  if (hasJsonlName) {
    warnings.push(`Unable to match workflow display session: ${jsonlName}`);
    return {
      label: jsonlName,
      stageKey,
    };
  }
  return null;
}

/**
 * Remove standalone repair rows once oz flow has emitted the following review row.
 */
function collapseSupersededRepairLines(lines: Array<Record<string, any>>): Array<Record<string, any>> {
  const reviewedFixNumbers = new Set(lines
    .map((line) => String(line.text || '').trim().match(/^(\d+)\s+fix\s+review$/)?.[1])
    .filter(Boolean));
  if (reviewedFixNumbers.size === 0) {
    return lines;
  }
  return lines.filter((line) => {
    const fixNumber = String(line.text || '').trim().match(/^(\d+)\s+fix$/)?.[1];
    return !fixNumber || !reviewedFixNumbers.has(fixNumber);
  });
}

/**
 * Build workflow checklist display lines.
 */
export function buildWorkflowDisplayLines(
  state: Record<string, any>,
  stageStatuses: StageStatus[],
  childSessions: SessionRef[],
  runnerProcesses: RunnerProcess[],
  warnings: string[],
): Array<Record<string, any>> {
  const displayLines = Array.isArray(state?.workflow_display?.lines) ? state.workflow_display.lines : [];
  if (displayLines.length > 0) {
    return collapseSupersededRepairLines(displayLines.map((line: Record<string, any>, index: number) => {
      const rawLine = String(line?.raw_line || line?.rawLine || '').trim();
      const marker = String(line?.marker || rawLine.match(/^[✓→ ]/)?.[0] || '').trim() || ' ';
      const text = String(line?.text || rawLine.replace(/^[✓→ ]\s*/, '').replace(/\s+\S+\.jsonl$/, '') || '').trim();
      const jsonlName = rawLine.match(/(\S+\.jsonl)\s*$/)?.[1] || String(line?.session_ref?.label || '').trim();
      const stageKey = String(line?.stage_key || stageStatuses[index]?.key || '').trim();
      return {
        id: String(line?.id || `${index}:${text}`),
        marker,
        text,
        status: String(line?.status || (marker === '✓' ? 'completed' : marker === '→' ? 'active' : 'pending')),
        rawLine: rawLine || [marker, text, jsonlName].filter(Boolean).join(' '),
        ...(jsonlName ? { sessionRef: findSessionRefForStage(stageKey, childSessions, runnerProcesses, warnings, jsonlName) } : {}),
      };
    }));
  }

  return collapseSupersededRepairLines(stageStatuses
    .filter((stage) => stage.status !== 'pending')
    .map((stage) => {
      const marker = stage.status === 'completed' ? '✓' : stage.status === 'active' ? '→' : ' ';
      const text = stageDisplayText(stage.key);
      const sessionRef = findSessionRefForStage(stage.key, childSessions, runnerProcesses, warnings, '');
      const rawLine = [marker, text, sessionRef?.label].filter(Boolean).join(' ');
      return {
        id: stage.key,
        marker,
        text,
        status: stage.status,
        rawLine,
        ...(sessionRef ? { sessionRef } : {}),
      };
    }));
}

/**
 * Build fixed-role workflow summary rows.
 */
export function buildWorkflowRoleSummary(
  state: Record<string, any>,
  childSessions: SessionRef[],
): Record<string, any> {
  const stages = pick(state, 'stages') || {};
  const sessions = pick(state, 'sessions') || {};
  const stageEntries = Object.entries(stages && typeof stages === 'object' ? stages : {});

  let writeCount = 0;
  let acceptanceCount = 0;
  let reviewCount = 0;
  let fixCount = 0;
  let qaCount = 0;
  let archiveCount = 0;

  for (const [stageKey, status] of stageEntries) {
    const normalizedStatus = String(status || '').toLowerCase();
    const isDone = isCompletedStatus(normalizedStatus);
    const isActive = isActiveStatus(normalizedStatus);
    if (!isDone && !isActive) {
      continue;
    }
    if (stageKey === 'acceptance') {
      acceptanceCount += 1;
    } else if (stageKey === 'execution') {
      writeCount += 1;
    } else if (parseFixStage(stageKey)) {
      fixCount += 1;
    } else if (/^review_\d+$/.test(stageKey)) {
      reviewCount += 1;
    } else if (stageKey === 'qa' || /^qa_\d+$/.test(stageKey)) {
      qaCount += 1;
    } else if (stageKey === 'archive') {
      archiveCount += 1;
    }
  }

  /**
   * Resolve a session id by checking all known provider prefixes for a role.
   */
  function findSessionByRole(role: string): { sessionId: string; provider: string } | null {
    for (const [key, value] of Object.entries(sessions && typeof sessions === 'object' ? sessions : {})) {
      const parsed = acceptedProviderFromSessionKey(key);
      if (!parsed.accepted) {
        continue;
      }
      if (parsed.role === role && value) {
        return { sessionId: String(value).trim(), provider: parsed.provider };
      }
    }
    return null;
  }

  function resolveSessionRef(role: string, label: string): Record<string, any> | null {
    let sessionId = '';
    let sessionProvider = 'codex';

    const providerMatch = findSessionByRole(role);
    if (providerMatch) {
      sessionId = providerMatch.sessionId;
      sessionProvider = providerMatch.provider;
    }
    if (!sessionId) {
      const roleFallbacks: Record<string, string[]> = {
        acceptance: ['acceptance'],
        executor: ['execution'],
        reviewer: ['review_1', 'review_2', 'review_3'],
        fixer: ['fix_1', 'fix_2', 'fix_3', 'repair_1', 'repair_2', 'repair_3'],
        qa: ['qa'],
        archiver: ['archive'],
        planning: ['planning'],
      };
      const fallbacks = roleFallbacks[role] || [];
      for (const key of fallbacks) {
        if (sessions[key]) {
          sessionId = String(sessions[key]).trim();
          break;
        }
      }
    }
    if (!sessionId) {
      const childMatch = childSessions.find((session) => session.role === role || session.stageKey === role);
      if (childMatch) {
        sessionId = childMatch.id;
        sessionProvider = childMatch.provider || 'codex';
      }
    }
    if (!sessionId) {
      return null;
    }

    if (!isKnownProvider(sessionProvider)) {
      return { label: label || sessionId, sessionId, provider: sessionProvider, unlinked: true };
    }

    const session = childSessions.find((entry) => entry.id === sessionId && (entry.provider || 'codex') === sessionProvider)
      || childSessions.find((entry) => entry.id === sessionId);
    if (session) {
      return {
        label: label || sessionId,
        sessionId,
        provider: sessionProvider || session.provider || 'codex',
        stageKey: session.stageKey,
        address: session.address,
        routePath: session.routePath,
      };
    }
    return {
      label: label || sessionId,
      sessionId,
      provider: sessionProvider,
      routePath: `/runs/${encodeURIComponent(state?.run_id || '')}/sessions/by-id/${encodeURIComponent(sessionId)}`,
    };
  }

  const plannerSessionRef = resolvePlannerSessionRef(
    sessions,
    pick(state, 'workflow_config'),
    childSessions,
    pick(state, 'run_id'),
  );

  const paths = pick(state, 'paths') || {};
  const hasAcceptanceStage = stages && typeof stages === 'object' && 'acceptance' in stages;
  const hasAcceptanceSession = Object.keys(sessions && typeof sessions === 'object' ? sessions : {}).some((key) => {
    const parsed = acceptedProviderFromSessionKey(key);
    return parsed.accepted && (parsed.role === 'acceptance' || parsed.role === 'acceptor');
  });
  const hasAcceptanceArtifact = paths && typeof paths === 'object' && Object.keys(paths).some((key) => (
    key === 'acceptance_summary' || key === 'acceptance' || /^acceptance/i.test(key)
  ));
  const showAcceptanceRow = hasAcceptanceStage || hasAcceptanceSession || hasAcceptanceArtifact;

  const rows: Array<Record<string, any>> = [
    {
      key: 'planning',
      label: '规',
      role: 'planning',
      sessionRef: plannerSessionRef,
      placeholder: plannerSessionRef ? undefined : '未知',
      checkCount: 0,
    },
  ];

  if (showAcceptanceRow) {
    rows.push({
      key: 'acceptance',
      label: '验',
      role: 'acceptance',
      sessionRef: resolveSessionRef('acceptance', ''),
      checkCount: acceptanceCount,
    });
  }

  rows.push(
    {
      key: 'executor',
      label: '写',
      role: 'executor',
      sessionRef: resolveSessionRef('executor', ''),
      checkCount: writeCount,
    },
    {
      key: 'reviewer',
      label: '审',
      role: 'reviewer',
      sessionRef: resolveSessionRef('reviewer', ''),
      checkCount: reviewCount,
    },
    {
      key: 'fixer',
      label: '修',
      role: 'fixer',
      sessionRef: resolveSessionRef('fixer', ''),
      checkCount: fixCount,
    },
    {
      key: 'qa',
      label: '测',
      role: 'qa',
      sessionRef: resolveSessionRef('qa', ''),
      checkCount: qaCount,
    },
    {
      key: 'archiver',
      label: '存',
      role: 'archiver',
      sessionRef: resolveSessionRef('archiver', ''),
      checkCount: archiveCount,
    },
  );

  return { rows };
}

/**
 * Build oz flow status/watch structured summary.
 */
export function buildWorkflowStatusSummary(
  state: Record<string, any>,
  childSessions: SessionRef[],
  artifacts: ArtifactRef[],
  dagNodes: Record<string, any>,
  hasPlanningArtifacts: boolean,
): Record<string, any> {
  const stages = pick(state, 'stages') || {};
  const sessions = pick(state, 'sessions') || {};
  const engine = String(pick(state, 'engine') || pick(state, 'workflow_config')?.engine || '').trim() || undefined;
  const currentStage = String(pick(state, 'stage') || '').trim();

  const evidenceStageKeys = new Set<string>();
  for (const [stageKey, status] of Object.entries(stages && typeof stages === 'object' ? stages : {})) {
    const normalizedStatus = String(status || '').toLowerCase();
    if (!normalizedStatus || normalizedStatus === 'pending') {
      continue;
    }
    evidenceStageKeys.add(stageKey);
  }
  if (currentStage) {
    evidenceStageKeys.add(currentStage);
  }
  for (const childSession of childSessions || []) {
    if (childSession.stageKey) evidenceStageKeys.add(childSession.stageKey);
  }
  for (const artifact of artifacts || []) {
    if (artifact.stage && artifact.exists !== false) evidenceStageKeys.add(artifact.stage);
  }
  for (const [nodeId, nodeData] of Object.entries(dagNodes || {})) {
    const nodeStatus = String(nodeData?.status || '').toLowerCase();
    if (!nodeStatus || nodeStatus === 'pending') {
      continue;
    }
    if (/^(?:execution|review_\d+|fix_\d+|repair_\d+|qa(?:_\d+)?|archive)$/.test(nodeId)) {
      evidenceStageKeys.add(nodeId);
    }
  }

  /**
   * Resolve a stage status from the same runtime evidence used to decide
   * whether the stage exists in the oz flow status/watch summary.
   */
  function resolveRuntimeStageStatus(stageKey: string): string {
    const stageStatus = String(stages?.[stageKey] || '').toLowerCase();
    if (stageStatus && stageStatus !== 'pending') {
      return stageStatus;
    }
    const dagStatus = String(dagNodes?.[stageKey]?.status || '').toLowerCase();
    if (dagStatus && dagStatus !== 'pending') {
      return dagStatus;
    }
    const runStatus = String(pick(state, 'status') || '').toLowerCase();
    if (stageKey === currentStage && isActiveStatus(runStatus)) {
      return 'running';
    }
    return stageStatus || dagStatus;
  }

  const executionStages: string[] = [];
  const reviewStages: string[] = [];
  const fixStages: string[] = [];
  const qaStages: string[] = [];
  const archiveStages: string[] = [];

  for (const stageKey of evidenceStageKeys) {
    if (stageKey === 'execution') {
      executionStages.push(stageKey);
    } else if (/^review_\d+$/.test(stageKey)) {
      reviewStages.push(stageKey);
    } else if (/^fix_\d+$/.test(stageKey) || /^repair_\d+$/.test(stageKey)) {
      fixStages.push(stageKey);
    } else if (stageKey === 'qa' || /^qa_\d+$/.test(stageKey)) {
      qaStages.push(stageKey);
    } else if (stageKey === 'archive') {
      archiveStages.push(stageKey);
    }
  }

  reviewStages.sort((left, right) => {
    const leftMatch = left.match(/^review_(\d+)$/);
    const rightMatch = right.match(/^review_(\d+)$/);
    return Number(leftMatch?.[1] || 0) - Number(rightMatch?.[1] || 0);
  });
  fixStages.sort((left, right) => {
    const leftMatch = left.match(/^(?:fix|repair)_(\d+)$/);
    const rightMatch = right.match(/^(?:fix|repair)_(\d+)$/);
    return Number(leftMatch?.[1] || 0) - Number(rightMatch?.[1] || 0);
  });
  qaStages.sort((left, right) => {
    const leftMatch = left.match(/^qa(?:_(\d+))?$/);
    const rightMatch = right.match(/^qa(?:_(\d+))?$/);
    return (Number(leftMatch?.[1]) || 1) - (Number(rightMatch?.[1]) || 1);
  });

  function buildMarker(stageKeys: string[]): string {
    return stageKeys.map((stageKey) => {
      const status = resolveRuntimeStageStatus(stageKey);
      return markerForStageStatus(stageKey, currentStage, status);
    }).join('');
  }

  function isActive(stageKeys: string[]): boolean {
    return stageKeys.some((stageKey) => {
      const status = resolveRuntimeStageStatus(stageKey);
      return stageKey === currentStage && isActiveStatus(status);
    });
  }

  function isBlocked(stageKeys: string[]): boolean {
    return stageKeys.some((stageKey) => {
      const status = resolveRuntimeStageStatus(stageKey);
      return isBlockedStatus(status);
    });
  }

  function resolveSessionRef(role: string, stageKeys: string[] = []): { sessionId: string; provider: string } | null {
    for (const [key, value] of Object.entries(sessions && typeof sessions === 'object' ? sessions : {})) {
      const parsed = acceptedProviderFromSessionKey(key);
      if (!parsed.accepted) {
        continue;
      }
      if (parsed.role === role && value) {
        return { sessionId: String(value).trim(), provider: parsed.provider };
      }
    }
    for (const stageKey of stageKeys) {
      const sessionId = String(sessions?.[stageKey] || '').trim();
      if (sessionId) {
        return { sessionId, provider: resolveSessionProviderFromState(sessionId, sessions) || 'codex' };
      }
    }
    const childMatch = (childSessions || []).find((session) => stageKeys.includes(session.stageKey));
    if (childMatch?.id) {
      return { sessionId: childMatch.id, provider: childMatch.provider || 'codex' };
    }
    return null;
  }

  function buildRow(key: string, label: string, role: string, stageKeys: string[]): Record<string, any> | null {
    if (!stageKeys || stageKeys.length === 0) {
      return null;
    }
    const sessionRef = resolveSessionRef(role, stageKeys);
    return {
      key,
      label,
      role,
      sessionId: sessionRef?.sessionId,
      provider: sessionRef?.provider,
      stageKeys,
      markerText: buildMarker(stageKeys),
      count: stageKeys.length,
      active: isActive(stageKeys),
      blocked: isBlocked(stageKeys),
    };
  }

  const plannerSessionRef = resolvePlannerSessionRef(
    sessions,
    pick(state, 'workflow_config'),
    childSessions,
    pick(state, 'run_id'),
  );

  /**
   * Render planning progress from real docs first.
   */
  function buildPlanningMarker(): string {
    if (hasPlanningArtifacts) return '✓';
    const status = String(stages.planning || '').toLowerCase();
    const marker = markerForStageStatus('planning', currentStage, status);
    if (marker !== ' ') return marker;
    return ' ';
  }

  const rows = [];
  if (hasPlanningArtifacts || plannerSessionRef) {
    rows.push({
      key: 'planning',
      label: '规',
      role: 'planning',
      sessionId: plannerSessionRef?.sessionId,
      provider: plannerSessionRef?.provider,
      stageKeys: ['planning'],
      markerText: buildPlanningMarker(),
      count: 0,
      active: currentStage === 'planning' && isActiveStatus(stages.planning),
      blocked: isBlockedStatus(stages.planning),
    });
  }
  const executorRow = buildRow('executor', '写', 'executor', executionStages);
  if (executorRow) rows.push(executorRow);
  const reviewerRow = buildRow('reviewer', '审', 'reviewer', reviewStages);
  if (reviewerRow) rows.push(reviewerRow);
  const fixerRow = buildRow('fixer', '修', 'fixer', fixStages);
  if (fixerRow) rows.push(fixerRow);
  const qaRow = buildRow('qa', '测', 'qa', qaStages);
  if (qaRow) rows.push(qaRow);
  const archiverRow = buildRow('archiver', '存', 'archiver', archiveStages);
  if (archiverRow) rows.push(archiverRow);

  return {
    source: { format: 'oz flow status/watch', runtimeOnly: true },
    engine,
    rows,
  };
}

/**
 * Read oz flow status duration values without forcing one runner schema.
 */
function getStageDurationText(state: Record<string, any>, stageKey: string): string {
  const durationMaps = [
    pick(state, 'stage_durations'),
    pick(state, 'stageDurations'),
    pick(state, 'durations'),
  ].filter((value) => value && typeof value === 'object');
  for (const durationMap of durationMaps) {
    const value = durationMap[stageKey];
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value.toFixed(2) : '';
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

/**
 * Build stage inspection read models.
 */
export function buildStageInspections(
  state: Record<string, any>,
  stageStatuses: StageStatus[],
  childSessions: SessionRef[],
  artifacts: ArtifactRef[],
  runnerError: string,
  diagnostics: Record<string, any>,
  workflowDag: Record<string, any>,
): Array<Record<string, any>> {
  const dagTargetsByStage = collectDagTargetsByStage(workflowDag);
  return stageStatuses.map((stage) => {
    const stageSessions = childSessions.filter((session) => session.stageKey === stage.key);
    const stageArtifacts = artifacts.filter((artifact) => artifact.stage === stage.key);
    const dagTargets = dagTargetsByStage.get(stage.key) || { sessions: [], artifacts: [] };
    const mergedStageSessions = mergeStageSessions(stageSessions, dagTargets.sessions, stage.key);
    const mergedStageArtifacts = mergeStageArtifacts(stageArtifacts, dagTargets.artifacts, stage.key, stage.status);
    if (stage.key === 'archive' && !stageArtifacts.some((artifact) => artifact.type === 'delivery-summary')) {
      mergedStageArtifacts.push({
        id: 'delivery-summary:delivery-summary.md',
        label: 'delivery-summary.md',
        type: 'delivery-summary',
        stage: 'archive',
        relativePath: 'delivery-summary.md',
        path: 'delivery-summary.md',
        exists: false,
      });
    }
    return {
      stageKey: stage.key,
      title: stage.label || stage.key,
      status: stage.status,
      durationText: getStageDurationText(state, stage.key),
      provider: 'codex',
      note: stage.status === 'blocked' ? runnerError || undefined : undefined,
      warnings: (diagnostics.warnings || []).map((message: string) => ({
        type: 'runner_diagnostic',
        stageKey: stage.key,
        provider: 'codex',
        message,
      })),
      recoveryEvents: [],
      substages: [{
        stageKey: stage.key,
        substageKey: stage.key,
        title: SUBSTAGE_TITLES[stage.key] || stage.label || stage.key,
        status: stage.status,
        summary: stage.status === 'blocked' ? runnerError || undefined : undefined,
        files: mergedStageArtifacts,
        agentSessions: mergedStageSessions,
      }],
    };
  });
}
