/**
 * PURPOSE: Own workflow DAG target normalization used by workflow read models.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { resolveFlowRunsRoot } from '../flow-runtime-paths.js';
import { acceptedProviderFromSessionKey } from './session-refs.js';
import { mapStageStatus } from './stage-taxonomy.js';

type DagTarget = Record<string, any>;
type DagNode = Record<string, any>;
type CommandResult = {
  ok: boolean;
  error: string;
  data: any;
};

type BuildWorkflowDagArgs = {
  projectPath: string;
  runDirName: string;
  state: Record<string, any>;
  changeName: string;
  childSessions: Array<Record<string, any>>;
  artifacts: Array<Record<string, any>>;
  stageStatuses: Array<Record<string, any>>;
  warnings: string[];
};

const execFileAsync = promisify(execFile);

/**
 * Return a snake_case runner field value.
 */
function pick(object: Record<string, any> | null | undefined, snakeKey: string): any {
  return object?.[snakeKey];
}

/**
 * Convert unknown errors into stable diagnostic text.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Return whether a project-relative path currently exists.
 */
async function pathExists(projectPath: string, relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(projectPath, relativePath));
    return true;
  } catch {
    return false;
  }
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
 * Group review targets from DAG nodes by their owning workflow stage.
 */
export function collectDagTargetsByStage(workflowDag: Record<string, any> | null | undefined): Map<string, {
  sessions: Array<{ target: DagTarget; node: DagNode }>;
  artifacts: Array<{ target: DagTarget; node: DagNode }>;
}> {
  const targetsByStage = new Map<string, {
    sessions: Array<{ target: DagTarget; node: DagNode }>;
    artifacts: Array<{ target: DagTarget; node: DagNode }>;
  }>();
  for (const node of workflowDag?.nodes || []) {
    const nodeStage = String(node.stage || '').trim();
    for (const target of node.reviewTargets || []) {
      const stageKey = String(target.stageKey || nodeStage || '').trim();
      if (!stageKey || target.kind === 'node-metadata') {
        continue;
      }
      if (!targetsByStage.has(stageKey)) {
        targetsByStage.set(stageKey, { sessions: [], artifacts: [] });
      }
      const bucket = targetsByStage.get(stageKey);
      if (!bucket) {
        continue;
      }
      if (target.kind === 'session' && target.sessionId) {
        bucket.sessions.push({ target, node });
      } else if (target.kind === 'artifact' && target.path) {
        bucket.artifacts.push({ target, node });
      }
    }
  }
  return targetsByStage;
}

/**
 * Add graph-only session targets to a stage without duplicating runner process sessions.
 */
export function mergeStageSessions(
  stageSessions: Array<Record<string, any>>,
  dagSessions: Array<{ target: DagTarget; node: DagNode }>,
  stageKey: string,
): Array<Record<string, any>> {
  const merged = [...stageSessions];
  const seen = new Set(merged.map((session) => `${session.provider || 'codex'}:${session.id}`));
  for (const { target, node } of dagSessions) {
    const provider = target.provider || 'codex';
    const sessionId = String(target.sessionId || '').trim();
    const key = `${provider}:${sessionId}`;
    if (!sessionId || seen.has(key)) {
      continue;
    }
    const role = String(node?.member || target.label || node?.label || sessionId).trim();
    merged.push({
      id: sessionId,
      title: String(target.label || node?.label || role || sessionId),
      provider,
      role,
      stageKey,
      routePath: target.routePath,
    });
    seen.add(key);
  }
  return merged;
}

/**
 * Add graph-only artifact targets to a stage without replacing scanned run artifacts.
 */
export function mergeStageArtifacts(
  stageArtifacts: Array<Record<string, any>>,
  dagArtifacts: Array<{ target: DagTarget; node: DagNode }>,
  stageKey: string,
  status: string,
): Array<Record<string, any>> {
  const merged = [...stageArtifacts];
  const seen = new Set(merged.map((artifact) => String(artifact.path || artifact.relativePath || artifact.label || '').trim()));
  for (const { target, node } of dagArtifacts) {
    const artifactPath = String(target.path || '').trim();
    const label = String(target.label || path.basename(artifactPath)).trim();
    const key = artifactPath || label;
    if (!key || seen.has(key)) {
      continue;
    }
    merged.push({
      id: `dag:${node?.id || stageKey}:${label}`,
      label,
      status,
      type: 'file',
      semanticType: 'dag-review-target',
      stage: stageKey,
      substageKey: stageKey,
      relativePath: artifactPath,
      path: artifactPath,
      exists: target.exists !== false,
      source: 'workflow-dag',
    });
    seen.add(key);
  }
  return merged;
}

