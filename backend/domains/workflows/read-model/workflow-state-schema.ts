/**
 * PURPOSE: Normalize external oz flow state JSON before workflow read models
 * consume it, keeping compatibility fields explicit at the boundary.
 */

export type WorkflowJsonRecord = Record<string, unknown>;

export interface WorkflowRunnerProcess extends WorkflowJsonRecord {
  stage?: string;
  stage_key?: string;
  stageKey?: string;
  status?: string;
  sessionId?: string;
  provider?: string;
  logPath?: string;
}

export interface WorkflowSessionRef extends WorkflowJsonRecord {
  id?: string;
  title?: string;
  provider?: string;
  role?: string;
  stageKey?: string;
  address?: string;
  routePath?: string;
  workflowId?: string;
}

export interface WorkflowArtifactRef extends WorkflowJsonRecord {
  id?: string;
  label?: string;
  status?: string;
  type?: string;
  semanticType?: string;
  stage?: string;
  substageKey?: string;
  relativePath?: string;
  path?: string;
  exists?: boolean;
  source?: string;
}

export interface WorkflowStageStatus extends WorkflowJsonRecord {
  key: string;
  label: string;
  status: string;
  provider: string;
}

export interface WorkflowState extends WorkflowJsonRecord {
  run_id?: string;
  change_name?: string;
  status?: string;
  stage?: string;
  updated_at?: string;
  error?: string;
  engine?: string;
  sessions: WorkflowJsonRecord;
  processes: WorkflowRunnerProcess[];
  paths: WorkflowJsonRecord;
  stages: WorkflowJsonRecord;
  dag_nodes: WorkflowJsonRecord;
  workflow_config: WorkflowJsonRecord;
  workflow_dag?: WorkflowJsonRecord;
  workflow_display?: {
    lines?: WorkflowJsonRecord[];
  };
  hasUnreadActivity?: boolean;
}

export interface WorkflowStateSchemaResult {
  value: WorkflowState;
  warnings: string[];
}

/**
 * Return a typed empty record for fallback paths that preserve legacy tolerance.
 */
function emptyWorkflowRecord(): WorkflowJsonRecord {
  return {} as WorkflowJsonRecord;
}

/**
 * Return true when an external JSON value is a plain object-like record.
 */
export function isWorkflowRecord(value: unknown): value is WorkflowJsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Return an object record, falling back to an empty object for invalid JSON
 * shapes so downstream read models keep their legacy tolerance.
 */
export function asWorkflowRecord(value: unknown): WorkflowJsonRecord {
  return isWorkflowRecord(value) ? value : emptyWorkflowRecord();
}

/**
 * Return an array of object records from external JSON.
 */
export function asWorkflowRecordArray(value: unknown): WorkflowJsonRecord[] {
  return Array.isArray(value) ? value.filter(isWorkflowRecord) : [];
}

/**
 * Record a schema warning when a field falls back because its JSON type is not
 * usable by the workflow read model.
 */
function warnInvalidField(warnings: string[], path: string, expected: string, value: unknown): void {
  if (value === undefined) {
    warnings.push(`Workflow state schema warning at ${path}: missing ${expected}; using fallback.`);
    return;
  }
  warnings.push(`Workflow state schema warning at ${path}: expected ${expected}; using fallback.`);
}

/**
 * Return a string field and report invalid present values.
 */
function optionalString(raw: WorkflowJsonRecord, key: string, warnings: string[]): string | undefined {
  const value = raw[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  warnInvalidField(warnings, key, 'string', value);
  return undefined;
}

/**
 * Normalize an object field and warn when legacy tolerance hides a bad shape.
 */
function requiredRecord(raw: WorkflowJsonRecord, key: string, warnings: string[]): WorkflowJsonRecord {
  const value = raw[key];
  if (isWorkflowRecord(value)) {
    return value;
  }
  warnInvalidField(warnings, key, 'object', value);
  return emptyWorkflowRecord();
}

/**
 * Normalize an array of object records and warn for invalid containers/items.
 */
function recordArray(raw: WorkflowJsonRecord, key: string, warnings: string[], displayPath = key): WorkflowJsonRecord[] {
  const value = raw[key];
  if (!Array.isArray(value)) {
    warnInvalidField(warnings, displayPath, 'array of objects', value);
    return [];
  }
  const records = value.filter(isWorkflowRecord);
  if (records.length !== value.length) {
    warnings.push(`Workflow state schema warning at ${displayPath}: dropped ${value.length - records.length} non-object item(s).`);
  }
  return records;
}

/**
 * Read a runner field with the snake_case contract used by oz state JSON.
 */
export function pick(object: unknown, snakeKey: string): any {
  return isWorkflowRecord(object) ? object[snakeKey] : undefined;
}

/**
 * Normalize sealed state.json or oz flow status JSON into the read-model input
 * contract. The normalizer preserves unknown keys for older run compatibility.
 */
export function normalizeWorkflowStateWithWarnings(input: unknown): WorkflowStateSchemaResult {
  const raw = asWorkflowRecord(input);
  const warnings = isWorkflowRecord(input) ? [] : ['Workflow state JSON root is not an object.'];
  const workflowDisplay = isWorkflowRecord(raw.workflow_display)
    ? { ...raw.workflow_display, lines: recordArray(raw.workflow_display, 'lines', warnings, 'workflow_display.lines') }
    : undefined;
  if (raw.workflow_display !== undefined && !isWorkflowRecord(raw.workflow_display)) {
    warnInvalidField(warnings, 'workflow_display', 'object', raw.workflow_display);
  }
  if (raw.workflow_dag !== undefined && !isWorkflowRecord(raw.workflow_dag)) {
    warnInvalidField(warnings, 'workflow_dag', 'object', raw.workflow_dag);
  }
  const value = {
    ...raw,
    run_id: optionalString(raw, 'run_id', warnings),
    change_name: optionalString(raw, 'change_name', warnings),
    status: optionalString(raw, 'status', warnings),
    stage: optionalString(raw, 'stage', warnings),
    updated_at: optionalString(raw, 'updated_at', warnings),
    error: optionalString(raw, 'error', warnings),
    engine: optionalString(raw, 'engine', warnings),
    sessions: requiredRecord(raw, 'sessions', warnings),
    processes: recordArray(raw, 'processes', warnings) as WorkflowRunnerProcess[],
    paths: requiredRecord(raw, 'paths', warnings),
    stages: requiredRecord(raw, 'stages', warnings),
    dag_nodes: requiredRecord(raw, 'dag_nodes', warnings),
    workflow_config: requiredRecord(raw, 'workflow_config', warnings),
    workflow_dag: isWorkflowRecord(raw.workflow_dag) ? raw.workflow_dag : undefined,
    workflow_display: workflowDisplay,
    hasUnreadActivity: raw.hasUnreadActivity === true,
  };
  return { value, warnings };
}

/**
 * Normalize state JSON and return only the business value for existing read
 * model call sites; callers that need diagnostics can use the WithWarnings API.
 */
export function normalizeWorkflowState(input: unknown): WorkflowState {
  return normalizeWorkflowStateWithWarnings(input).value;
}
