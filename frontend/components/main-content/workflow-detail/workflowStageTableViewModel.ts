/**
 * PURPOSE: Project raw workflow stage inspections into the compact stage table
 * used by the workflow detail page.
 */
import type { ProjectWorkflow, WorkflowArtifact, WorkflowChildSession, WorkflowStageInspection, WorkflowSubstageInspection } from '../../../types/app';
import { getArtifactFileName } from './workflowArtifactLinks';
import { getCompactAgentLabel, getExactSubstageSessions, getRenderableSubstageSessions, getWorkflowStageTreeTitle, isCompletedStatus } from './workflowDetailViewModel';

export type WorkflowStageTableEntry = {
  id: string;
  kind: 'session' | 'artifact';
  label: string;
  status: string;
  session?: WorkflowChildSession;
  artifact?: WorkflowArtifact;
};

export type WorkflowStageTableColumn = {
  key: string;
  label: string;
  order: number;
  entries: WorkflowStageTableEntry[];
};

export function getPrimaryStageSession(stage: WorkflowStageInspection): WorkflowChildSession | null {
  /**
   * Treat the flat stage row as the only workflow-session navigation entry.
   * Substages remain evidence/artifact rows and must not create nested session links.
   */
  const collapsedSubstage = getSingleStageSubstage(stage);
  const exactStageSessions = stage.substages.flatMap((substage) => (
    getExactSubstageSessions(substage).filter((session) => session.stageKey === stage.stageKey)
  ));
  const primaryStageSession = exactStageSessions.find((session) => (
    session.title === stage.stageKey
    || session.role === stage.stageKey
    || ['executor', 'reviewer', 'fixer', 'qa', 'archiver', 'planner', 'planning'].includes(String(session.role || ''))
  ));
  if (primaryStageSession) {
    return primaryStageSession;
  }

  if (collapsedSubstage && (stage.stageKey === 'archive' || collapsedSubstage.substageKey === 'delivery_package')) {
    /**
     * Archive can contain repeated delivery registrations. The stage title should
     * still link to the latest package session instead of falling back to text.
     */
    return getRenderableSubstageSessions(collapsedSubstage)[0] || null;
  }

  const candidateSessions = stage.substages
    .flatMap((substage) => getExactSubstageSessions(substage).length > 0
      ? getExactSubstageSessions(substage)
      : (substage.agentSessions || []));
  const uniqueSessions = Array.from(new Map(candidateSessions.map((session) => [getWorkflowSessionIdentityKey(session), session])).values());
  return uniqueSessions.length === 1 ? uniqueSessions[0] || null : null;
}

function getSingleStageSubstage(stage: WorkflowStageInspection): WorkflowSubstageInspection | null {
  /**
   * Collapse one-child stages into the stage row itself when the child only
   * mirrors the stage concept.
   */
  const collapsibleStage = [
    'planning',
    'execution',
    'archive',
  ].includes(stage.stageKey)
    || /^(?:review|qa|fix|repair)_\d+$/.test(stage.stageKey);
  if (!collapsibleStage || stage.substages.length !== 1) {
    return null;
  }
  return stage.substages[0];
}

function isFollowCandidate(status: string): boolean {
  /**
   * Only running or problematic nodes should take follow priority over the
   * rest of the tree when auto-follow is enabled.
   */
  const normalized = String(status || '').toLowerCase();
  return normalized === 'active' || normalized === 'running' || normalized === 'blocked' || normalized === 'failed';
}