/**
 * Read oz flow graph JSON for a change.
 */
export async function runWoGraph(projectPath: string, changeName: string): Promise<CommandResult> {
  if (!projectPath || !changeName) {
    return { ok: false, error: 'missing projectPath or changeName', data: null };
  }
  try {
    const { stdout } = await execFileAsync('oz', ['flow', 'graph', '--change', changeName, '--format', 'json'], {
      cwd: projectPath,
      timeout: 15000,
      maxBuffer: 1024 * 1024 * 4,
    });
    const trimmed = String(stdout || '').trim();
    if (!trimmed) {
      return { ok: false, error: 'oz flow graph returned empty output', data: null };
    }
    const data = JSON.parse(trimmed);
    return { ok: true, error: '', data };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error),
      data: null,
    };
  }
}

/**
 * Read oz flow status JSON for a run.
 */
export async function runWoStatus(projectPath: string, runId: string): Promise<CommandResult> {
  if (!projectPath || !runId) {
    return { ok: false, error: 'missing projectPath or runId', data: null };
  }
  try {
    const { stdout } = await execFileAsync('oz', ['flow', 'status', '--run-id', runId, '--json'], {
      cwd: projectPath,
      timeout: 5000,
      maxBuffer: 1024 * 1024 * 4,
    });
    const trimmed = String(stdout || '').trim();
    if (!trimmed) {
      return { ok: false, error: 'oz flow status returned empty output', data: null };
    }
    return { ok: true, error: '', data: JSON.parse(trimmed) };
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error),
      data: null,
    };
  }
}

/**
 * Build a workflow DAG read model from oz flow graph/runtime evidence.
 */
