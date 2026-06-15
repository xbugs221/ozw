/**
 * PURPOSE: Project explicit oz flow runner process rows into the workflow read
 * model while keeping sessions-only states from inventing process records.
 */
import path from 'path';
import { inferRole } from './stage-taxonomy.js';
import { acceptedProviderFromSessionKey, isKnownProvider } from './session-refs.js';
import { pick, type WorkflowJsonRecord, type WorkflowRunnerProcess, type WorkflowStageStatus, type WorkflowState } from './workflow-state-schema.js';

type RunnerProcess = WorkflowRunnerProcess;
type StageStatus = WorkflowStageStatus;

const KNOWN_PROCESS_FIELDS = new Set([
  'stage', 'stageKey', 'stage_key', 'role', 'status', 'sessionId', 'session_id',
  'provider', 'pid', 'exitCode', 'exit_code', 'failed', 'logPath', 'log_path',
]);

function normalizeRelativePath(projectPath: string, value: unknown): string {
  /** Convert arbitrary runner paths to project-relative slash paths. */
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, '/');
  if (!path.isAbsolute(raw)) return normalized;
  return path.relative(projectPath, raw).replace(/\\/g, '/');
}

function pickProcessStage(process: RunnerProcess): string {
  /** Return the explicit stage from current and historical process fields. */
  return String(pick(process, 'stage') || pick(process, 'stage_key') || process?.stageKey || '').trim();
}

export function buildRunnerProcesses(
  state: WorkflowState,
  stageStatuses: StageStatus[],
  logsByKey: Map<string, string>,
  warnings: string[],
): RunnerProcess[] {
  const explicit = pick(state, 'processes');
  if (!Array.isArray(explicit) || explicit.length === 0) {
    return [];
  }
  const sessions = pick(state, 'sessions') || {};

  /**
   * Resolve process provider using process metadata first, then the matching
   * provider-qualified state.sessions key for this stage/role.
   */
  function resolveProcessProvider(process: WorkflowJsonRecord, stage: string, role: string, sessionId: string): string {
    const explicitProvider = String(pick(process, 'provider') || process?.provider || '').trim();
    if (isKnownProvider(explicitProvider)) {
      return explicitProvider;
    }
    if (explicitProvider) {
      warnings.push(`Unsupported runner process provider ${explicitProvider}; child session link omitted for ${sessionId || stage}.`);
      return explicitProvider;
    }
    const inferredRole = inferRole(stage);
    const roleCandidates = new Set([role, inferredRole, stage].map((value) => String(value || '').trim()).filter(Boolean));
    if (stage === 'execution') roleCandidates.add('executor');
    if (stage === 'archive') roleCandidates.add('archiver');
    if (/^review_\d+$/.test(stage)) roleCandidates.add('reviewer');
    if (/^qa(?:_\d+)?$/.test(stage)) roleCandidates.add('qa');
    if (/^(?:fix|repair)_\d+$/.test(stage)) roleCandidates.add('fixer');

    const valueMatches = [];
    for (const [key, value] of Object.entries(sessions && typeof sessions === 'object' ? sessions : {})) {
      if (String(value || '').trim() !== sessionId) {
        continue;
      }
      const parsed = acceptedProviderFromSessionKey(key);
      if (!parsed.accepted) {
        continue;
      }
      if (roleCandidates.has(parsed.role)) {
        return parsed.provider;
      }
      valueMatches.push(parsed.provider);
    }
    return valueMatches[0] || 'codex';
  }

  return explicit.map((process) => {
    const unknownFields = Object.keys(process && typeof process === 'object' ? process : {})
      .filter((key) => !KNOWN_PROCESS_FIELDS.has(key));
    unknownFields.forEach((key) => {
      warnings.push(`Unknown runner process field: ${key}`);
    });
    const stage = pickProcessStage(process);
    const role = String(pick(process, 'role') || inferRole(stage)).trim();
    const sessionId = String(pick(process, 'session_id') || process?.sessionId || '').trim() || undefined;
    const logPath = normalizeRelativePath('', pick(process, 'log_path') || process?.logPath || logsByKey.get(`${stage}_${role}_log`) || logsByKey.get(`${role}_log`) || logsByKey.get(`${stage}_log`));
    return {
      stage,
      role,
      status: String(pick(process, 'status') || '').trim() || undefined,
      sessionId,
      provider: sessionId ? resolveProcessProvider(process, stage, role, sessionId) : undefined,
      pid: Number.isInteger(process?.pid) ? process.pid : undefined,
      exitCode: Number.isInteger(pick(process, 'exit_code') ?? process?.exitCode) ? (pick(process, 'exit_code') ?? process?.exitCode) : undefined,
      failed: process?.failed === true,
      logPath: logPath || undefined,
    };
  }).map((process) => Object.fromEntries(Object.entries(process).filter(([, value]) => value !== undefined && value !== '')));
}

