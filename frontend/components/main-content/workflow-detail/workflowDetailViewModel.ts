/**
 * PURPOSE: Build workflow detail view models that keep status, progress, and
 * navigation decisions outside the React composition component.
 */
import type { Project, ProjectWorkflow, SessionProvider, WorkflowChildSession, WorkflowStageInspection, WorkflowSubstageInspection } from '../../../types/app';

export type WorkflowVisualProgress = {
  stageStatuses: Record<string, string>;
  substageStatuses: Record<string, string>;
};

export function buildWorkflowSessionRouteOptions(
  project: Project,
  workflow: ProjectWorkflow,
  session: WorkflowChildSession,
): {
  provider: SessionProvider;
  projectName: string;
  projectPath: string;
  workflowId: string;
  workflowStageKey?: string;
  routePath?: string;
} {
  const normalizedProvider: SessionProvider = session.provider === 'pi'
      || (project.piSessions || []).some((candidate) => candidate.id === session.id)
      ? 'pi'
      : 'codex';
  return {
    provider: normalizedProvider,
    projectName: project.name,
    projectPath: project.fullPath || project.path || '',
    workflowId: workflow.id,
    workflowStageKey: session.stageKey,
    routePath: session.routePath,
  };
}

export function isCompletedStatus(status: string): boolean {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'completed' || normalized === 'ready' || normalized === 'skipped';
}

export function isActiveStatus(status: string): boolean {
  /**
   * Collapse all in-flight or attention-needed backend states into the single
   * yellow lamp state requested for the workflow detail tree.
   */
  const normalized = String(status || '').toLowerCase();
  return normalized === 'active' || normalized === 'running' || normalized === 'blocked' || normalized === 'failed';
}

export function normalizeLampStatus(status: string): string {
  /**
   * Reduce backend workflow state to the three visible lamp states: pending,
   * active, and completed.
   */
  if (isCompletedStatus(status)) {
    return 'completed';
  }
  if (isActiveStatus(status)) {
    return 'active';
  }
  return 'pending';
}

export function getTodoTextTone(status: string): string {
  const normalized = String(status || '').toLowerCase();
  if (isCompletedStatus(normalized)) {
    return 'text-foreground';
  }
  if (normalized === 'active' || normalized === 'running') {
    return 'text-foreground';
  }
  if (normalized === 'blocked' || normalized === 'failed') {
    return 'text-foreground';
  }
  return 'text-muted-foreground';
}

export function getLinkTone(status: string): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'blocked' || normalized === 'failed') {
    return 'text-indigo-700 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200';
  }
  if (normalized === 'active' || normalized === 'running') {
    return 'text-indigo-600 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200';
  }
  return 'text-indigo-600 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200';
}


export function getWorkflowStageTreeTitle(stage: WorkflowStageInspection): string {
  /**
   * PURPOSE: Match the oz flow status tree labels expected by workflow reviewers.
   */
  if (stage.stageKey === 'execution') {
    return '执行阶段';
  }
  if (/^review_\d+$/.test(stage.stageKey) || stage.stageKey === 'verification') {
    return '审核阶段';
  }
  if (/^(?:fix|repair)_\d+$/.test(stage.stageKey)) {
    return '修复阶段';
  }
  if (/^qa(?:_\d+)?$/.test(stage.stageKey)) {
    return 'QA 阶段';
  }
  if (stage.stageKey === 'archive') {
    return '归档阶段';
  }
  if (stage.stageKey === 'planning') {
    return '规划阶段';
  }
  return stage.title;
}

export function getCompactAgentLabel(value: string | null | undefined): string {
  /**
   * Hide technical graph prefixes while preserving the human business role.
   */
  const compact = String(value || '')
    .replace(/^(?:review|qa|fix|repair|planning(?:_context)?|implementation_context)\s+subagent:\s*/i, '')
    .replace(/^subagent:\s*/i, '')
    .replace(/^(?:review|qa|fix|repair|planning(?:_context)?|implementation_context):/i, '')
    .trim();
  return compact.replace(/:\d+$/i, '').trim();
}


export function buildFallbackStageInspections(workflow: ProjectWorkflow): WorkflowStageInspection[] {
  /**
   * Preserve the previous coarse detail view when the backend has not yet
   * attached the richer stage tree.
   */
  return workflow.stageStatuses.map((stage) => ({
    stageKey: stage.key,
    title: stage.label,
    status: stage.status,
    provider: stage.provider,
    note: undefined,
    substages: [],
  }));
}

