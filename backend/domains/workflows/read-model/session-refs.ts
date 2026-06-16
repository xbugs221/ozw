/**
 * PURPOSE: Own provider-aware oz flow session reference rules for workflow stages.
 */
import { inferRole, stageLabel } from './stage-taxonomy.js';
import * as stageSessionResolver from './stage-session-resolver.js';
import type { WorkflowStageStatus } from './workflow-state-schema.js';

type StageStatus = WorkflowStageStatus;

type RunnerProcess = Record<string, any>;

const REVIEW_TITLES: Record<string, string> = {
  review_1: '需求与范围覆盖',
  review_2: '实现风险与回归',
  review_3: '验收与交付闭环',
};

export const acceptedProviderFromSessionKey = stageSessionResolver.acceptedProviderFromSessionKey;
export const inferSubagentRoleStage = stageSessionResolver.inferSubagentRoleStage;
export const isKnownProvider = stageSessionResolver.isKnownProvider;
export const parseProviderSessionKey = stageSessionResolver.parseProviderSessionKey;
export const resolveRoleDefaultStage = stageSessionResolver.resolveRoleDefaultStage;
export const resolveSessionProviderFromState = stageSessionResolver.resolveSessionProviderFromState;

/**
 * Build provider-aware child session refs for workflow stages.
 */
export function buildChildSessions(
  runId: unknown,
  processes: RunnerProcess[],
  warnings: string[],
  stageStatuses: StageStatus[],
  sessions: Record<string, unknown> = {},
  workflowConfig?: Record<string, unknown>,
): unknown[] {
  /**
   * Decide whether a process role is the primary session for its stage address.
   */
  function isPrimaryStageRole(stage: string, role: string): boolean {
    const primaryRoles: Record<string, string[]> = {
      planning: ['planner', 'planning'],
      execution: ['executor'],
      archive: ['archiver', 'archive'],
      acceptance: ['acceptance', 'acceptor'],
    };
    if (primaryRoles[stage]?.includes(role)) {
      return true;
    }
    if (/^review_\d+$/.test(stage)) return role === 'reviewer' || role === stage;
    if (/^qa(?:_\d+)?$/.test(stage)) return role === 'qa' || role === 'tester' || role === stage;
    if (/^(?:fix|repair)_\d+$/.test(stage)) return role === 'fixer' || role === stage;
    return role === stage;
  }

  const result: Array<Record<string, unknown>> = [];
  const sessionAddressTaken = new Set<string>();
  const sessionIdentity = (provider: unknown, sessionId: unknown): string => `${provider || 'codex'}:${sessionId}`;
  const normalizedRunId = String(runId);

  const withSession = processes.filter((process) => process.sessionId);
  const existingIds = new Set<string>();
  const baseCounts = new Map<string, number>();
  for (const process of withSession) {
    const key = `${process.stage}/${process.role || ''}`;
    baseCounts.set(key, (baseCounts.get(key) || 0) + 1);
  }
  for (const process of withSession) {
    const role = process.role || inferRole(process.stage);
    const baseKey = `${process.stage}/${role}`;
    let address = process.stage;
    if (!isPrimaryStageRole(process.stage, role)) {
      address = `${process.stage}/${role}`;
    } else if (withSession.filter((entry) => entry.stage === process.stage).length > 1) {
      address = `${process.stage}/${role}`;
    }
    if ((baseCounts.get(baseKey) || 0) > 1) {
      address = `by-id/${process.sessionId}`;
      warnings.push(`Duplicate child session address for ${baseKey}; using by-id fallback.`);
    }
    const title = REVIEW_TITLES[process.stage] || stageLabel(process.stage) || '工作流子会话';
    const explicitProcessProvider = String(process.provider || '').trim();
    if (explicitProcessProvider && !isKnownProvider(explicitProcessProvider)) {
      continue;
    }
    const provider = explicitProcessProvider || resolveSessionProviderFromState(process.sessionId, sessions);

    if (sessionAddressTaken.has(address)) {
      const byIdAddress = `by-id/${process.sessionId}`;
      if (sessionAddressTaken.has(byIdAddress)) {
        continue;
      }
      result.push({
        id: process.sessionId,
        title,
        summary: title,
        provider,
        role,
        workflowId: normalizedRunId,
        stageKey: process.stage,
        address: byIdAddress,
        routePath: `/runs/${encodeURIComponent(normalizedRunId)}/sessions/${byIdAddress.split('/').map(encodeURIComponent).join('/')}`,
      });
      existingIds.add(sessionIdentity(provider, process.sessionId));
      sessionAddressTaken.add(byIdAddress);
      continue;
    }

    result.push({
      id: process.sessionId,
      title,
      summary: title,
      provider,
      role,
      workflowId: normalizedRunId,
      stageKey: process.stage,
      address,
      routePath: `/runs/${encodeURIComponent(normalizedRunId)}/sessions/${address.split('/').map(encodeURIComponent).join('/')}`,
    });
    existingIds.add(sessionIdentity(provider, process.sessionId));
    sessionAddressTaken.add(address);
  }

  let winningPlannerSessionId: string | null = null;
  for (const key of stageSessionResolver.buildPlannerPrioritySessionKeys(workflowConfig)) {
    if (sessions[key]) {
      winningPlannerSessionId = String(sessions[key]).trim();
      break;
    }
  }

  const sessionEntries = Object.entries(sessions && typeof sessions === 'object' ? sessions : {});
  for (const [key, value] of sessionEntries) {
    const sessionId = String(value).trim();
    if (!sessionId) {
      continue;
    }
    const parsed = acceptedProviderFromSessionKey(key);
    if (!parsed.accepted) {
      warnings.push(`Unsupported workflow session provider in ${key}; child session link omitted.`);
      continue;
    }
    if (existingIds.has(sessionIdentity(parsed.provider, sessionId))) {
      continue;
    }
    const role = parsed.role;
    if (!role) {
      continue;
    }
    const stage = resolveRoleDefaultStage(role, stageStatuses) || 'execution';
    const address = stage;

    if (address === 'planning' && (role === 'planner' || role === 'planning')) {
      if (sessionId !== winningPlannerSessionId) {
        continue;
      }
    }

    const provider = parsed.provider;
    const addressKey = address;
    if (sessionAddressTaken.has(addressKey)) {
      const byIdAddress = `by-id/${sessionId}`;
      if (sessionAddressTaken.has(byIdAddress)) {
        continue;
      }
      const title = stageLabel(stage) || role;
      result.push({
        id: sessionId,
        title,
        summary: title,
        provider,
        role,
        workflowId: normalizedRunId,
        stageKey: stage,
        address: byIdAddress,
        routePath: `/runs/${encodeURIComponent(normalizedRunId)}/sessions/${byIdAddress.split('/').map(encodeURIComponent).join('/')}`,
      });
      existingIds.add(sessionIdentity(provider, sessionId));
      sessionAddressTaken.add(byIdAddress);
      continue;
    }

    const title = stageLabel(stage) || role;
    result.push({
      id: sessionId,
      title,
      summary: title,
      provider,
      role,
      workflowId: normalizedRunId,
      stageKey: stage,
      address,
      routePath: `/runs/${encodeURIComponent(normalizedRunId)}/sessions/${encodeURIComponent(address)}`,
    });
    existingIds.add(sessionIdentity(provider, sessionId));
    sessionAddressTaken.add(addressKey);
  }

  return result;
}
