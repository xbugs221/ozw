/**
 * PURPOSE: Own provider-aware oz flow session reference rules for workflow stages.
 */
import { inferRole, stageLabel } from './stage-taxonomy.js';

type StageStatus = {
  key: string;
  status?: string;
};

type RunnerProcess = Record<string, any>;

const REVIEW_TITLES: Record<string, string> = {
  review_1: '需求与范围覆盖',
  review_2: '实现风险与回归',
  review_3: '验收与交付闭环',
};

/**
 * Return a snake_case runner field value.
 */
function pick(object: Record<string, any> | null | undefined, snakeKey: string): any {
  return object?.[snakeKey];
}

/**
 * Infer the owning workflow stage encoded in a subagent role key.
 */
export function inferSubagentRoleStage(role: unknown, stageStatuses: StageStatus[] = []): string | null {
  const normalized = String(role || '').trim();
  if (!normalized) {
    return null;
  }
  const parts = normalized.split(':').map((part) => part.trim()).filter(Boolean);
  const phase = parts[0] === 'subagent' ? parts[1] : parts[0];
  const roundToken = parts[0] === 'subagent' ? parts[2] : parts[1];
  const phaseMatch = String(phase || '').match(/^(review|qa|fix|repair)_(\d+)$/);
  if (phaseMatch) {
    return `${phaseMatch[1]}_${Number(phaseMatch[2])}`;
  }
  if (phase === 'planning_context' || phase === 'planning') {
    return 'planning';
  }
  if (phase === 'implementation_context' || phase === 'execution_context' || phase === 'execution') {
    return 'execution';
  }
  if (phase === 'archive') {
    return 'archive';
  }
  if (phase === 'acceptance') {
    return 'acceptance';
  }
  if (['review', 'qa', 'fix', 'repair'].includes(String(phase))) {
    const numericRound = Number(roundToken);
    const trailingRound = Number(parts[parts.length - 1]);
    if (Number.isInteger(numericRound) && numericRound > 0) {
      return `${phase}_${numericRound}`;
    }
    if (Number.isInteger(trailingRound) && trailingRound > 0) {
      return `${phase}_${trailingRound}`;
    }
    const matching = (stageStatuses || []).filter((stage) => (
      phase === 'repair'
        ? /^(?:repair|fix)_\d+$/.test(stage.key)
        : new RegExp(`^${phase}_\\d+$`).test(stage.key)
    ));
    const active = matching.find((stage) => stage.status === 'active');
    if (active) return active.key;
    const completed = [...matching].reverse().find((stage) => stage.status === 'completed');
    if (completed) return completed.key;
    return matching[matching.length - 1]?.key || `${phase}_1`;
  }
  return null;
}

/**
 * Parse a provider-prefixed session key into provider and role.
 */
export function parseProviderSessionKey(key: unknown): { provider: string | null; role: string } {
  const normalized = String(key || '').trim();
  const match = normalized.match(/^([a-z][a-z0-9]*):(.+)$/);
  if (match) {
    return { provider: match[1], role: match[2] };
  }
  return { provider: null, role: normalized };
}

/**
 * Check if a provider is known and can be rendered by ozw.
 */
export function isKnownProvider(provider: unknown): boolean {
  return provider === 'codex' || provider === 'pi';
}

/**
 * Return the renderable provider from an oz flow session key.
 */
export function acceptedProviderFromSessionKey(key: unknown): {
  provider: string;
  role: string;
  accepted: boolean;
} {
  const parsed = parseProviderSessionKey(key);
  if (parsed.provider && !isKnownProvider(parsed.provider)) {
    return { ...parsed, provider: parsed.provider, accepted: false };
  }
  return { ...parsed, provider: parsed.provider || 'codex', accepted: true };
}

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
   * Resolve the provider for a session id by scanning state.sessions provider
   * prefixes. Returns the matching prefix provider, or falls back to 'codex'.
   */
  function resolveSessionProvider(sessionId: unknown): string | null {
    if (!sessionId) return 'codex';
    const targetId = String(sessionId).trim();
    for (const [key, value] of Object.entries(sessions && typeof sessions === 'object' ? sessions : {})) {
      if (String(value).trim() === targetId) {
        const parsed = acceptedProviderFromSessionKey(key);
        if (!parsed.accepted) {
          return null;
        }
        if (parsed.provider) {
          return parsed.provider;
        }
      }
    }
    return 'codex';
  }

  /**
   * From the list of known stage statuses, pick the best round for a role.
   */
  function findBestRoundStage(inputStageStatuses: StageStatus[], prefixes: string[]): string | null {
    if (!inputStageStatuses || !inputStageStatuses.length) return null;
    const pattern = new RegExp(`^(${prefixes.join('|')})_\\d+$`);
    const matching = inputStageStatuses.filter((stage) => pattern.test(stage.key));
    if (!matching.length) return null;

    const active = matching.find((stage) => stage.status === 'active');
    if (active) return active.key;

    const completed = [...matching].reverse().find((stage) => stage.status === 'completed');
    if (completed) return completed.key;

    return matching[matching.length - 1]?.key || null;
  }

  /**
   * Map a role name to the best matching stage key using current stage status.
   */
  function roleDefaultStage(role: string): string | undefined {
    const subagentStage = inferSubagentRoleStage(role, stageStatuses);
    if (subagentStage) return subagentStage;
    if (role === 'planner' || role === 'planning') return 'planning';
    if (role === 'acceptance' || role === 'acceptor') return 'acceptance';
    if (role === 'executor') return 'execution';
    if (role === 'qa' || role === 'tester') {
      return findBestRoundStage(stageStatuses, ['qa']) || 'qa';
    }
    if (role === 'archiver') return 'archive';
    if (/^(?:review_\d+|fix_\d+|repair_\d+)$/.test(role)) return role;
    if (role === 'reviewer') {
      return findBestRoundStage(stageStatuses, ['review']) || 'review_1';
    }
    if (role === 'fixer') {
      return findBestRoundStage(stageStatuses, ['fix', 'repair']) || 'fix_1';
    }
    return undefined;
  }

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
    const provider = explicitProcessProvider || resolveSessionProvider(process.sessionId);
    if (!provider) {
      warnings.push(`Unsupported workflow session provider for ${process.sessionId}; child session link omitted.`);
      continue;
    }

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

  const planningTool = String(
    pick(pick(pick(workflowConfig, 'stages'), 'planning'), 'tool') || 'codex',
  ).trim();
  const knownProviders = ['codex', 'pi'];
  const plannerPriorityKeys: string[] = [];
  plannerPriorityKeys.push(`${planningTool}:planner`);
  for (const provider of knownProviders) {
    const key = `${provider}:planner`;
    if (!plannerPriorityKeys.includes(key)) plannerPriorityKeys.push(key);
  }
  plannerPriorityKeys.push('planner');
  plannerPriorityKeys.push(`${planningTool}:planning`);
  for (const provider of knownProviders) {
    const key = `${provider}:planning`;
    if (!plannerPriorityKeys.includes(key)) plannerPriorityKeys.push(key);
  }
  plannerPriorityKeys.push('planning');

  let winningPlannerSessionId: string | null = null;
  for (const key of plannerPriorityKeys) {
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
    const stage = roleDefaultStage(role) || 'execution';
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
