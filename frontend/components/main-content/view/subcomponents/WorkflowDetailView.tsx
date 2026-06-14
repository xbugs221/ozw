/**
 * PURPOSE: Render a workflow control-plane detail tree with stage, substage,
 * artifact, and child-session inspection data.
 */
import { useEffect, useMemo, useState } from 'react';
const AlertTriangle = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const Play = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polygon points="6,3 20,12 6,21" fill="currentColor" stroke="none"/></svg>;
import type {
  Project,
  ProjectWorkflow,
  SessionProvider,
  WorkflowArtifact,
  WorkflowChildSession,
  WorkflowDisplayLine,
  WorkflowRunnerProcess,
  WorkflowStageInspection,
  WorkflowSubstageInspection,
} from '../../../../types/app';
import { api } from '../../../../utils/api';
import { findWorkflowChildSession } from '../../../../utils/workflowSessions';

type WorkflowDetailViewProps = {
  project: Project;
  workflow: ProjectWorkflow;
  onNavigateToSession: (
    sessionId: string,
    options?: {
      provider?: SessionProvider;
      projectName?: string;
      projectPath?: string;
      workflowId?: string;
      workflowStageKey?: string;
      routePath?: string;
      routeSearch?: Record<string, string>;
    },
  ) => void;
  onOpenArtifactFile: (filePath: string) => void;
  onOpenArtifactDirectory: (directoryPath: string) => void;
  onContinueWorkflow?: (workflow: ProjectWorkflow) => Promise<void> | void;
};

const workflowDetailCache = new Map<string, ProjectWorkflow>();

type FreshWorkflowState = {
  identityKey: string;
  workflow: ProjectWorkflow;
};

/**
 * Build the display identity for one workflow detail so stale data is kept
 * only while revalidating the same routed workflow.
 */
function buildWorkflowDetailIdentityKey(project: Project, workflow: ProjectWorkflow): string {
  return [
    project.fullPath || project.path || project.name,
    workflow.id,
  ].join(':');
}

/**
 * Build a stable cache key for one project workflow detail response.
 */
function buildWorkflowDetailCacheKey(project: Project, workflow: ProjectWorkflow): string {
  const stageSignature = (workflow.stageStatuses || [])
    .map((stage) => `${stage.key}:${stage.status}`)
    .join('|');
  return [
    project.fullPath || project.path || project.name,
    workflow.id,
    workflow.updatedAt || '',
    workflow.runState || '',
    workflow.stage || '',
    workflow.gateDecision || '',
    stageSignature,
  ].join(':');
}

type WorkflowVisualProgress = {
  stageStatuses: Record<string, string>;
  substageStatuses: Record<string, string>;
};

/**
 * PURPOSE: Preserve workflow session routing context so the chat view resolves
 * the correct provider/session history after navigation or reload.
 */
