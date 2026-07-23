/**
 * PURPOSE: Identify and summarize provider subagent tool calls across Codex,
 * Pi, and legacy Task/Agent transcripts.
 */

export type SubagentPayloadRecord = Record<string, unknown>;

export type SubagentSummary = {
  payload: SubagentPayloadRecord;
  subagentType: string;
  description: string;
  prompt: string;
  taskName: string;
  command: string;
};

const SUBAGENT_EXACT_TOOL_NAMES = new Set([
  'agent',
  'task',
  'subagent',
  'sub_agent',
  'subagents',
  'spawn_agent',
  'spawn_subagent',
]);

/**
 * Parse provider JSON strings while preserving already structured payloads.
 */
function parseToolPayload(value: unknown): unknown {
  /** Convert serialized JSON tool arguments into the object shape renderers need. */
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Return a plain object for safe subagent field reads.
 */
export function toSubagentPayloadRecord(value: unknown): SubagentPayloadRecord {
  /** Normalize unknown tool input without throwing on strings or null payloads. */
  const parsed = parseToolPayload(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as SubagentPayloadRecord
    : {};
}

/**
 * Read the first non-empty string field from a payload.
 */
function firstStringField(payload: SubagentPayloadRecord, keys: string[]): string {
  /** Keep provider-specific aliases in priority order. */
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

/**
 * Decode one quoted JavaScript object value without evaluating the wrapper.
 */
function decodeJavaScriptStringLiteral(literal: string): string {
  /** Preserve command content while supporting the common JSON, quote, and template forms. */
  if (literal.startsWith('"')) {
    try {
      return JSON.parse(literal);
    } catch {
      return literal.slice(1, -1);
    }
  }

  const quote = literal[0];
  return literal
    .slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(new RegExp(`\\\\${quote}`, 'g'), quote)
    .replace(/\\\\/g, '\\');
}

/**
 * Extract one string field from a JavaScript tool wrapper without rendering it.
 */
function extractJavaScriptStringField(source: unknown, keys: string[]): string {
  /** Match only explicit object fields so unrelated wrapper source stays hidden. */
  if (typeof source !== 'string') {
    return '';
  }

  for (const key of keys) {
    const pattern = new RegExp(
      `(?:["']?${key}["']?)\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)`,
      's',
    );
    const match = source.match(pattern);
    if (match?.[1]) {
      return decodeJavaScriptStringLiteral(match[1]).trim();
    }
  }

  return '';
}

/**
 * Format a parallel or chained subagent task list for compact display.
 */
function formatTaskList(items: unknown): string {
  /** Convert Pi subagent task arrays into readable markdown-like lines. */
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }
  return items
    .map((item, index) => {
      const record = item && typeof item === 'object' ? item as SubagentPayloadRecord : {};
      const agent = firstStringField(record, ['agent', 'name', 'subagent_type', 'type']) || 'agent';
      const task = firstStringField(record, ['task', 'prompt', 'instructions', 'description']);
      return `${index + 1}. ${agent}${task ? `: ${task}` : ''}`;
    })
    .join('\n');
}

/**
 * Return whether a tool name is a known subagent invocation.
 */
export function isSubagentToolName(toolName: unknown): boolean {
  /** Recognize exact legacy names plus qualified names ending in subagent. */
  const rawName = String(toolName || '').trim();
  if (!rawName) {
    return false;
  }

  const normalized = rawName.toLowerCase();
  if (SUBAGENT_EXACT_TOOL_NAMES.has(normalized)) {
    return true;
  }
  if (normalized.endsWith('spawn_agent') || normalized.endsWith('spawn_subagent')) {
    return true;
  }

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.includes('subagent') || tokens.includes('subagents');
}

/**
 * Return whether a full tool call payload should render as a subagent card.
 */
export function isSubagentToolCall(toolName: unknown, toolInput?: unknown): boolean {
  /** Use payload shape as a fallback for provider-specific subagent aliases. */
  if (isSubagentToolName(toolName)) {
    return true;
  }

  const payload = toSubagentPayloadRecord(toolInput);
  return Boolean(
    firstStringField(payload, ['subagent_type', 'agent_type']) ||
    (firstStringField(payload, ['agent']) && firstStringField(payload, ['task', 'prompt', 'instructions'])) ||
    Array.isArray(payload.tasks) ||
    Array.isArray(payload.chain),
  );
}

/**
 * Build the user-facing summary fields for a subagent tool call.
 */
export function summarizeSubagentToolInput(toolInput: unknown): SubagentSummary {
  /** Collapse Codex/Pi/legacy argument aliases into one renderer contract. */
  const payload = toSubagentPayloadRecord(toolInput);
  const chainPrompt = formatTaskList(payload.chain);
  const parallelPrompt = formatTaskList(payload.tasks);
  const taskName = firstStringField(payload, ['task_name', 'taskName']) ||
    extractJavaScriptStringField(toolInput, ['task_name', 'taskName']);
  const command = firstStringField(payload, ['cmd', 'command']) ||
    extractJavaScriptStringField(toolInput, ['cmd', 'command']);
  const prompt = firstStringField(payload, ['prompt', 'instructions', 'task']) || chainPrompt || parallelPrompt;
  const hasChain = Array.isArray(payload.chain) && payload.chain.length > 0;
  const hasParallel = Array.isArray(payload.tasks) && payload.tasks.length > 0;
  const subagentType = firstStringField(payload, ['subagent_type', 'agent_type', 'agent', 'name', 'type']) ||
    (hasChain ? 'chain' : hasParallel ? 'parallel' : 'Agent');
  const description = taskName ||
    firstStringField(payload, ['description', 'summary', 'task', 'instructions', 'prompt']) ||
    (hasChain ? `${(payload.chain as unknown[]).length} chained tasks` : '') ||
    (hasParallel ? `${(payload.tasks as unknown[]).length} parallel tasks` : '') ||
    'Running task';

  return {
    payload,
    subagentType,
    description,
    prompt,
    taskName,
    command,
  };
}
