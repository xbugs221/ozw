/**
 * PURPOSE: Normalize Codex JSONL and WebSocket item payloads into one chat tool/message contract.
 */

/**
 * Parse JSON strings when Codex encodes tool arguments or results as text.
 */
export function parseCodexJsonMaybe(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed || !['{', '[', '"'].includes(trimmed[0])) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/**
 * Convert mixed Codex tool output values to a stable text payload.
 */
export function normalizeCodexToolOutput(value: unknown): string {
  const parsed = parseCodexJsonMaybe(value);
  if (parsed === null || parsed === undefined) {
    return '';
  }

  if (typeof parsed === 'string') {
    return parsed;
  }

  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => normalizeCodexToolOutput(item))
      .filter(Boolean)
      .join('\n');
  }

  if (typeof parsed === 'object') {
    const nested = (parsed as Record<string, unknown>).content ?? (parsed as Record<string, unknown>).output ?? (parsed as Record<string, unknown>).text ?? (parsed as Record<string, unknown>).result ?? (parsed as Record<string, unknown>).stdout ?? (parsed as Record<string, unknown>).stderr;
    if (nested !== undefined && nested !== parsed) {
      return normalizeCodexToolOutput(nested);
    }
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(parsed);
    }
  }

  return String(parsed);
}

export interface FileChange {
  kind: string;
  path: string;
  old_string?: string;
  new_string?: string;
}

const FILE_OPERATION_KINDS = new Map<string, string>([
  ['add', 'added'],
  ['added', 'added'],
  ['create', 'added'],
  ['created', 'added'],
  ['edit', 'edit'],
  ['modify', 'edit'],
  ['modified', 'edit'],
  ['update', 'edit'],
  ['updated', 'edit'],
  ['write', 'edit'],
  ['delete', 'deleted'],
  ['deleted', 'deleted'],
  ['remove', 'deleted'],
  ['removed', 'deleted'],
]);

/**
 * Convert provider file-operation bookkeeping JSON into FileChanges input.
 */