function resolveContinueState(workflow: ProjectWorkflow, stageInspections: WorkflowStageInspection[]): {
  canContinue: boolean;
  disabled: boolean;
  label: string;
} {
  /**
   * The workflow is backend-driven after execution starts. Keep the manual
   * continue affordance only for legacy/no-proposal planning handoff.
   */
  const getStageStatus = (stageKey: string): string => {
    const persistedStatus = workflow.stageStatuses.find((stage) => stage.key === stageKey)?.status;
    const inspectionStatus = stageInspections.find((stage) => stage.stageKey === stageKey)?.status;
    return String(persistedStatus || inspectionStatus || '').toLowerCase();
  };
  const executionStatus = getStageStatus('execution');
  const executionStarted = Boolean(
    workflow.childSessions.some((session) => session.stageKey === 'execution')
    || ['completed', 'skipped'].includes(executionStatus),
  );
  const hasOpenSpecChange = Boolean(
    workflow.openspecChangeName
    || workflow.openspecChangeDetected
    || workflow.adoptsExistingOpenSpec,
  );
  const hasPlanningSession = workflow.childSessions.some((session) => session.stageKey === 'planning');

  if (workflow.runner === 'go') {
    return { canContinue: false, disabled: true, label: 'Go runner 执行中' };
  }

  if ((isCompletedStatus(getStageStatus('planning')) || hasPlanningSession || hasOpenSpecChange) && !executionStarted) {
    return {
      canContinue: true,
      disabled: false,
      label: '继续推进',
    };
  }

  return { canContinue: false, disabled: true, label: '继续推进' };
}

function shouldInlineStageArtifacts(stageKey: string): boolean {
  /**
   * PURPOSE: Stages with one visible artifact should keep that file beside the
   * session link instead of nesting another level.
   */
  return stageKey === 'archive' || /^(?:review|qa|fix|repair)_\d+$/.test(stageKey);
}

function getStageItemRound(value: string): number {
  /**
   * PURPOSE: Execution fan-out rows should stay in workflow round order instead
   * of alphabetical subagent-role order.
   */
  const match = String(value || '').match(/(?:^|[:_\s-])(\d+)(?:$|[:_\s-])/);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }
  const round = Number(match[1]);
  return Number.isFinite(round) ? round : Number.MAX_SAFE_INTEGER;
}

function getDisplaySubstages(stage: WorkflowStageInspection): WorkflowSubstageInspection[] {
  /**
   * PURPOSE: Keep execution substages in natural round order while preserving
   * backend order for other stages.
   */
  if (stage.stageKey !== 'execution') {
    return stage.substages;
  }
  return [...stage.substages].sort((left, right) => (
    getStageItemRound(left.substageKey || left.title) - getStageItemRound(right.substageKey || right.title)
  ));
}

export function getWorkflowSessionDisplayLabel(session: WorkflowChildSession): string {
  /**
   * PURPOSE: Show compact subagent labels while keeping a single source for
   * display ordering and rendering.
   */
  const compactRole = getCompactAgentLabel(session.role);
  const compactTitle = getCompactAgentLabel(session.title || session.summary);
  return compactRole && !['executor', 'reviewer', 'fixer', 'qa', 'archiver', 'planner', 'planning'].includes(compactRole)
    ? compactRole
    : compactTitle || '子会话';
}

export function getExecutionSessionDisplayLabel(session: WorkflowChildSession): string {
  /**
   * PURPOSE: Execution child sessions need a compact round-first label so the
   * detail card reads as a chronological checklist instead of a role matrix.
   */
  const workflowLabel = getWorkflowSessionDisplayLabel(session);
  const rawLabel = session.role || session.title || session.summary || workflowLabel;
  const round = getStageItemRound(rawLabel);
  const roundLabel = round === Number.MAX_SAFE_INTEGER ? '-' : String(round);
  return `${roundLabel} ${workflowLabel || '子会话'}`;
}

function getWorkflowSessionPhaseOrder(label: string): number {
  /**
   * PURPOSE: Preserve workflow phase order inside execution fan-out rows after
   * grouping by round.
   */
  const normalized = String(label || '').toLowerCase()
    .replace(/^(?:codex|pi):/, '')
    .replace(/^subagent:/, '');
  if (normalized.startsWith('planning_context:')) return 0;
  if (normalized.startsWith('implementation_context:')) return 1;
  if (normalized.startsWith('review:')) return 2;
  if (normalized.startsWith('qa:')) return 3;
  if (normalized.startsWith('fix:') || normalized.startsWith('repair:')) return 4;
  return 5;
}