export function isWorkflowReviewStageKey(stageKey: string | null | undefined): boolean {
  /**
   * Recognize both the current independent review stages and legacy workflow
   * records that stored all reviewer passes under one verification stage.
   */
  return /^review_\d+$/.test(String(stageKey || '')) || stageKey === 'verification';
}

export function getExactSubstageSessions(substage: WorkflowSubstageInspection): WorkflowChildSession[] {
  /**
   * Workflow sessions are stage-owned for single-step stages, while reviewer
   * passes are keyed by the concrete substage they prove.
   */
  return (substage.agentSessions || []).filter((session) => (
    session.stageKey === substage.stageKey || session.stageKey === substage.substageKey
  ));
}

export function getRenderableSubstageSessions(substage: WorkflowSubstageInspection, hiddenSessionId?: string | null): WorkflowChildSession[] {
  /**
   * Keep terminal archive evidence readable without surfacing repeated delivery
   * session registrations as multiple competing archive links.
   */
  const sessions = getExactSubstageSessions(substage);
  if (substage.stageKey !== 'archive' && substage.substageKey !== 'delivery_package') {
    return sessions.filter((session) => session.id !== hiddenSessionId);
  }

  const latestSession = sessions.at(-1);
  if (latestSession?.id === hiddenSessionId) {
    return [];
  }
  return latestSession ? [latestSession] : [];
}

export function buildSubstageStatusKey(stageKey: string, substageKey: string): string {
  /**
   * Keep substage visual status keyed by parent stage because review and repair
   * phases can reuse similar substage names across old workflow records.
   */
  return `${stageKey}:${substageKey}`;
}


export function hasSubstageEvidence(substage: WorkflowSubstageInspection): boolean {
  /**
   * Treat a persisted child session or inspectable output as proof that the
   * workflow reached this substage, even if older stored status rows still say
   * pending.
   */
  return isCompletedStatus(substage.status)
    || getExactSubstageSessions(substage).length > 0
    || (substage.files || []).some((file) => file.exists !== false && file.status !== 'missing');
}

export function buildVisualProgress(stageInspections: WorkflowStageInspection[]): WorkflowVisualProgress {
  /**
   * Derive three-state lamp progress from evidence order. If a later stage has
   * evidence, earlier stages are visually passed; only the next stage after that
   * may show yellow from raw active state, and all later stages stay dark.
   */
  let lastEvidenceStageIndex = -1;
  let lastEvidenceSubstageIndex = -1;

  stageInspections.forEach((stage, stageIndex) => {
    let substageIndex = -1;
    stage.substages.forEach((substage, index) => {
      if (hasSubstageEvidence(substage)) {
        substageIndex = index;
      }
    });
    if (substageIndex >= 0 || isCompletedStatus(stage.status)) {
      lastEvidenceStageIndex = stageIndex;
      lastEvidenceSubstageIndex = Math.max(substageIndex, 0);
    }
  });

  return {
    stageStatuses: Object.fromEntries(stageInspections.map((stage, stageIndex) => {
      let status = 'pending';
      if (stageIndex <= lastEvidenceStageIndex) {
        status = 'completed';
      } else if (stageIndex === lastEvidenceStageIndex + 1) {
        status = normalizeLampStatus(stage.status);
      }
      return [stage.stageKey, status];
    })),
    substageStatuses: Object.fromEntries(stageInspections.flatMap((stage, stageIndex) => (
      stage.substages.map((substage, substageIndex) => {
        const completedByProgress = stageIndex < lastEvidenceStageIndex
          || (stageIndex === lastEvidenceStageIndex && substageIndex <= lastEvidenceSubstageIndex);
        let status = 'pending';
        if (completedByProgress) {
          status = 'completed';
        } else if (
          stageIndex === lastEvidenceStageIndex
          || stageIndex === lastEvidenceStageIndex + 1
        ) {
          status = normalizeLampStatus(substage.status);
        }
        return [buildSubstageStatusKey(stage.stageKey, substage.substageKey), status];
      })
    ))),
  };
}

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
  const uniqueSessions = Array.from(new Map(candidateSessions.map((session) => [session.id, session])).values());
  return uniqueSessions.length === 1 ? uniqueSessions[0] || null : null;
}

export function getSingleStageSubstage(stage: WorkflowStageInspection): WorkflowSubstageInspection | null {
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

export function isFollowCandidate(status: string): boolean {
  /**
   * Only running or problematic nodes should take follow priority over the
   * rest of the tree when auto-follow is enabled.
   */
  const normalized = String(status || '').toLowerCase();
  return normalized === 'active' || normalized === 'running' || normalized === 'blocked' || normalized === 'failed';
}

export function resolveContinueState(workflow: ProjectWorkflow, stageInspections: WorkflowStageInspection[]): {
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

