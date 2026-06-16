/**
 * PURPOSE: Centralize workflow stage, session, and provider resolution rules.
 */
import { pick, type WorkflowJsonRecord, type WorkflowSessionRef, type WorkflowStageStatus } from './workflow-state-schema.js';

const KNOWN_PROVIDERS = ['codex', 'pi'] as const;

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
  return KNOWN_PROVIDERS.includes(provider as typeof KNOWN_PROVIDERS[number]);
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
 * Resolve a session provider by scanning state.sessions.
 */
export function resolveSessionProviderFromState(sessionId: unknown, sessions: WorkflowJsonRecord): string {
  if (!sessionId) return 'codex';
  const targetId = String(sessionId).trim();
  for (const [key, value] of Object.entries(sessions || {})) {
    if (String(value).trim() === targetId) {
      const parsed = acceptedProviderFromSessionKey(key);
      if (parsed.accepted && parsed.provider) {
        return parsed.provider;
      }
    }
  }
  return 'codex';
}

/**
 * Infer the owning workflow stage encoded in a subagent role key.
 */
export function inferSubagentRoleStage(role: unknown, stageStatuses: WorkflowStageStatus[] = []): string | null {
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
  if (phase === 'reviewer') {
    return findBestRoundStage(stageStatuses, ['review']) || 'review_1';
  }
  if (phase === 'tester') {
    return findBestRoundStage(stageStatuses, ['qa']) || 'qa';
  }
  if (phase === 'fixer') {
    return findBestRoundStage(stageStatuses, ['fix', 'repair']) || 'fix_1';
  }
  return null;
}

/**
 * From the list of known stage statuses, pick the best round for a role.
 */
function findBestRoundStage(stageStatuses: WorkflowStageStatus[], prefixes: string[]): string | null {
  if (!stageStatuses || !stageStatuses.length) return null;
  const pattern = new RegExp(`^(${prefixes.join('|')})_\\d+$`);
  const matching = stageStatuses.filter((stage) => pattern.test(stage.key));
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
export function resolveRoleDefaultStage(role: unknown, stageStatuses: WorkflowStageStatus[] = []): string | undefined {
  const normalizedRole = String(role || '').trim();
  const subagentStage = inferSubagentRoleStage(normalizedRole, stageStatuses);
  if (subagentStage) return subagentStage;
  if (normalizedRole === 'planner' || normalizedRole === 'planning') return 'planning';
  if (normalizedRole === 'acceptance' || normalizedRole === 'acceptor') return 'acceptance';
  if (normalizedRole === 'executor') return 'execution';
  if (normalizedRole === 'qa' || normalizedRole === 'tester') {
    return findBestRoundStage(stageStatuses, ['qa']) || 'qa';
  }
  if (normalizedRole === 'archiver') return 'archive';
  if (/^(?:review_\d+|fix_\d+|repair_\d+)$/.test(normalizedRole)) return normalizedRole;
  if (normalizedRole === 'reviewer') {
    return findBestRoundStage(stageStatuses, ['review']) || 'review_1';
  }
  if (normalizedRole === 'fixer') {
    return findBestRoundStage(stageStatuses, ['fix', 'repair']) || 'fix_1';
  }
  return undefined;
}

/**
 * Build the ordered session keys used to find the planner session.
 */
export function buildPlannerPrioritySessionKeys(workflowConfig: WorkflowJsonRecord | undefined): string[] {
  const planningStages = pick(workflowConfig, 'stages');
  const planningTool = String(pick(pick(planningStages, 'planning'), 'tool') || 'codex').trim();
  const priorityKeys: string[] = [];

  priorityKeys.push(`${planningTool}:planner`);
  for (const provider of KNOWN_PROVIDERS) {
    const key = `${provider}:planner`;
    if (!priorityKeys.includes(key)) priorityKeys.push(key);
  }
  priorityKeys.push('planner');

  priorityKeys.push(`${planningTool}:planning`);
  for (const provider of KNOWN_PROVIDERS) {
    const key = `${provider}:planning`;
    if (!priorityKeys.includes(key)) priorityKeys.push(key);
  }
  priorityKeys.push('planning');

  return priorityKeys;
}

/**
 * Resolve the planning session ref from oz flow state.sessions using the current
 * contract with legacy fallback for older runs.
 */
export function resolvePlannerSessionRef(
  sessions: WorkflowJsonRecord,
  workflowConfig: WorkflowJsonRecord | undefined,
  childSessions: WorkflowSessionRef[],
  runId: unknown,
): WorkflowJsonRecord | null {
  if (!sessions || typeof sessions !== 'object') {
    return null;
  }

  for (const key of buildPlannerPrioritySessionKeys(workflowConfig)) {
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