export function getDisplaySubstageSessions(
  substage: WorkflowSubstageInspection,
  hiddenSessionId?: string | null,
): WorkflowChildSession[] {
  /**
   * PURPOSE: Execution parallel sessions are easier to scan by workflow round
   * than by subagent identity.
   */
  const sessions = getRenderableSubstageSessions(substage, hiddenSessionId);
  if (substage.stageKey !== 'execution') {
    return sessions;
  }
  return sessions
    .map((session, index) => ({
      session,
      index,
      label: getWorkflowSessionDisplayLabel(session),
      phaseLabel: session.role || session.title || session.summary || '',
    }))
    .sort((left, right) => (
      getStageItemRound(left.phaseLabel) - getStageItemRound(right.phaseLabel)
      || getWorkflowSessionPhaseOrder(left.phaseLabel) - getWorkflowSessionPhaseOrder(right.phaseLabel)
      || left.index - right.index
    ))
    .map((entry) => entry.session);
}

function getWorkflowSessionIdentityKey(session: WorkflowChildSession): string {
  /**
   * PURPOSE: Deduplicate only exact workflow session routes so reused provider
   * thread ids in different stages or rounds keep their own clickable target.
   */
  return [
    session.provider || 'codex',
    session.id,
    session.routePath || '',
    session.address || '',
    session.stageKey || '',
  ].join(':');
}

function getWorkflowLogicalStage(stageKey: string): { key: string; label: string; order: number } {
  /**
   * PURPOSE: Collapse runner loop stages into the business columns users scan:
   * plan, execution, review, fix, QA, and archive.
   */
  const normalized = String(stageKey || '').trim();
  if (normalized === 'planning' || normalized === 'acceptance' || normalized === 'ready_for_acceptance') {
    return { key: 'planning', label: '规划', order: 10 };
  }
  if (normalized === 'execution') {
    return { key: 'execution', label: '执行', order: 20 };
  }
  if (/^review_\d+$/.test(normalized) || normalized === 'verification') {
    return { key: 'review', label: '审核', order: 30 };
  }
  if (/^(?:fix|repair)_\d+$/.test(normalized)) {
    return { key: 'fix', label: '修正', order: 40 };
  }
  if (normalized === 'qa' || /^qa_\d+$/.test(normalized)) {
    return { key: 'qa', label: 'QA', order: 50 };
  }
  if (normalized === 'archive') {
    return { key: 'archive', label: '归档', order: 60 };
  }
  return { key: normalized || 'unknown', label: getWorkflowStageTreeTitle({ stageKey: normalized, title: normalized, status: '', substages: [] }).replace(/阶段$/u, ''), order: 90 };
}

function stripAgentSuffix(label: string): string {
  /**
   * PURPOSE: Keep table session links compact by showing the role name without
   * the generic "员" suffix requested for tree-style labels.
   */
  return String(label || '').trim().replace(/员$/u, '');
}

function getWorkflowStageTableSessionLabel(session: WorkflowChildSession, logicalLabel: string): string {
  /**
   * PURPOSE: Render session links as agent names, falling back to the owning
   * business stage for main workflow agent sessions.
   */
  const displayLabel = stripAgentSuffix(getWorkflowSessionDisplayLabel(session));
  const compactRole = stripAgentSuffix(getCompactAgentLabel(session.role));
  if (displayLabel && !['executor', 'reviewer', 'fixer', 'qa', 'archiver', 'planner', 'planning', 'acceptance'].includes(displayLabel)) {
    return displayLabel;
  }
  if (compactRole && !['executor', 'reviewer', 'fixer', 'qa', 'archiver', 'planner', 'planning', 'acceptance'].includes(compactRole)) {
    return compactRole;
  }
  return logicalLabel;
}