export function normalizeCodexFileOperationPayload(value: unknown, depth = 0): {
  status: string;
  changes: FileChange[];
} | null {
  /**
   * Walk JSON strings and common provider envelopes while requiring both an
   * operation kind and a file path so ordinary assistant JSON remains visible.
   */
  if (depth > 6 || value === null || value === undefined) {
    return null;
  }

  const parsed = parseCodexJsonMaybe(value);
  if (parsed !== value) {
    return normalizeCodexFileOperationPayload(parsed, depth + 1);
  }

  if (Array.isArray(value)) {
    for (const part of value) {
      const normalized = normalizeCodexFileOperationPayload(part, depth + 1);
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawChanges = record.changes;
  if (Array.isArray(rawChanges)) {
    const changes = rawChanges
      .map((change) => {
        if (!change || typeof change !== 'object') {
          return null;
        }
        const changeRecord = change as Record<string, unknown>;
        const rawChangeKind = String(changeRecord.kind ?? changeRecord.type ?? '').toLowerCase();
        const changePathValue = changeRecord.path ?? changeRecord.filePath ?? changeRecord.file_path;
        const changePath = typeof changePathValue === 'string' ? changePathValue.trim() : '';
        const changeKind = FILE_OPERATION_KINDS.get(rawChangeKind);
        return changeKind && changePath ? {
          kind: changeKind,
          path: changePath,
          ...(typeof changeRecord.old_string === 'string' ? { old_string: changeRecord.old_string } : {}),
          ...(typeof changeRecord.new_string === 'string' ? { new_string: changeRecord.new_string } : {}),
        } : null;
      })
      .filter((change): change is FileChange => change !== null);
    if (changes.length > 0) {
      const firstKind = changes[0].kind;
      return {
        status: firstKind === 'added' ? 'Add file' : firstKind === 'deleted' ? 'Delete file' : 'Edit file',
        changes,
      };
    }
  }

  const rawKind = String(record.kind ?? record.type ?? '').toLowerCase();
  const pathValue = record.path ?? record.filePath ?? record.file_path;
  const filePath = typeof pathValue === 'string' ? pathValue.trim() : '';
  const kind = FILE_OPERATION_KINDS.get(rawKind);

  if (kind && filePath) {
    return {
      status: kind === 'added' ? 'Add file' : kind === 'deleted' ? 'Delete file' : 'Edit file',
      changes: [{
        kind,
        path: filePath,
        ...(typeof record.old_string === 'string' ? { old_string: record.old_string } : {}),
        ...(typeof record.new_string === 'string' ? { new_string: record.new_string } : {}),
      }],
    };
  }

  const nested = record.item ?? record.payload ?? record.data ?? record.update
    ?? record.message ?? record.content ?? record.text ?? record.output ?? record.result ?? record.displayText;
  if (nested !== undefined && nested !== value) {
    return normalizeCodexFileOperationPayload(nested, depth + 1);
  }

  return null;
}

/**
 * Extract the first changed path from an apply_patch text block.
 */
function extractPatchPath(patch: string): string {
  const match = patch.match(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/m);
  return match?.[1]?.trim() || 'unknown';
}

/**
 * Convert one apply_patch file section into old/new text snapshots.
 */
function pushApplyPatchSection(
  changes: FileChange[],
  section: {
    kind: string;
    path: string;
    oldLines: string[];
    newLines: string[];
  } | null,
) {
  if (!section) {
    return;
  }

  const change: FileChange = {
    kind: section.kind,
    path: section.path,
  };

  if (section.oldLines.length > 0 || section.newLines.length > 0) {
    change.old_string = section.oldLines.join('\n');
    change.new_string = section.newLines.join('\n');
  }

  changes.push(change);
}

/**
 * Split an apply_patch payload into per-file changes with diff text snapshots.
 */
function parseApplyPatchChanges(patch: string): FileChange[] {
  const changes: FileChange[] = [];
  let currentSection: {
    kind: string;
    path: string;
    oldLines: string[];
    newLines: string[];
  } | null = null;

  patch.split('\n').forEach((line) => {
    const fileMatch = line.match(/^\*\*\* (Update|Add|Delete) File:\s*(.+)$/);
    if (fileMatch) {
      pushApplyPatchSection(changes, currentSection);
      currentSection = {
        kind: fileMatch[1] === 'Add' ? 'added' : fileMatch[1] === 'Delete' ? 'deleted' : 'edit',
        path: fileMatch[2].trim(),
        oldLines: [],
        newLines: [],
      };
      return;
    }

    if (!currentSection || line.startsWith('***') || line.startsWith('@@')) {
      return;
    }

    if (line.startsWith('-')) {
      currentSection.oldLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      currentSection.newLines.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      currentSection.oldLines.push(line.slice(1));
      currentSection.newLines.push(line.slice(1));
    }
  });

  pushApplyPatchSection(changes, currentSection);
  return changes;
}

/**
 * Convert apply_patch arguments into the FileChanges renderer payload.
 */
export function normalizeCodexFileChangesInput(argumentsValue: unknown): {
  status: string;
  changes: FileChange[];
} {
  const parsed = parseCodexJsonMaybe(argumentsValue);
  const patch = typeof parsed === 'object' && parsed
    ? String((parsed as Record<string, unknown>).patch ?? (parsed as Record<string, unknown>).input ?? '')
    : String(parsed ?? '');
  const changes = parseApplyPatchChanges(patch);

  return {
    status: 'Edit file',
    changes: changes.length > 0 ? changes : [{ kind: 'edit', path: extractPatchPath(patch) }],
  };
}

export interface ApplyPatchInput {
  file_path: string;
  old_string: string;
  new_string: string;
}

/**
 * Convert apply_patch arguments into the existing edit renderer input shape.
 */
export function normalizeCodexApplyPatchInput(argumentsValue: unknown): ApplyPatchInput {
  const parsed = parseCodexJsonMaybe(argumentsValue);
  const patch = typeof parsed === 'object' && parsed
    ? String((parsed as Record<string, unknown>).patch ?? (parsed as Record<string, unknown>).input ?? '')
    : String(parsed ?? '');
  const changes = parseApplyPatchChanges(patch);
  const firstChange = changes[0];

  return {
    file_path: firstChange?.path || extractPatchPath(patch),
    old_string: firstChange?.old_string || '',
    new_string: firstChange?.new_string || patch,
  };
}

export interface NormalizedFunctionCall {
  toolName: string;
  toolInput: unknown;
  toolCallId: unknown;
}

/**
 * Detect Codex command_execution entries that actually represent a named
 * context-mode tool rather than an arbitrary shell command.
 */
function isContextCommandToolName(command: string): boolean {
  return /^ctx_[a-z0-9_]+$/i.test(command) || /^mcp__.*ctx[_:.]/i.test(command);
}

/**
 * Preserve structured context-mode arguments so the UI can choose the business
 * renderer instead of falling back to a generic shell command card.
 */
function normalizeCommandExecutionInput(item: Record<string, unknown>, command: string): unknown {
  if (!isContextCommandToolName(command)) {
    return { command };
  }

  const structuredArguments = item.arguments ?? item.args ?? item.input;
  return structuredArguments ?? { command };
}

function resolveCodexFunctionCallId(payload: Record<string, unknown>): unknown {
  /**
   * Support both JSONL snake_case and app-server camelCase call ids.
   */
  return payload.call_id ?? payload.callId ?? payload.id ?? payload.itemId;
}

/**
 * Codex stores tool arguments under different keys across JSONL and live item
 * shapes. Prefer the canonical arguments field, then fall back to input/args.
 */
function resolveCodexFunctionArguments(payload: Record<string, unknown>): unknown {
  return payload.arguments ?? payload.input ?? payload.args ?? '';
}

/**
 * Normalize a Codex function_call payload into an existing ChatMessage tool shape.
 */
export function normalizeCodexFunctionCall(payload: Record<string, unknown>): NormalizedFunctionCall {
  const rawName = String(payload?.name || payload?.tool_name || payload?.toolName || 'UnknownTool');
  const functionArguments = resolveCodexFunctionArguments(payload);
  const toolCallId = resolveCodexFunctionCallId(payload);

  if (rawName === 'shell_command') {
    const parsed = parseCodexJsonMaybe(functionArguments);
    const command = parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>).command ?? (parsed as Record<string, unknown>).cmd
      : functionArguments;
    return {
      toolName: 'Bash',
      toolInput: JSON.stringify({ command: command || '' }),
      toolCallId,
    };
  }

  if (rawName === 'apply_patch') {
    return {
      toolName: 'FileChanges',
      toolInput: normalizeCodexFileChangesInput(functionArguments),
      toolCallId,
    };
  }

  return {
    toolName: rawName,
    toolInput: functionArguments,
    toolCallId,
  };
}

/**
 * Normalize realtime Codex item events into the same UI fragment as JSONL replay.
 */
export function normalizeCodexRealtimeItem(item: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  if (item.itemType === 'command_execution') {
    const command = String(item.command || '');
    if (!command) {
      return null;
    }
    const isContextTool = isContextCommandToolName(command);
    return {
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      isToolUse: true,
      toolName: isContextTool ? command : 'Bash',
      toolInput: normalizeCommandExecutionInput(item, command),
      toolId: item.itemId,
      toolCallId: item.itemId,
      toolResult: item.output == null ? null : {
        content: normalizeCodexToolOutput(item.output),
        isError: item.exitCode != null && Number(item.exitCode) !== 0,
        status: item.exitCode == null ? 'running' : 'completed',
      },
      exitCode: item.exitCode,
    };
  }

  if (item.itemType === 'file_change') {
    const filePath = String(item.path || item.filePath || item.file_path || '');
    const operationPayload = normalizeCodexFileOperationPayload(item);
    if (!filePath && !operationPayload) {
      return null;
    }
    return {
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      isToolUse: true,
      toolName: 'FileChanges',
      toolInput: operationPayload ?? {
        status: 'Edit file',
        changes: [{ kind: String(item.changeType || 'edit'), path: filePath }],
      },
      toolId: item.itemId,
      toolCallId: item.itemId,
      toolResult: {
        content: '',
        isError: false,
        status: 'completed',
      },
      exitCode: item.exitCode,
    };
  }

  if (item.itemType === 'mcp_tool_call') {
    const toolName = item.tool
      ? String(item.tool)
      : `${item.server || 'mcp'}:${item.name || 'tool'}`;
    return {
      type: 'assistant',
      content: '',
      timestamp: new Date(),
      isToolUse: true,
      toolName,
      toolInput: item.arguments ?? {},
      toolId: item.itemId,
      toolCallId: item.itemId,
      toolResult: item.result || item.error
        ? {
            content: normalizeCodexToolOutput(item.result ?? (item.error as Record<string, unknown>)?.message),
            isError: Boolean(item.error),
          }
        : null,
      exitCode: item.error ? 1 : item.exitCode,
    };
  }

  return null;
}

/**
 * Transform a raw Codex runtime event into the backend WebSocket item contract.
 */
export function transformCodexEvent(event: unknown): unknown {
  if (!event || typeof event !== 'object') return event;
  const e = event as Record<string, unknown>;
  const lifecycleStatus = e.type === 'item.completed'
    ? 'completed'
    : (e.type === 'item.started' || e.type === 'item.updated' ? 'in_progress' : undefined);
  switch (e.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed': {
      const item = e.item as Record<string, unknown> | undefined;
      if (!item) return { type: e.type, item: null };
      switch (item.type) {
        case 'agent_message':
          return {
            type: 'item',
            itemType: 'agent_message',
            itemId: item.id || item.message_id || null,
            ...(lifecycleStatus ? { status: lifecycleStatus } : {}),
            message: { role: 'assistant', content: item.text, phase: typeof item.phase === 'string' ? item.phase : undefined },
          };
        case 'reasoning':
          return { type: 'item', itemType: 'reasoning', itemId: item.id || item.message_id || null, ...(lifecycleStatus ? { status: lifecycleStatus } : {}), message: { role: 'assistant', content: item.text, isReasoning: true } };
        case 'command_execution':
          return { type: 'item', itemType: 'command_execution', itemId: item.id || item.call_id || null, command: item.command || item.command_line || '[command unavailable]', output: item.aggregated_output ?? item.output ?? '', exitCode: item.exit_code, lifecycle: e.type, status: item.status };
        case 'file_change':
          return { type: 'item', itemType: 'file_change', itemId: item.id || item.call_id || null, changes: item.changes, status: item.status };
        case 'mcp_tool_call':
          return { type: 'item', itemType: 'mcp_tool_call', itemId: item.id || item.call_id || null, server: item.server, tool: item.tool, arguments: item.arguments, result: item.result, error: item.error, status: item.status };
        case 'function_call':
        case 'custom_tool_call':
          return { type: 'item', itemType: 'function_call', itemId: item.id || item.call_id || item.callId || null, item };
        case 'function_call_output':
          return { type: 'item', itemType: 'function_call_output', itemId: item.id || item.call_id || item.callId || null, item };
        case 'web_search':
          return { type: 'item', itemType: 'web_search', query: item.query };
        case 'todo_list':
          return { type: 'item', itemType: 'todo_list', items: item.items };
        case 'error':
          return { type: 'item', itemType: 'error', message: { role: 'error', content: item.message } };
        default:
          return { type: 'item', itemType: item.type, item };
      }
    }
    case 'turn.started':
      return { type: 'turn_started' };
    case 'turn.completed':
      return { type: 'turn_complete', usage: e.usage };
    case 'turn.failed':
      return { type: 'turn_failed', error: e.error };
    case 'thread.started':
      return { type: 'thread_started', threadId: e.thread_id || e.id };
    case 'error':
      return { type: 'error', message: e.message };
    default:
      return { type: e.type, data: e };
  }
}
