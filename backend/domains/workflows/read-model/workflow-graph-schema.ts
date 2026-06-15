/**
 * PURPOSE: Normalize oz flow graph JSON before DAG read-model code consumes
 * nodes, edges, artifacts and gates from external CLI output.
 */
import {
  asWorkflowRecord,
  isWorkflowRecord,
  type WorkflowJsonRecord,
} from './workflow-state-schema.js';

export interface WorkflowGraphNode extends WorkflowJsonRecord {
  id?: string;
  name?: string;
  label?: string;
  type?: string;
  stage?: string;
  group?: string;
  member?: string;
  mode?: string;
  iteration?: number;
  status?: string;
  reviewTargets?: WorkflowGraphReviewTarget[];
}

export interface WorkflowGraphReviewTarget extends WorkflowJsonRecord {
  kind?: string;
  label?: string;
  sessionId?: string;
  provider?: string;
  routePath?: string;
  stageKey?: string;
  path?: string;
  exists?: boolean;
}

export interface WorkflowGraphEdge extends WorkflowJsonRecord {
  from?: string;
  to?: string;
  label?: string;
}

export interface WorkflowGraphArtifact extends WorkflowJsonRecord {
  id?: string;
  path?: string;
  node_id?: string;
}

export interface WorkflowGraphGate extends WorkflowJsonRecord {
  id?: string;
  name?: string;
  stage?: string;
  iteration?: number;
}

export interface WorkflowGraph extends WorkflowJsonRecord {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  artifacts: WorkflowGraphArtifact[];
  gates: WorkflowGraphGate[];
  display?: WorkflowJsonRecord;
}

export interface WorkflowGraphSchemaResult {
  value: WorkflowGraph;
  warnings: string[];
}

/**
 * Normalize optional graph review targets embedded in persisted workflow DAGs.
 */
function normalizeReviewTargets(value: unknown, path: string, warnings: string[]): WorkflowGraphReviewTarget[] {
  return recordArray(value, path, warnings) as WorkflowGraphReviewTarget[];
}

/**
 * Add a graph schema warning for a fallback that would otherwise be silent.
 */
function warnGraphField(warnings: string[], path: string, expected: string, value: unknown): void {
  if (value === undefined) {
    warnings.push(`Workflow graph schema warning at ${path}: missing ${expected}; using fallback.`);
    return;
  }
  warnings.push(`Workflow graph schema warning at ${path}: expected ${expected}; using fallback.`);
}

/**
 * Normalize an array of object records from graph JSON.
 */
function recordArray(value: unknown, path: string, warnings: string[]): WorkflowJsonRecord[] {
  if (!Array.isArray(value)) {
    warnGraphField(warnings, path, 'array of objects', value);
    return [];
  }
  const records = value.filter(isWorkflowRecord);
  if (records.length !== value.length) {
    warnings.push(`Workflow graph schema warning at ${path}: dropped ${value.length - records.length} non-object item(s).`);
  }
  return records;
}

/**
 * Warn when a present graph field has the wrong primitive type.
 */
function warnInvalidPrimitive(record: WorkflowJsonRecord, path: string, key: string, expected: string, warnings: string[]): void {
  const value = record[key];
  if (value === undefined) {
    return;
  }
  if (expected === 'string' && typeof value === 'string') {
    return;
  }
  if (expected === 'number' && typeof value === 'number') {
    return;
  }
  warnGraphField(warnings, `${path}.${key}`, expected, value);
}

/**
 * Normalize oz flow graph JSON while preserving unknown fields for UI fallback.
 */
export function normalizeWorkflowGraphWithWarnings(input: unknown): WorkflowGraphSchemaResult {
  const raw = asWorkflowRecord(input);
  const warnings = raw === input ? [] : ['Workflow graph JSON root is not an object.'];
  const nodes = (recordArray(raw.nodes, 'nodes', warnings) as WorkflowGraphNode[]).map((node, index) => {
    warnInvalidPrimitive(node, `nodes[${index}]`, 'id', 'string', warnings);
    warnInvalidPrimitive(node, `nodes[${index}]`, 'stage', 'string', warnings);
    warnInvalidPrimitive(node, `nodes[${index}]`, 'type', 'string', warnings);
    warnInvalidPrimitive(node, `nodes[${index}]`, 'iteration', 'number', warnings);
    return {
      ...node,
      reviewTargets: normalizeReviewTargets(node.reviewTargets, `nodes[${index}].reviewTargets`, warnings),
    };
  });
  const edges = (recordArray(raw.edges, 'edges', warnings) as WorkflowGraphEdge[]).map((edge, index) => {
    warnInvalidPrimitive(edge, `edges[${index}]`, 'from', 'string', warnings);
    warnInvalidPrimitive(edge, `edges[${index}]`, 'to', 'string', warnings);
    return edge;
  });
  const artifacts = recordArray(raw.artifacts, 'artifacts', warnings) as WorkflowGraphArtifact[];
  const gates = (recordArray(raw.gates, 'gates', warnings) as WorkflowGraphGate[]).map((gate, index) => {
    warnInvalidPrimitive(gate, `gates[${index}]`, 'id', 'string', warnings);
    warnInvalidPrimitive(gate, `gates[${index}]`, 'stage', 'string', warnings);
    warnInvalidPrimitive(gate, `gates[${index}]`, 'iteration', 'number', warnings);
    return gate;
  });
  if (raw.display !== undefined && !isWorkflowRecord(raw.display)) {
    warnGraphField(warnings, 'display', 'object', raw.display);
  }
  const value = {
    ...raw,
    nodes,
    edges,
    artifacts,
    gates,
    display: asWorkflowRecord(raw.display),
  };
  return { value, warnings };
}

/**
 * Normalize graph JSON and return only the business value for read-model code.
 */
export function normalizeWorkflowGraph(input: unknown): WorkflowGraph {
  return normalizeWorkflowGraphWithWarnings(input).value;
}