export async function buildWorkflowDag({
  projectPath,
  runDirName,
  state,
  changeName,
  childSessions,
  artifacts,
  stageStatuses,
  warnings,
}: BuildWorkflowDagArgs): Promise<Record<string, any>> {
  const graphResult = await runWoGraph(projectPath, changeName);
  const inlineGraph = pick(state, 'workflow_dag');
  const hasInlineGraph = Boolean(inlineGraph && typeof inlineGraph === 'object');

  const source = {
    command: `oz flow graph --change ${changeName} --format json`,
    format: hasInlineGraph ? 'state workflow_dag json' : 'oz flow graph json',
    available: Boolean(graphResult.ok || hasInlineGraph),
    ...(graphResult.error && !hasInlineGraph ? { error: graphResult.error } : {}),
  };

  if (!graphResult.ok && !hasInlineGraph) {
    warnings.push(`oz flow graph unavailable: ${graphResult.error}`);
    return { source, nodes: [], edges: [], artifacts: [], gates: [] };
  }

  if (hasInlineGraph && graphResult.ok) {
    warnings.push('Using state workflow_dag instead of oz flow graph output for this run.');
  } else if (!graphResult.ok && hasInlineGraph) {
    warnings.push(`oz flow graph unavailable; using state workflow_dag: ${graphResult.error}`);
  }

  const raw = (hasInlineGraph ? inlineGraph : (graphResult.data || {})) as Record<string, any>;
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const rawArtifacts = Array.isArray(raw.artifacts) ? raw.artifacts : [];
  const rawGates = Array.isArray(raw.gates) ? raw.gates : [];

  const sessions = pick(state, 'sessions') || {};
  const runId = String(pick(state, 'run_id') || '').trim();
  if (runId.includes('/') || runId.includes('\\') || runId.includes('..')) {
    warnings.push(`Invalid run_id in state: ${runId}`);
  }
  const runDir = path.join(resolveFlowRunsRoot(projectPath), runDirName);
  const dagNodes = pick(state, 'dag_nodes') || {};
  const currentStage = String(pick(state, 'stage') || '').trim();
  const rawStatus = String(pick(state, 'status') || '').trim();
  const stageStatusMap = new Map((stageStatuses || []).map((stage) => [stage.key, stage.status]));
  const rawNodeById = new Map<string, Record<string, any>>();
  for (const rawNode of rawNodes) {
    const nodeId = String(rawNode.id || '').trim();
    if (nodeId) {
      rawNodeById.set(nodeId, rawNode);
    }
  }

  /**
   * Accept only graph artifact paths that stay inside the current run dir.
   */
  function resolveGraphArtifactPath(graphArtifact: Record<string, any>): Record<string, string> | null {
    const artifactPath = String(graphArtifact?.path || '').trim();
    if (!artifactPath || path.isAbsolute(artifactPath)) {
      return null;
    }
    const normalized = path.normalize(artifactPath);
    if (normalized === '.' || normalized.startsWith('..')) {
      return null;
    }
    const absolutePath = path.resolve(runDir, normalized);
    const relativeToRun = path.relative(runDir, absolutePath);
    if (relativeToRun.startsWith('..') || path.isAbsolute(relativeToRun)) {
      return null;
    }
    return {
      artifactPath,
      absolutePath,
      relativeToProject: path.relative(projectPath, absolutePath),
    };
  }

  /**
   * Treat a graph gate as runtime evidence only when it carries an explicit
   * non-pending runtime signal, not merely a template id from oz flow graph.
   */
  function isRuntimeBackedGraphGate(gate: Record<string, any>): boolean {
    const status = String(gate?.status || gate?.state || '').toLowerCase();
    if (status && status !== 'pending') {
      return true;
    }
    return Boolean(
      gate?.decision
      || gate?.result
      || gate?.outcome
      || gate?.artifact
      || gate?.artifact_path
      || gate?.path
      || gate?.started_at
      || gate?.finished_at
    );
  }

  /**
   * Bind a subagent template node only when a real child session proves that
   * member actually ran for the same stage.
   */
  function findSubagentSession(node: Record<string, any>): Record<string, any> | null {
    const stage = String(node.stage || '').trim();
    const member = String(node.member || '').trim();
    if (!stage || !member) {
      return null;
    }
    return childSessions.find((session) => (
      session.stageKey === stage
      && (session.role === member || session.title?.includes(member))
    )) || null;
  }

  /**
   * Read session targets already embedded in a persisted workflow_dag node.
   */
  function getInlineSessionTargets(node: Record<string, any>): Array<Record<string, any>> {
    if (!Array.isArray(node?.reviewTargets)) {
      return [];
    }
    return node.reviewTargets.filter((target: Record<string, any>) => (
      target
      && target.kind === 'session'
      && String(target.sessionId || '').trim()
    ));
  }

  const evidenceStageKeys = new Set<string>();
  const stagesData = pick(state, 'stages') || {};
  for (const [stageKey, status] of Object.entries(stagesData && typeof stagesData === 'object' ? stagesData : {})) {
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

  const evidenceNodeIds = new Set<string>();
  for (const [nodeId, nodeData] of Object.entries(dagNodes || {})) {
    const nodeStatus = String((nodeData as Record<string, any>)?.status || '').toLowerCase();
    if (nodeStatus && nodeStatus !== 'pending') {
      evidenceNodeIds.add(nodeId);
    }
  }

  for (const rawNode of rawNodes) {
    const nodeId = String(rawNode.id || '').trim();
    const nodeType = String(rawNode.type || '').trim();
    if (nodeId && nodeType === 'subagent' && (findSubagentSession(rawNode) || getInlineSessionTargets(rawNode).length > 0)) {
      evidenceNodeIds.add(nodeId);
    }
  }

  for (const rawArtifact of rawArtifacts) {
    const nodeId = String(rawArtifact?.node_id || '').trim();
    const artifactLocation = resolveGraphArtifactPath(rawArtifact);
    if (!nodeId || !artifactLocation) {
      continue;
    }
    let exists = false;
    try {
      await fs.access(artifactLocation.absolutePath);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      continue;
    }
    evidenceNodeIds.add(nodeId);
    const stage = String(rawNodeById.get(nodeId)?.stage || '').trim();
    if (stage) {
      evidenceStageKeys.add(stage);
    }
  }

  for (const rawGate of rawGates) {
    if (!isRuntimeBackedGraphGate(rawGate)) {
      continue;
    }
    const gateId = String(rawGate?.id || '').trim();
    const stage = String(rawGate?.stage || '').trim();
    if (gateId) {
      evidenceNodeIds.add(gateId);
    }
    if (stage) {
      evidenceStageKeys.add(stage);
    }
  }

  const keepNodeIds = new Set(rawNodes
    .map((rawNode) => String(rawNode.id || '').trim())
    .filter(Boolean));

  /**
   * Build a session review target from a session id.
   */
  function buildSessionTarget(
    sessionId: string,
    label: string,
    stageKey: string,
    providerHint?: string,
  ): Record<string, any> | null {
    if (!sessionId) return null;
    const provider = providerHint || resolveSessionProviderFromState(sessionId, sessions) || 'codex';
    const childSession = childSessions.find((session) => (
      session.id === sessionId
      && (session.provider || 'codex') === provider
      && (!stageKey || session.stageKey === stageKey)
    )) || childSessions.find((session) => (
      session.id === sessionId
      && (!stageKey || session.stageKey === stageKey)
    )) || childSessions.find((session) => (
      session.id === sessionId
      && (session.provider || 'codex') === provider
    ));
    return {
      kind: 'session',
      label: label || sessionId,
      sessionId,
      provider,
      routePath: childSession?.routePath || `/runs/${encodeURIComponent(runId)}/sessions/by-id/${encodeURIComponent(sessionId)}`,
      stageKey,
    };
  }

  /**
   * Build an artifact review target from a graph artifact path.
   */
  async function buildArtifactTarget(graphArtifact: Record<string, any>): Promise<Record<string, any> | null> {
    const artifactLocation = resolveGraphArtifactPath(graphArtifact);
    const nodeId = String(graphArtifact.node_id || '').trim();
    if (!artifactLocation) return null;
    const exists = await pathExists(projectPath, artifactLocation.relativeToProject);
    return {
      kind: 'artifact',
      label: artifactLocation.artifactPath,
      path: artifactLocation.absolutePath,
      exists,
      nodeId,
    };
  }

  /**
   * Map main_stage nodes to stage sessions.
   */
  function findStageSession(node: Record<string, any>): Record<string, any> | null {
    const stage = String(node.stage || '').trim();
    if (!stage) return null;
    const session = childSessions.find((entry) => entry.stageKey === stage);
    if (session) return session;
    const roleMap: Record<string, string[]> = {
      execution: ['executor', 'codex:executor', 'pi:executor'],
      archive: ['archiver', 'codex:archiver', 'pi:archiver'],
    };
    const keys = [...(roleMap[stage] || [])];
    if (/^review_\d+$/.test(stage)) {
      keys.push('reviewer', 'codex:reviewer', 'pi:reviewer');
    } else if (/^qa(?:_\d+)?$/.test(stage)) {
      keys.push('qa', 'codex:qa', 'pi:qa');
    } else if (/^(?:fix|repair)_\d+$/.test(stage)) {
      keys.push('fixer', 'codex:fixer', 'pi:fixer');
    }
    keys.push(stage);
    for (const key of keys) {
      if (sessions[key]) {
        const sessionId = String(sessions[key]).trim();
        const parsed = acceptedProviderFromSessionKey(key);
        return { id: sessionId, provider: parsed.provider, stageKey: stage };
      }
    }
    return null;
  }

  /**
   * Resolve DAG node status by merging sealed state dag_nodes, stage statuses,
   * and graph raw status.
   */
  function resolveNodeStatus(nodeId: string, stage: string, rawStatusStr: unknown): string {
    const dagNodeStatus = dagNodes?.[nodeId]?.status;
    if (dagNodeStatus) {
      return mapStageStatus(dagNodeStatus);
    }

    if (stage && stageStatusMap.has(stage)) {
      const mapped = stageStatusMap.get(stage);
      if (stage === currentStage) {
        return mapStageStatus(rawStatus || mapped);
      }
      return mapped;
    }

    return mapStageStatus(String(rawStatusStr || 'pending'));
  }

  const artifactsByStage = new Map<string, Array<Record<string, any>>>();
  for (const artifact of artifacts) {
    if (artifact.stage) {
      if (!artifactsByStage.has(artifact.stage)) {
        artifactsByStage.set(artifact.stage, []);
      }
      artifactsByStage.get(artifact.stage)?.push(artifact);
    }
  }

  const artifactTargets = new Map<string, Array<Record<string, any>>>();
  const dagArtifacts = [];
  for (const rawArtifact of rawArtifacts) {
    const nodeId = String(rawArtifact.node_id || '').trim();
    const target = await buildArtifactTarget(rawArtifact);
    if (target && keepNodeIds.has(nodeId)) {
      if (nodeId) {
        if (!artifactTargets.has(nodeId)) {
          artifactTargets.set(nodeId, []);
        }
        artifactTargets.get(nodeId)?.push(target);
      }
      dagArtifacts.push({
        id: String(rawArtifact.id || rawArtifact.path),
        path: rawArtifact.path,
        nodeId,
        exists: target.exists,
        openTarget: { path: target.path },
      });
    }
  }

  const nodes = [];
  for (const rawNode of rawNodes) {
    const nodeId = String(rawNode.id || '').trim();
    if (!keepNodeIds.has(nodeId)) {
      continue;
    }
    const nodeType = String(rawNode.type || '').trim();
    const stage = String(rawNode.stage || '').trim();
    const reviewTargets = [];

    if (nodeType === 'main_stage') {
      const session = findStageSession(rawNode);
      if (session) {
        reviewTargets.push(buildSessionTarget(session.id, session.id, stage, session.provider));
      }
    } else if (nodeType === 'subagent') {
      const session = findSubagentSession(rawNode);
      if (session) {
        reviewTargets.push(buildSessionTarget(session.id, session.title || session.id, stage, session.provider));
      } else if (getInlineSessionTargets(rawNode).length > 0) {
        for (const target of getInlineSessionTargets(rawNode)) {
          reviewTargets.push(buildSessionTarget(
            String(target.sessionId || '').trim(),
            String(target.label || rawNode.member || rawNode.name || target.sessionId || '').trim(),
            String(target.stageKey || stage || '').trim(),
            target.provider,
          ));
        }
      } else {
        reviewTargets.push({ kind: 'node-metadata', label: nodeId, nodeId });
      }
    }

    const nodeArtifacts = rawArtifacts.filter((artifact) => String(artifact.node_id || '').trim() === nodeId);
    if (nodeArtifacts.length > 0) {
      const targets = artifactTargets.get(nodeId);
      if (targets && targets.length > 0) {
        for (const target of targets) {
          reviewTargets.push(target);
        }
      }
    } else {
      const stageArtifacts = stage && artifactsByStage.get(stage);
      if (stageArtifacts && stageArtifacts.length > 0) {
        for (const artifact of stageArtifacts) {
          reviewTargets.push({
            kind: 'artifact',
            label: artifact.label,
            path: artifact.path,
            exists: artifact.exists,
            nodeId,
          });
        }
      }
    }

    if (reviewTargets.length === 0) {
      reviewTargets.push({ kind: 'node-metadata', label: nodeId, nodeId });
    }

    nodes.push({
      id: nodeId,
      label: String(rawNode.name || rawNode.label || nodeId),
      type: nodeType,
      stage,
      group: rawNode.group || undefined,
      member: rawNode.member || undefined,
      mode: rawNode.mode || undefined,
      iteration: Number.isInteger(rawNode.iteration) ? rawNode.iteration : undefined,
      status: resolveNodeStatus(nodeId, stage, rawNode.status),
      reviewTargets,
      raw: rawNode,
    });
  }

  const edges = rawEdges
    .map((edge) => ({
      from: String(edge.from || '').trim(),
      to: String(edge.to || '').trim(),
      label: edge.label || undefined,
    }))
    .filter((edge) => keepNodeIds.has(edge.from) && keepNodeIds.has(edge.to));

  const gates = rawGates
    .map((gate) => ({
      id: String(gate.id || '').trim(),
      name: String(gate.name || '').trim(),
      stage: gate.stage || undefined,
      iteration: Number.isInteger(gate.iteration) ? gate.iteration : undefined,
    }))
    .filter((gate) => keepNodeIds.has(gate.id));

  return {
    source,
    display: raw.display ? { title: raw.display.title } : undefined,
    nodes,
    edges,
    artifacts: dagArtifacts,
    gates,
  };
}