function isParallelWorkflowArtifact(artifact: WorkflowArtifact, substage: WorkflowSubstageInspection): boolean {
  /**
   * PURPOSE: Identify fan-in artifacts produced by parallel child agents so the
   * table can place them before the main agent session that consumes them.
   */
  const searchableText = [
    artifact.id,
    artifact.label,
    artifact.path,
    artifact.relativePath,
    artifact.type,
    artifact.semanticType,
    artifact.substageKey,
    substage.substageKey,
    substage.title,
  ].filter(Boolean).join(' ').toLowerCase();
  return /(?:^|[\s/_.-])parallel(?:$|[\s/_.-])|fan[-_\s]?in|subagent/.test(searchableText);
}

export function buildWorkflowStageTableColumns(stageInspections: WorkflowStageInspection[]): WorkflowStageTableColumn[] {
  /**
   * PURPOSE: Convert raw runner stages into grouped business columns. Each
   * column keeps its own chronological order and one cell represents one item.
   */
  const columns = new Map<string, WorkflowStageTableColumn>();
  const seenSessionKeysByColumn = new Map<string, Set<string>>();

  const resolveColumn = (stageKey: string): WorkflowStageTableColumn => {
    const logicalStage = getWorkflowLogicalStage(stageKey);
    const existing = columns.get(logicalStage.key);
    if (existing) {
      return existing;
    }
    const nextColumn = {
      key: logicalStage.key,
      label: logicalStage.label,
      order: logicalStage.order,
      entries: [],
    };
    columns.set(logicalStage.key, nextColumn);
    seenSessionKeysByColumn.set(logicalStage.key, new Set<string>());
    return nextColumn;
  };

  stageInspections.forEach((stage) => {
    const column = resolveColumn(stage.stageKey);
    const primarySession = getPrimaryStageSession(stage);
    const primarySessionKey = primarySession ? getWorkflowSessionIdentityKey(primarySession) : '';
    const seenSessionKeys = seenSessionKeysByColumn.get(column.key) || new Set<string>();
    const subagentEntries: WorkflowStageTableEntry[] = [];
    const prePrimaryArtifactEntries: WorkflowStageTableEntry[] = [];
    const artifactEntries: WorkflowStageTableEntry[] = [];

    getDisplaySubstages(stage).forEach((substage) => {
      getDisplaySubstageSessions(substage).forEach((session) => {
        const sessionKey = getWorkflowSessionIdentityKey(session);
        if (sessionKey === primarySessionKey || seenSessionKeys.has(sessionKey)) {
          return;
        }
        seenSessionKeys.add(sessionKey);
        subagentEntries.push({
          id: `session-${stage.stageKey}-${sessionKey}`,
          kind: 'session',
          label: getWorkflowStageTableSessionLabel(session, column.label),
          status: substage.status,
          session,
        });
      });

      (substage.files || [])
        .filter((artifact) => artifact.exists !== false)
        .forEach((artifact) => {
          const artifactEntry = {
            id: `artifact-${stage.stageKey}-${substage.substageKey}-${artifact.id}`,
            kind: 'artifact',
            label: getArtifactFileName(artifact),
            status: artifact.status || substage.status,
            artifact,
          } satisfies WorkflowStageTableEntry;
          if (primarySession && isParallelWorkflowArtifact(artifact, substage)) {
            prePrimaryArtifactEntries.push(artifactEntry);
          } else {
            artifactEntries.push(artifactEntry);
          }
        });
    });

    const primaryEntries: WorkflowStageTableEntry[] = [];
    if (primarySession && !seenSessionKeys.has(primarySessionKey)) {
      seenSessionKeys.add(primarySessionKey);
      primaryEntries.push({
        id: `session-${stage.stageKey}-${primarySessionKey}`,
        kind: 'session',
        label: column.label,
        status: stage.status,
        session: primarySession,
      });
    }

    column.entries.push(
      ...subagentEntries,
      ...prePrimaryArtifactEntries,
      ...primaryEntries,
      ...artifactEntries,
    );
  });

  return [...columns.values()]
    .filter((column) => column.entries.length > 0)
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
}