function buildWorkflowSessionRouteOptions(
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

function isCompletedStatus(status: string): boolean {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'completed' || normalized === 'ready' || normalized === 'skipped';
}

function isActiveStatus(status: string): boolean {
  /**
   * Collapse all in-flight or attention-needed backend states into the single
   * yellow lamp state requested for the workflow detail tree.
   */
  const normalized = String(status || '').toLowerCase();
  return normalized === 'active' || normalized === 'running' || normalized === 'blocked' || normalized === 'failed';
}

function normalizeLampStatus(status: string): string {
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

function getTodoTextTone(status: string): string {
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

function getLinkTone(status: string): string {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'blocked' || normalized === 'failed') {
    return 'text-indigo-700 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200';
  }
  if (normalized === 'active' || normalized === 'running') {
    return 'text-indigo-600 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200';
  }
  return 'text-indigo-600 hover:text-violet-700 dark:text-violet-300 dark:hover:text-violet-200';
}

function getWorkflowStageTreeTitle(stage: WorkflowStageInspection): string {
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

function getCompactAgentLabel(value: string | null | undefined): string {
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

function resolveArtifactPath(project: Project, artifact: WorkflowArtifact): string | null {
  /**
   * Support both server-normalized absolute paths and older relative paths.
   */
  const artifactPath = typeof artifact.path === 'string' ? artifact.path.trim() : '';
  if (!artifactPath) {
    return null;
  }

  if (artifactPath.startsWith('/')) {
    return artifactPath;
  }

  const projectRoot = project.fullPath || project.path || '';
  if (!projectRoot) {
    return artifactPath;
  }

  return `${projectRoot.replace(/[/\\]+$/, '')}/${artifactPath.replace(/^[/\\]+/, '')}`;
}

function resolveArtifactType(artifact: WorkflowArtifact): 'file' | 'directory' {
  /**
   * Treat directories explicitly and default everything else to file opening.
   */
  if (artifact.type === 'directory') {
    return 'directory';
  }

  return 'file';
}

function getArtifactFileName(artifact: WorkflowArtifact): string {
  /**
   * Prefer the persisted relative path because oz flow artifacts are project-scoped,
   * then fall back to the normalized path and label for older records.
   */
  const artifactPath = artifact.relativePath || artifact.path || artifact.label || '';
  return artifactPath.split(/[\\/]/).filter(Boolean).at(-1) || artifact.label || artifact.id;
}

function getArtifactRound(artifact: WorkflowArtifact, stagePrefix: string): number {
  /**
   * Extract the oz flow review/fix round from either stage keys or generated artifact
   * filenames so the role row can link only the latest current-round artifact.
   */
  const stageMatch = String(artifact.stage || '').match(new RegExp(`^${stagePrefix}_(\\d+)$`));
  if (stageMatch) {
    return Number(stageMatch[1]);
  }
  const nameMatch = getArtifactFileName(artifact).match(new RegExp(`^${stagePrefix}-(\\d+)\\.(?:json|md|markdown)$`, 'i'));
  return nameMatch ? Number(nameMatch[1]) : 0;
}

function getArtifactExtension(artifact: WorkflowArtifact): string {
  /**
   * Read the visible artifact extension so equal-round candidates can prefer the
   * most useful format for a compact role row.
   */
  return getArtifactFileName(artifact).split('.').pop()?.toLowerCase() || '';
}

function getLatestRoundArtifact(
  workflow: ProjectWorkflow,
  prefixes: string[],
  preferredExtensions: string[] = ['json', 'md', 'markdown'],
): WorkflowArtifact | null {
  /**
   * Pick one existing artifact for the latest review/fix round, ignoring
   * directories and missing path references that would open a broken link.
   */
  const candidates = (workflow.artifacts || [])
    .filter((artifact) => artifact.exists !== false && resolveArtifactType(artifact) === 'file')
    .map((artifact) => {
      const matchedPrefix = prefixes.find((prefix) => (
        new RegExp(`^${prefix}_\\d+$`).test(String(artifact.stage || ''))
        || new RegExp(`^${prefix}-\\d+\\.(?:json|md|markdown)$`, 'i').test(getArtifactFileName(artifact))
      ));
      return matchedPrefix ? { artifact, round: getArtifactRound(artifact, matchedPrefix) } : null;
    })
    .filter((candidate): candidate is { artifact: WorkflowArtifact; round: number } => Boolean(candidate && candidate.round > 0));

  const extensionPriority = (artifact: WorkflowArtifact) => {
    const index = preferredExtensions.indexOf(getArtifactExtension(artifact));
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  candidates.sort((left, right) => (
    right.round - left.round
    || extensionPriority(left.artifact) - extensionPriority(right.artifact)
    || getArtifactFileName(left.artifact).localeCompare(getArtifactFileName(right.artifact))
  ));
  return candidates[0]?.artifact || null;
}

function getRoleSummaryArtifact(workflow: ProjectWorkflow, rowKey: string): WorkflowArtifact | null {
  /**
   * Map compact role rows to the one artifact that best represents the latest
   * visible work for that role.
   */
  if (rowKey === 'reviewer') {
    return getLatestRoundArtifact(workflow, ['review'], ['json', 'md', 'markdown']);
  }
  if (rowKey === 'executor') {
    return (workflow.artifacts || []).find((artifact) => (
      artifact.exists !== false
      && resolveArtifactType(artifact) === 'file'
      && (artifact.type === 'summary' || artifact.semanticType === 'summary' || artifact.semanticType === 'workflow_output')
    )) || null;
  }
  if (rowKey === 'acceptance') {
    return (workflow.artifacts || []).find((artifact) => (
      artifact.exists !== false
      && resolveArtifactType(artifact) === 'file'
      && (artifact.type === 'acceptance-summary' || artifact.semanticType === 'acceptance-summary')
    )) || null;
  }
  if (rowKey === 'fixer') {
    return getLatestRoundArtifact(workflow, ['repair', 'fix'], ['md', 'markdown', 'json']);
  }
  if (rowKey === 'archiver') {
    return (workflow.artifacts || []).find((artifact) => (
      resolveArtifactType(artifact) === 'file'
      && (artifact.type === 'delivery-summary' || artifact.semanticType === 'delivery-summary' || getArtifactFileName(artifact) === 'delivery-summary.json')
    )) || null;
  }
  if (rowKey === 'qa') {
    return getLatestRoundArtifact(workflow, ['qa'], ['json', 'md', 'markdown']);
  }
  return null;
}

function buildFallbackStageInspections(workflow: ProjectWorkflow): WorkflowStageInspection[] {
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

function isWorkflowReviewStageKey(stageKey: string | null | undefined): boolean {
  /**
   * Recognize both the current independent review stages and legacy workflow
   * records that stored all reviewer passes under one verification stage.
   */
  return /^review_\d+$/.test(String(stageKey || '')) || stageKey === 'verification';
}

function getExactSubstageSessions(substage: WorkflowSubstageInspection): WorkflowChildSession[] {
  /**
   * Workflow sessions are stage-owned for single-step stages, while reviewer
   * passes are keyed by the concrete substage they prove.
   */
  return (substage.agentSessions || []).filter((session) => (
    session.stageKey === substage.stageKey || session.stageKey === substage.substageKey
  ));
}

function getRenderableSubstageSessions(substage: WorkflowSubstageInspection, hiddenSessionId?: string | null): WorkflowChildSession[] {
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

function buildSubstageStatusKey(stageKey: string, substageKey: string): string {
  /**
   * Keep substage visual status keyed by parent stage because review and repair
   * phases can reuse similar substage names across old workflow records.
   */
  return `${stageKey}:${substageKey}`;
}

function getWorkflowDiagnosticsValue(workflow: ProjectWorkflow, key: string): string {
  /**
   * Read display-only oz flow diagnostics without requiring the frontend to parse raw
   * runner state or know the original state.json shape.
   */
  const diagnostics = (workflow.runnerDiagnostics || workflow.diagnostics || {}) as Record<string, unknown>;
  const value = diagnostics[key];
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return typeof value === 'string' && value.trim() ? value : '无';
}

function getWorkflowDiagnosticWarnings(workflow: ProjectWorkflow): string[] {
  /**
   * Normalize backend mapping warnings for the diagnostics section.
   */
  const diagnostics = (workflow.runnerDiagnostics || workflow.diagnostics || {}) as Record<string, unknown>;
  return Array.isArray(diagnostics.warnings)
    ? diagnostics.warnings.map((warning) => String(warning)).filter(Boolean)
    : [];
}

function renderWorkflowDisplayLines(
  project: Project,
  workflow: ProjectWorkflow,
  onNavigateToSession: WorkflowDetailViewProps['onNavigateToSession'],
  testId = 'workflow-display-lines',
) {
  /**
   * Render oz flow-visible checklist rows as the workflow's primary progress view.
   */
  const lines = workflow.workflowDisplay?.lines || [];
  if (lines.length === 0) {
    return null;
  }

  const buildSession = (line: WorkflowDisplayLine): WorkflowChildSession | null => {
    const ref = line.sessionRef;
    if (!ref?.sessionId) {
      return null;
    }
    return {
      id: ref.sessionId,
      title: ref.label,
      summary: ref.label,
      provider: ref.provider || 'codex',
      workflowId: workflow.runId || workflow.id,
      stageKey: ref.stageKey,
      address: ref.address,
      routePath: ref.routePath,
    };
  };

  const buildChildSessionForStage = (stageKey: string): WorkflowChildSession | null => (
    (workflow.childSessions || []).find((session) => session.stageKey === stageKey) || null
  );

  const renderSessionButton = (
    session: WorkflowChildSession,
    label: string,
    key: string,
  ) => (
    <button
      key={key}
      type="button"
      className="truncate text-left text-sm font-medium text-primary underline decoration-current underline-offset-2"
      onClick={() => onNavigateToSession(
        session.id,
        buildWorkflowSessionRouteOptions(project, workflow, session),
      )}
    >
      {label}
    </button>
  );

  return (
    <section className="space-y-2" data-testid={testId} aria-label="workflow display">
      {lines.map((line) => {
        const session = buildSession(line);
        const fixReviewMatch = line.text.match(/^(\d+)\s+fix\s+review$/);
        const fixOnlyMatch = line.text.match(/^(\d+)\s+fix$/);
        const splitFixSession = fixReviewMatch
          ? buildChildSessionForStage(`fix_${fixReviewMatch[1]}`) || buildChildSessionForStage(`repair_${fixReviewMatch[1]}`)
          : null;
        return (
          <div
            key={line.id}
            className="flex min-h-8 items-center gap-3 rounded-md border border-border/50 bg-background/70 px-3 py-1.5 text-sm"
            data-testid={`workflow-display-line-${line.id}`}
          >
            <span className={line.marker === '✓' ? 'text-green-500' : line.marker === '→' ? 'text-blue-500' : 'text-muted-foreground'}>
              {line.marker || ' '}
            </span>
            {fixReviewMatch && (splitFixSession || session) ? (
              <span className="flex min-w-0 items-center gap-1 font-medium">
                <span>{fixReviewMatch[1]}</span>
                {splitFixSession
                  ? renderSessionButton(splitFixSession, 'fix', `${line.id}:fix`)
                  : <span>fix</span>}
                {session
                  ? renderSessionButton(session, 'review', `${line.id}:review`)
                  : <span>review</span>}
              </span>
            ) : fixOnlyMatch && session ? (
              <span className="flex min-w-0 items-center gap-1 font-medium">
                <span>{fixOnlyMatch[1]}</span>
                {renderSessionButton(session, 'fix', `${line.id}:fix`)}
              </span>
            ) : session ? (
              renderSessionButton(session, line.text, `${line.id}:session`)
            ) : (
              <span className="font-medium text-foreground">{line.text}</span>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Find planning oz-change-doc artifacts for the planning role row.
 */
function getPlanningDocArtifacts(workflow: ProjectWorkflow): WorkflowArtifact[] {
  return (workflow.artifacts || []).filter((artifact) => (
    (artifact.type === 'oz-change-doc' || artifact.semanticType === 'oz-change-doc')
    && artifact.stage === 'planning'
  ));
}

function renderWorkflowRoleRowPlanningDocs(
  project: Project,
  workflow: ProjectWorkflow,
  onOpenArtifactFile: WorkflowDetailViewProps['onOpenArtifactFile'],
) {
  const planningDocs = getPlanningDocArtifacts(workflow);
  if (planningDocs.length === 0) {
    return null;
  }

  const docOrder = ['brief.md', 'proposal.md', 'design.md', 'spec.md', 'task.md', 'acceptance.json'];
  const getDocOrder = (label: string) => {
    if (label.startsWith('tests/')) {
      return docOrder.length;
    }
    const index = docOrder.indexOf(label);
    return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
  };
  const sortedDocs = [...planningDocs].sort((a, b) => (
    getDocOrder(a.label) - getDocOrder(b.label) || a.label.localeCompare(b.label)
  ));

  return (
    <>
      {sortedDocs.map((doc) => {
        const docPath = resolveArtifactPath(project, doc);
        const canOpen = Boolean(docPath && doc.exists !== false);
        return (
          <button
            key={doc.id}
            type="button"
            disabled={!canOpen}
            className={[
              'truncate text-left text-sm',
              canOpen
                ? 'font-medium text-primary underline decoration-current underline-offset-2'
                : 'text-muted-foreground cursor-default',
            ].join(' ')}
            title={canOpen ? (doc.relativePath || doc.path || doc.label) : `${doc.label} 尚未生成`}
            onClick={() => {
              if (docPath && canOpen) {
                onOpenArtifactFile(docPath);
              }
            }}
          >
            {doc.label}
          </button>
        );
      })}
    </>
  );
}

function renderWorkflowStatusSummary(
  project: Project,
  workflow: ProjectWorkflow,
  onNavigateToSession: WorkflowDetailViewProps['onNavigateToSession'],
) {
  const summary = workflow.workflowStatusSummary;
  if (!summary || !summary.rows || summary.rows.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2" data-testid="workflow-status-summary-new" aria-label="workflow status summary">
      {summary.engine ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded bg-secondary px-1.5 py-0.5 font-medium">引擎</span>
          <span>{summary.engine}</span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {summary.rows.map((row) => {
          const session = row.sessionId
            ? findWorkflowChildSession(workflow.childSessions, row.sessionId, {
                provider: row.provider,
                stageKey: row.stageKeys?.length === 1 ? row.stageKeys[0] : undefined,
              })
            : null;
          const hasLink = Boolean(row.sessionId);
          return (
            <div
              key={row.key}
              className={[
                'flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
                row.active
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border/50 bg-background/70',
              ].join(' ')}
              data-testid={`workflow-status-row-${row.key}`}
              title={row.stageKeys.join(', ')}
            >
              <span className="w-6 shrink-0 font-medium text-foreground">{row.label}</span>
              <span className="font-mono text-green-500">{row.markerText}</span>
              {hasLink && row.sessionId ? (
                <button
                  type="button"
                  className="truncate text-left text-sm font-medium text-primary underline decoration-current underline-offset-2"
                  onClick={() => {
                    const sessionId = row.sessionId;
                    if (!sessionId) return;
                    if (session) {
                      onNavigateToSession(
                        sessionId,
                        buildWorkflowSessionRouteOptions(project, workflow, session),
                      );
                    } else {
                      onNavigateToSession(sessionId, {
                        provider: (row.provider || 'codex') as SessionProvider,
                        projectName: project.name,
                        projectPath: project.fullPath || project.path || '',
                        workflowId: workflow.id,
                      });
                    }
                  }}
                >
                  会话
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function renderWorkflowRoleSummary(
  project: Project,
  workflow: ProjectWorkflow,
  onNavigateToSession: WorkflowDetailViewProps['onNavigateToSession'],
  onOpenArtifactFile: WorkflowDetailViewProps['onOpenArtifactFile'],
) {
  const rows = workflow.workflowRoleSummary?.rows;
  if (!rows || rows.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2" data-testid="workflow-role-summary" aria-label="workflow role summary">
      {rows.map((row) => {
        const sessionRef = row.sessionRef;
        const checks = row.checkCount || 0;
        const unlinked = sessionRef && (sessionRef as any).unlinked === true;
        const hasLink = Boolean(sessionRef?.sessionId) && !unlinked;
        const currentArtifact = getRoleSummaryArtifact(workflow, row.key);
        const currentArtifactPath = currentArtifact ? resolveArtifactPath(project, currentArtifact) : null;
        const isPlanning = row.key === 'planning';
        return (
          <div
            key={row.key}
            className="flex min-h-8 items-center gap-3 rounded-md border border-border/50 bg-background/70 px-3 py-1.5 text-sm"
            data-testid={`workflow-role-row-${row.key}`}
          >
            <span className="w-6 shrink-0 font-medium text-foreground">{row.label}</span>
            {unlinked ? (
              <span className="truncate text-muted-foreground" title={sessionRef.label || sessionRef.sessionId}>
                {sessionRef.sessionId || sessionRef.label}
              </span>
            ) : hasLink && sessionRef ? (
              <button
                type="button"
                className="truncate text-left text-sm font-medium text-primary underline decoration-current underline-offset-2"
                title={sessionRef.label || sessionRef.sessionId}
                onClick={() => {
                  const childSession = findWorkflowChildSession(
                    workflow.childSessions,
                    sessionRef.sessionId,
                    {
                      provider: sessionRef.provider,
                      stageKey: sessionRef.stageKey,
                      address: sessionRef.address,
                      routePath: sessionRef.routePath,
                    },
                  );
                  if (childSession) {
                    onNavigateToSession(
                      sessionRef.sessionId,
                      buildWorkflowSessionRouteOptions(project, workflow, childSession),
                    );
                  } else {
                    onNavigateToSession(sessionRef.sessionId, {
                      provider: (sessionRef.provider || 'codex') as SessionProvider,
                      projectName: project.name,
                      projectPath: project.fullPath || project.path || '',
                      workflowId: workflow.id,
                    });
                  }
                }}
              >
                会话
              </button>
            ) : isPlanning ? (
              <span className="text-muted-foreground">{row.placeholder || '—'}</span>
            ) : (
              <span className="text-muted-foreground">{row.placeholder || '—'}</span>
            )}
            {isPlanning
              ? renderWorkflowRoleRowPlanningDocs(project, workflow, onOpenArtifactFile)
              : currentArtifact && currentArtifact.exists !== false && currentArtifactPath ? (
                <button
                  type="button"
                  className="truncate text-left text-sm font-medium text-primary underline decoration-current underline-offset-2"
                  title={currentArtifact.relativePath || currentArtifact.path || currentArtifact.label}
                  onClick={() => onOpenArtifactFile(currentArtifactPath)}
                >
                  {getArtifactFileName(currentArtifact)}
                </button>
              ) : null}
            {checks ? (
              <span className="ml-auto text-green-500" data-testid={`workflow-role-checks-${row.key}`}>
                x{checks}
              </span>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

function hasSubstageEvidence(substage: WorkflowSubstageInspection): boolean {
  /**
   * Treat a persisted child session or inspectable output as proof that the
   * workflow reached this substage, even if older stored status rows still say
   * pending.
   */
  return isCompletedStatus(substage.status)
    || getExactSubstageSessions(substage).length > 0
    || (substage.files || []).some((file) => file.exists !== false && file.status !== 'missing');
}

function buildVisualProgress(stageInspections: WorkflowStageInspection[]): WorkflowVisualProgress {
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

function getPrimaryStageSession(stage: WorkflowStageInspection): WorkflowChildSession | null {
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

function getWorkflowSessionDisplayLabel(session: WorkflowChildSession): string {
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

function getExecutionSessionDisplayLabel(session: WorkflowChildSession): string {
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

function getDisplaySubstageSessions(
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

function renderArtifactLink(
  project: Project,
  artifact: WorkflowArtifact,
  onOpenArtifactFile: (filePath: string) => void,
  onOpenArtifactDirectory: (directoryPath: string) => void,
  key: string,
  variant: 'row' | 'inline' = 'row',
) {
  /**
   * Open one workflow artifact from either an indented evidence row or an
   * inline stage summary row.
   */
  const artifactPath = resolveArtifactPath(project, artifact);
  const artifactType = resolveArtifactType(artifact);
  const canOpen = Boolean(artifactPath && artifact.exists !== false);
  const artifactContent = (
    <div className="flex items-center gap-2">
      <span
        className={[
          'text-sm',
          canOpen
            ? `${getLinkTone(artifact.status)} underline decoration-current underline-offset-2`
            : getTodoTextTone(artifact.status),
        ].join(' ')}
      >
        {artifact.label}
      </span>
    </div>
  );

  if (!canOpen) {
    return null;
  }

  return (
    <button
      key={key}
      type="button"
      className={[
        'rounded text-left hover:bg-accent/30',
        variant === 'inline' ? 'inline-flex px-1 py-0.5' : 'block px-2 py-1',
      ].join(' ')}
      onClick={() => {
        if (!artifactPath) {
          return;
        }

        if (artifactType === 'directory') {
          onOpenArtifactDirectory(artifactPath);
          return;
        }

        onOpenArtifactFile(artifactPath);
      }}
    >
      {artifactContent}
    </button>
  );
}

function renderSubstageFiles(
  project: Project,
  substage: WorkflowSubstageInspection,
  onOpenArtifactFile: (filePath: string) => void,
  onOpenArtifactDirectory: (directoryPath: string) => void,
) {
  /**
   * Render file and directory outputs inline so users can inspect deliverables
   * without leaving the workflow detail view.
   */
  const substageFiles = (substage.files || []).filter((artifact) => artifact.exists !== false);
  if (substageFiles.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1 pl-5">
      {substageFiles.map((artifact) => renderArtifactLink(
        project,
        artifact,
        onOpenArtifactFile,
        onOpenArtifactDirectory,
        `${substage.substageKey}-${artifact.id}`,
      ))}
    </div>
  );
}

function renderSubstageSessions(
  project: Project,
  workflow: ProjectWorkflow,
  substage: WorkflowSubstageInspection,
  onNavigateToSession: WorkflowDetailViewProps['onNavigateToSession'],
  hiddenSessionId?: string | null,
) {
  /**
   * Surface reviewer and repair child sessions as first-class audit evidence so
   * workflow stages do not hide the actual internal review conversations.
   */
  const sessions = getDisplaySubstageSessions(substage, hiddenSessionId);
  if (sessions.length === 0) {
    return null;
  }
  const isExecutionSubstage = substage.stageKey === 'execution';
  const renderSessionLink = (session: WorkflowChildSession) => {
    /**
     * PURPOSE: Render one child-session link consistently while allowing the
     * execution phase to use a round-first business label.
     */
    const visibleLabel = isExecutionSubstage
      ? getExecutionSessionDisplayLabel(session)
      : getWorkflowSessionDisplayLabel(session);
    return (
      <button
        key={`${substage.substageKey}-${session.id}`}
        type="button"
        className="block w-full rounded px-2 py-1 text-left hover:bg-accent/30"
        onClick={() => {
          onNavigateToSession(
            session.id,
            buildWorkflowSessionRouteOptions(project, workflow, session),
          );
        }}
      >
        <span className={['text-sm underline decoration-current underline-offset-2', getLinkTone(substage.status)].join(' ')}>
          {visibleLabel}
        </span>
      </button>
    );
  };

  if (isExecutionSubstage) {
    return (
      <div className="space-y-1">
        {sessions.map(renderSessionLink)}
      </div>
    );
  }

  return (
    <div className="space-y-1 pl-5">
      {sessions.map(renderSessionLink)}
    </div>
  );
}

function buildRunnerProcessSession(
  workflow: ProjectWorkflow,
  process: WorkflowRunnerProcess,
): WorkflowChildSession | null {
  /**
   * PURPOSE: Resolve runner process thread rows to workflow child-session route
   * records so process links enter `/wN/cM` instead of project manual routes.
   */
  if (!process.sessionId) {
    return null;
  }
  const processProvider = String(process.provider || '').trim();
  if (processProvider && processProvider !== 'codex' && processProvider !== 'pi') {
    return null;
  }
  return findWorkflowChildSession(workflow.childSessions, process.sessionId, {
    provider: process.provider,
    stageKey: process.stage,
  }) || {
    id: process.sessionId,
    title: process.stage,
    provider: process.provider || 'codex',
    workflowId: workflow.id,
    stageKey: process.stage,
  };
}

function renderRunnerProcesses(
  project: Project,
  workflow: ProjectWorkflow,
  onNavigateToSession: WorkflowDetailViewProps['onNavigateToSession'],
  onOpenArtifactFile: WorkflowDetailViewProps['onOpenArtifactFile'],
) {
  /**
   * PURPOSE: Show Go runner process rows from the backend read model without
   * parsing terminal output in the browser.
   */
  const processes = Array.isArray(workflow.runnerProcesses) ? workflow.runnerProcesses : [];
  if (processes.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2" data-testid="workflow-runner-processes">
      <h3 className="text-sm font-semibold text-foreground">进程</h3>
      <div className="overflow-hidden rounded-md border border-border">
        {processes.map((process, index) => {
          const session = buildRunnerProcessSession(workflow, process);
          const meta = [
            process.role ? `role=${process.role}` : '',
            process.pid !== undefined ? `pid=${process.pid}` : '',
            process.exitCode !== undefined ? `exit=${process.exitCode}` : '',
            process.failed !== undefined ? `failed=${process.failed ? 'true' : 'false'}` : '',
          ].filter(Boolean).join(' ');
          return (
            <div
              key={`${process.stage}-${process.role}-${process.sessionId || index}`}
              className="grid gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 md:grid-cols-[minmax(7rem,1fr)_minmax(6rem,0.8fr)_minmax(10rem,1.3fr)_auto]"
            >
              <div className="font-medium text-foreground">{process.stage}</div>
              <div className="text-muted-foreground">{process.status}</div>
              <div className="min-w-0 text-muted-foreground">
                {session ? (
                  <button
                    type="button"
                    className="max-w-full truncate text-left text-indigo-600 underline decoration-current underline-offset-2 hover:text-violet-700 dark:text-violet-300"
                    onClick={() => onNavigateToSession(
                      session.id,
                      buildWorkflowSessionRouteOptions(project, workflow, session),
                    )}
                  >
                    thread={process.sessionId}
                  </button>
                ) : meta || 'pending'}
                {session && meta ? <span className="ml-2">{meta}</span> : null}
              </div>
              <div className="flex justify-start md:justify-end">
                {process.logPath ? (
                  <button
                    type="button"
                    className="text-indigo-600 underline decoration-current underline-offset-2 hover:text-violet-700 dark:text-violet-300"
                    onClick={() => onOpenArtifactFile(process.logPath || '')}
                  >
                    log
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function renderStageControlPlaneEvents(stage: WorkflowStageInspection) {
  /**
   * Render workflow controller warnings and recovery records beside the stage
   * that owns the affected child-session index.
   */
  const warnings = (Array.isArray(stage.warnings) ? stage.warnings : []).filter((event) => {
    const message = String(event.message || event.type || '');
    return !/Expected .* artifact not found:/i.test(message);
  });
  const recoveryEvents = Array.isArray(stage.recoveryEvents) ? stage.recoveryEvents : [];
  if (warnings.length === 0 && recoveryEvents.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1 pl-8" data-testid={`workflow-stage-control-plane-events-${stage.stageKey}`}>
      {warnings.map((event, index) => (
        <div
          key={`warning-${event.type}-${event.createdAt || index}`}
          className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-800/70 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
          <span>{event.message || event.type}</span>
        </div>
      ))}
      {recoveryEvents.map((event, index) => (
        <div
          key={`recovery-${event.type}-${event.createdAt || index}`}
          className="rounded-md border border-emerald-300/60 bg-emerald-50 px-2 py-1 text-xs text-emerald-900 dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          {event.message || event.type}
        </div>
      ))}
    </div>
  );
}

export default function WorkflowDetailView({
  project,
  workflow,
  onNavigateToSession,
  onOpenArtifactFile,
  onOpenArtifactDirectory,
  onContinueWorkflow,
}: WorkflowDetailViewProps) {
  const [freshWorkflow, setFreshWorkflow] = useState<FreshWorkflowState | null>(null);
  const currentWorkflowIdentityKey = buildWorkflowDetailIdentityKey(project, workflow);
  const currentWorkflow = freshWorkflow?.identityKey === currentWorkflowIdentityKey
    ? freshWorkflow.workflow
    : workflow;
  useEffect(() => {
    /**
     * PURPOSE: Re-read workflow detail from the backend so route-selected views
     * reflect external conf.json edits and cross-tab provider changes.
     */
    let cancelled = false;
    const identityKey = buildWorkflowDetailIdentityKey(project, workflow);
    const cacheKey = buildWorkflowDetailCacheKey(project, workflow);
    const cachedWorkflow = workflowDetailCache.get(cacheKey);
    if (cachedWorkflow) {
      setFreshWorkflow({ identityKey, workflow: cachedWorkflow });
      return () => {
        cancelled = true;
      };
    }
    setFreshWorkflow((current) => (
      current?.identityKey === identityKey ? current : null
    ));
    api.projectWorkflow(project.name, workflow.id)
      .then(async (response) => {
        if (!response.ok || cancelled) {
          return;
        }
        const nextWorkflow = await response.json();
        workflowDetailCache.set(cacheKey, nextWorkflow);
        setFreshWorkflow({ identityKey, workflow: nextWorkflow });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [project.fullPath, project.name, project.path, workflow.id, workflow.updatedAt, workflow.gateDecision, workflow.runState]);
  /**
   * Go-runner state/log changes arrive through workflow_changed sidebar events;
   * the one-time fetch effect above re-reads the detail when the workflow prop
   * updates.  No constant polling interval is needed.
   */
  const stageInspections = useMemo(
    () => (currentWorkflow.stageInspections && currentWorkflow.stageInspections.length > 0
      ? currentWorkflow.stageInspections
      : buildFallbackStageInspections(currentWorkflow)),
    [currentWorkflow],
  );
  const visualProgress = useMemo(() => buildVisualProgress(stageInspections), [stageInspections]);
  const getSubstageVisualStatus = (stage: WorkflowStageInspection, substage: WorkflowSubstageInspection) => (
    visualProgress.substageStatuses[buildSubstageStatusKey(stage.stageKey, substage.substageKey)] || normalizeLampStatus(substage.status)
  );
  const continueState = useMemo(
    () => (freshWorkflow?.identityKey === currentWorkflowIdentityKey
      ? resolveContinueState(currentWorkflow, stageInspections)
      : { canContinue: false, disabled: true, label: '继续推进' }),
    [currentWorkflow, currentWorkflowIdentityKey, freshWorkflow, stageInspections],
  );
  const stageTree = (
    <div
      className="relative mt-4 space-y-3 border-t border-border/40 pt-4"
      data-testid="workflow-status-tree"
    >
      {stageInspections.map((stage) => {
        const collapsedSubstage = getSingleStageSubstage(stage);
        const stageSession = getPrimaryStageSession(stage);
        const collapsedSubstageVisualStatus = collapsedSubstage
          ? getSubstageVisualStatus(stage, collapsedSubstage)
          : null;
        const existingCollapsedFiles = (collapsedSubstage?.files || []).filter((artifact) => artifact.exists !== false);
        const inlineArtifacts = shouldInlineStageArtifacts(stage.stageKey)
          ? existingCollapsedFiles
          : [];

        return (
          <div key={stage.stageKey} className="contents">
            <div
              data-testid={`workflow-status-tree-row-${stage.stageKey}`}
              className="space-y-2"
            >
              <div
                data-testid={collapsedSubstage ? `workflow-substage-${collapsedSubstage.substageKey}` : undefined}
                className="flex items-center gap-2 rounded-md bg-card/80 py-1"
              >
                {stageSession ? (
                  <button
                    type="button"
                    className={[
                      'min-w-0 text-left text-sm font-medium underline decoration-current underline-offset-2',
                      getLinkTone(stage.status),
                    ].join(' ')}
                    onClick={() => {
                      onNavigateToSession(
                        stageSession.id,
                        buildWorkflowSessionRouteOptions(project, currentWorkflow, stageSession),
                      );
                    }}
                  >
                    {getWorkflowStageTreeTitle(stage)}
                  </button>
                ) : (
                  <span className={['text-sm font-medium', getTodoTextTone(stage.status)].join(' ')}>
                    {getWorkflowStageTreeTitle(stage)}
                  </span>
                )}
                {stage.durationText ? (
                  <span className="text-xs tabular-nums text-muted-foreground">{stage.durationText}</span>
                ) : null}
                {inlineArtifacts.length > 0 ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {inlineArtifacts.map((artifact) => renderArtifactLink(
                      project,
                      artifact,
                      onOpenArtifactFile,
                      onOpenArtifactDirectory,
                      `${stage.stageKey}-${artifact.id}`,
                      'inline',
                    ))}
                  </div>
                ) : null}
              </div>
              {renderStageControlPlaneEvents(stage)}

              {collapsedSubstage ? (
                <div className="space-y-1 pl-5">
                  {renderSubstageSessions(
                    project,
                    currentWorkflow,
                    collapsedSubstage,
                    onNavigateToSession,
                    stageSession?.id,
                  )}
                  {inlineArtifacts.length > 0 ? null : renderSubstageFiles(
                    project,
                    { ...collapsedSubstage, status: collapsedSubstageVisualStatus || collapsedSubstage.status },
                    onOpenArtifactFile,
                    onOpenArtifactDirectory,
                  )}
                </div>
              ) : (
                <div className="space-y-2 pl-5">
                  {getDisplaySubstages(stage).map((substage) => {
                    const substageVisualStatus = getSubstageVisualStatus(stage, substage);
                    return (
                    <div key={substage.substageKey} data-testid={`workflow-substage-${substage.substageKey}`} className="space-y-1">
                      <div className="flex items-center gap-2 rounded-md bg-card/80 py-1">
                        <span className={['text-sm', getTodoTextTone(substage.status)].join(' ')}>
                          {substage.title}
                        </span>
                      </div>
                      {renderSubstageSessions(project, currentWorkflow, substage, onNavigateToSession, stageSession?.id)}
                      {renderSubstageFiles(
                        project,
                        { ...substage, status: substageVisualStatus },
                        onOpenArtifactFile,
                        onOpenArtifactDirectory,
                      )}
                    </div>
                  );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4 md:px-6">
        <div className="rounded-lg border border-border/50 bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              {currentWorkflow.batchDisplayId && (
                <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>自动工作流</span>
                  <span>/</span>
                  <span>{currentWorkflow.batchDisplayId}</span>
                  <span>/</span>
                  <span className="text-foreground">{currentWorkflow.title}</span>
                </div>
              )}
              <h2 className="text-xl font-semibold text-foreground">{currentWorkflow.title}</h2>
              {currentWorkflow.runner === 'go' && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>Go runner: {currentWorkflow.runId || '未绑定'}</span>
                  <span>阶段: {currentWorkflow.stage}</span>
                  <span>状态: {currentWorkflow.runState}</span>
                  <span>Provider: Codex</span>
                  {currentWorkflow.batchDisplayId && (
                    <span>批量: {currentWorkflow.batchDisplayId} {currentWorkflow.batchIndex}/{currentWorkflow.batchTotal}</span>
                  )}
                  {currentWorkflow.runnerError && (
                    <span
                      className="basis-full whitespace-pre-wrap break-words rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-destructive"
                      data-testid="workflow-runner-error"
                    >
                      {currentWorkflow.runnerError}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {continueState.canContinue && (
                <button
                  type="button"
                  disabled={continueState.disabled}
                  className={[
                    'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm',
                    continueState.disabled
                      ? 'cursor-not-allowed border-border bg-background text-muted-foreground opacity-70'
                      : 'border-primary/40 bg-primary/10 text-foreground',
                  ].join(' ')}
                  onClick={() => onContinueWorkflow?.(currentWorkflow)}
                >
                  <Play className="h-4 w-4 fill-current" />
                  {continueState.label}
                </button>
              )}
            </div>
          </div>
          <div className="mt-4" data-testid="workflow-status-summary">
            {stageTree}
          </div>
        </div>
      </div>
    </div>
  );
}
