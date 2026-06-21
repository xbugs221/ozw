/**
 * PURPOSE: Pure reducer that turns native SDK runtime events into live chat
 * messages without waiting for provider JSONL to be persisted.
 */

import {
  normalizeCodexFileOperationPayload,
  normalizeCodexFunctionCall,
  normalizeCodexRealtimeItem,
  normalizeCodexToolOutput,
  parseCodexJsonMaybe,
} from './codex-message-normalizer.js';
import {
  isProviderFileUpdatePayload,
  resolveCodexToolUpdateJson,
} from './provider-payload-parsers.js';
import {
  isSubagentToolCall,
} from './subagent-tool-utils.js';

export type ChatMessageLike = {
  type: string;
  content?: unknown;
  provider?: string;
  source?: string;
  messageKey?: string;
  timestamp?: string | number | Date;
  isThinking?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  toolId?: string;
  toolCallId?: unknown;
  exitCode?: unknown;
  status?: string;
  turnAnchorKey?: unknown;
  clientRequestId?: string;
  renderVisibility?: string;
  hiddenUntilComplete?: boolean;
  pending?: boolean;
  isSubagentContainer?: boolean;
  subagentState?: {
    childTools: unknown[];
    currentToolIndex: number;
    isComplete: boolean;
  };
};

export type NativeRuntimeEvent = Record<string, unknown>;

function extractText(content: unknown): string {
  const parsed = parseCodexJsonMaybe(content);
  if (parsed !== content) {
    return extractText(parsed);
  }
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const record = part as Record<string, unknown>;
          return extractText(record.text ?? record.content ?? record.output ?? record.result);
        }
        return '';
      })
      .join('');
  }
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    const nested = record.text ?? record.content ?? record.output ?? record.result ?? record.stdout ?? record.stderr;
    if (nested !== undefined && nested !== content) {
      return extractText(nested);
    }
    return normalizeCodexToolOutput(content);
  }
  return '';
}

function buildMessageKey(provider: string, itemId: string | unknown, turnAnchorKey?: unknown): string {
  const safeItemId = typeof itemId === 'string' && itemId
    ? itemId
    : (typeof turnAnchorKey === 'string' && turnAnchorKey ? `turn:${turnAnchorKey}` : 'unknown');
  return `${provider}:${safeItemId}`;
}

function buildLiveFileChangeEvent(
  event: NativeRuntimeEvent,
  itemId: unknown,
  fileOperation: { status: string; changes: { kind: string; path: string }[] },
): NativeRuntimeEvent {
  /**
   * Preserve normalized file-operation details so live cards and JSONL replay
   * share the same FileChanges payload shape.
   */
  return {
    ...event,
    data: {
      type: 'item',
      itemType: 'file_change',
      itemId: itemId || `file-change:${normalizeToolPayloadText(fileOperation)}`,
      changes: fileOperation.changes,
      status: fileOperation.status,
    },
  };
}

/**
 * Resolve Codex app-server update envelopes that carry tool calls so they render
 * through the same card path as first-class function_call live items.
 */
function resolveProviderToolUpdatePayload(value: unknown): Record<string, unknown> | null {
  const resolved = resolveCodexToolUpdateJson(value);
  if (!resolved) {
    return null;
  }

  const record = resolved.payload;
  if (resolved.kind === 'tool_use') {
    return {
      type: 'item',
      itemType: 'function_call',
      itemId: record.call_id ?? record.callId ?? record.id,
      item: { ...record, type: 'function_call' },
    };
  }

  return {
    type: 'item',
    itemType: 'function_call_output',
    itemId: record.call_id ?? record.callId ?? record.id,
    item: { ...record, type: 'function_call_output' },
  };
}

const LIVE_ITEM_TYPES = new Set([
  'agent_message',
  'reasoning',
  'command_execution',
  'file_change',
  'mcp_tool_call',
  'error',
  'thinking',
  'tool',
  'tool_call',
  'tool_result',
  'function_call',
  'custom_tool_call',
  'function_call_output',
  'update',
]);

function messageTypeFromItemType(itemType: string): string {
  if (
    itemType === 'agent_message' ||
    itemType === 'thinking' ||
    itemType === 'reasoning'
  ) return 'assistant';
  if (itemType === 'file_change') return 'assistant';
  if (itemType === 'error') return 'error';
  if (
    itemType === 'command_execution' ||
    itemType === 'tool' ||
    itemType === 'tool_call' ||
    itemType === 'tool_result' ||
    itemType === 'function_call' ||
    itemType === 'custom_tool_call' ||
    itemType === 'function_call_output' ||
    itemType === 'mcp_tool_call'
  ) return 'assistant';
  return 'assistant';
}

function getNestedItem(data: Record<string, unknown>): Record<string, unknown> {
  return data.item && typeof data.item === 'object'
    ? data.item as Record<string, unknown>
    : data;
}

function getItemId(data: Record<string, unknown>): unknown {
  const item = getNestedItem(data);
  return data.itemId ?? item.id ?? item.call_id ?? item.callId ?? item.toolCallId ?? item.tool_call_id;
}

/**
 * Prefer the logical tool-call id over transport item ids for live tool merges.
 */
function getToolCallId(data: Record<string, unknown>): unknown {
  /** Normalize Codex/Pi call-id aliases before falling back to the item id. */
  const item = getNestedItem(data);
  return data.toolCallId
    ?? data.tool_call_id
    ?? data.call_id
    ?? data.callId
    ?? item.toolCallId
    ?? item.tool_call_id
    ?? item.call_id
    ?? item.callId
    ?? data.itemId
    ?? item.id;
}

/**
 * Add subagent container state for tool names and payloads that delegate work.
 */
function buildSubagentToolFields(
  toolName: unknown,
  toolInput: unknown,
  isComplete: boolean,
): Partial<ChatMessageLike> {
  /** Keep subagent cards on the dedicated renderer path during live updates. */
  if (!isSubagentToolCall(toolName, toolInput)) {
    return {};
  }
  return {
    isSubagentContainer: true,
    subagentState: {
      childTools: [],
      currentToolIndex: -1,
      isComplete,
    },
  };
}

function buildToolPayload(data: Record<string, unknown>, itemType: string): Partial<ChatMessageLike> {
  const item = getNestedItem(data);
  if (itemType === 'file_change') {
    const normalized = normalizeCodexRealtimeItem({
      ...data,
      ...item,
      itemType,
      itemId: getItemId(data),
    });
    return normalized?.isToolUse ? {
      isToolUse: true,
      toolName: String(normalized.toolName || 'FileChanges'),
      toolInput: normalized.toolInput,
      toolResult: normalized.toolResult ?? null,
      toolId: typeof getItemId(data) === 'string' ? getItemId(data) as string : undefined,
      toolCallId: getItemId(data),
      status: typeof data.status === 'string' ? data.status : undefined,
    } : {};
  }
  if (itemType === 'function_call' || itemType === 'custom_tool_call') {
    const normalized = normalizeCodexFunctionCall(item);
    return {
      isToolUse: true,
      toolName: normalized.toolName,
      toolInput: formatToolInput(normalized.toolInput),
      toolId: typeof normalized.toolCallId === 'string' ? normalized.toolCallId : undefined,
      toolCallId: normalized.toolCallId,
      toolResult: null,
      ...buildSubagentToolFields(normalized.toolName, normalized.toolInput, false),
    };
  }
  if (itemType === 'function_call_output') {
    const callId = item.call_id ?? item.callId ?? data.itemId;
    const toolName = item.name ?? data.tool;
    const outputText = normalizeCodexToolOutput(item.output ?? item.content ?? item.result ?? data.output ?? data.result);
    const hasOutput = !isEmptyOutput(outputText);
    return {
      isToolUse: true,
      ...(toolName ? { toolName: String(toolName) } : {}),
      toolId: typeof callId === 'string' ? callId : undefined,
      toolCallId: callId,
      toolResult: hasOutput ? { content: outputText, isError: Boolean(item.error || data.error) } : null,
      ...buildSubagentToolFields(toolName, undefined, true),
    };
  }
  if (itemType === 'command_execution') {
    const normalized = normalizeCodexRealtimeItem({
      ...data,
      itemType,
      itemId: getItemId(data),
    });
    const command = String(data.command || item.command || '');
    const output = normalizeCodexToolOutput(data.output ?? item.output ?? '');
    const exitCode = data.exitCode ?? null;
    const hasOutput = !isEmptyOutput(output);
    return {
      isToolUse: true,
      toolName: String(normalized?.toolName || 'Bash'),
      toolInput: formatToolInput(normalized?.toolInput ?? (command ? { command } : undefined)),
      toolResult: hasOutput
        ? (normalized?.toolResult ?? { content: output })
        : null,
      toolId: typeof getItemId(data) === 'string' ? getItemId(data) as string : undefined,
      toolCallId: getItemId(data),
      exitCode,
      status: typeof data.status === 'string' ? data.status : undefined,
    };
  }
  if (itemType === 'tool_call') {
    const tool = String(data.tool ?? data.name ?? item.name ?? item.tool ?? '');
    const toolInput = data.arguments ?? data.input ?? data.args ?? item.arguments ?? item.input ?? item.args;
    const toolCallId = getToolCallId(data);
    return {
      isToolUse: true,
      toolName: tool || 'tool',
      toolInput: formatToolInput(toolInput ?? (data.output ? { output: data.output } : undefined)),
      toolResult: null,
      toolId: typeof toolCallId === 'string' ? toolCallId as string : undefined,
      toolCallId,
      status: typeof (data.status ?? item.status) === 'string' ? String(data.status ?? item.status) : undefined,
      ...buildSubagentToolFields(tool || 'tool', toolInput, false),
    };
  }
  if (itemType === 'tool_result') {
    const tool = String(data.tool ?? data.name ?? item.name ?? item.tool ?? '');
    const result = normalizeCodexToolOutput(
      data.result ?? data.output ?? data.content ?? item.result ?? item.output ?? item.content ?? '',
    );
    const hasResult = !isEmptyOutput(result);
    const toolCallId = getToolCallId(data);
    return {
      isToolUse: true,
      toolName: tool || 'tool',
      toolResult: hasResult ? { content: result, isError: Boolean(data.isError ?? item.isError ?? data.error ?? item.error) } : null,
      toolId: typeof toolCallId === 'string' ? toolCallId as string : undefined,
      toolCallId,
      status: typeof (data.status ?? item.status) === 'string' ? String(data.status ?? item.status) : undefined,
      ...buildSubagentToolFields(tool || 'tool', undefined, true),
    };
  }
  if (itemType === 'mcp_tool_call') {
    const normalized = normalizeCodexRealtimeItem({
      ...data,
      itemType,
      itemId: getItemId(data),
    });
    const tool = String(normalized?.toolName || data.tool || '');
    return {
      isToolUse: true,
      toolName: tool || 'mcp_tool',
      toolInput: formatToolInput(normalized?.toolInput ?? data.arguments ?? undefined),
      toolResult: normalized?.toolResult ?? null,
      toolId: typeof getItemId(data) === 'string' ? getItemId(data) as string : undefined,
      toolCallId: getItemId(data),
      status: typeof data.status === 'string' ? data.status : undefined,
    };
  }
  return {};
}

function formatToolInput(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.command === 'string') {
      return record.command;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Normalize tool identity payloads so realtime SDK events can be compared with
 * JSONL-replayed tool cards even when one side stores structured JSON as text.
 */
function normalizeToolPayloadText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    const parsed = parseCodexJsonMaybe(value);
    if (parsed !== value) {
      return normalizeToolPayloadText(parsed);
    }
    return value.replace(/\s+/g, ' ').trim();
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value).replace(/\s+/g, ' ').trim();
  }
}

/**
 * Compare live assistant text defensively because some provider events replay a
 * completed message under a different item id after streaming partial text.
 */
function isLiveTextCovered(existingText: string, incomingText: string): boolean {
  const existing = existingText.replace(/\s+/g, ' ').trim();
  const incoming = incomingText.replace(/\s+/g, ' ').trim();
  if (!existing || !incoming) {
    return false;
  }
  return existing === incoming || existing.startsWith(incoming) || incoming.startsWith(existing);
}

/**
 * Keep duplicate live assistant rows scoped to the same user turn.
 */
function hasSameLiveTurnIdentity(message: ChatMessageLike, activeTurnFields: Partial<ChatMessageLike>): boolean {
  const incomingClientRequestId = typeof activeTurnFields.clientRequestId === 'string' ? activeTurnFields.clientRequestId : '';
  const existingClientRequestId = typeof message.clientRequestId === 'string' ? message.clientRequestId : '';
  if (incomingClientRequestId || existingClientRequestId) {
    return Boolean(incomingClientRequestId && existingClientRequestId && incomingClientRequestId === existingClientRequestId);
  }

  const incomingTurnAnchorKey = typeof activeTurnFields.turnAnchorKey === 'string' ? activeTurnFields.turnAnchorKey : '';
  const existingTurnAnchorKey = typeof message.turnAnchorKey === 'string' ? message.turnAnchorKey : '';
  if (incomingTurnAnchorKey || existingTurnAnchorKey) {
    return Boolean(incomingTurnAnchorKey && existingTurnAnchorKey && incomingTurnAnchorKey === existingTurnAnchorKey);
  }

  return true;
}

/**
 * Extract text from a tool result without requiring both live and persisted
 * shapes to be byte-identical.
 */
function getToolResultText(message: ChatMessageLike | Partial<ChatMessageLike>): string {
  const result = message.toolResult;
  if (!result || typeof result !== 'object') {
    return '';
  }
  return normalizeToolPayloadText((result as Record<string, unknown>).content);
}

/**
 * Drop late live tool echoes once a JSONL-replayed card with the same identity
 * and a persisted result already exists.
 */
function hasConvergedPersistedTool(
  messages: ChatMessageLike[],
  toolPayload: Partial<ChatMessageLike>,
): boolean {
  if (!toolPayload.isToolUse) {
    return false;
  }

  const incomingToolId = normalizeToolPayloadText(toolPayload.toolCallId || toolPayload.toolId);
  const incomingToolName = normalizeToolPayloadText(toolPayload.toolName);
  const incomingToolInput = normalizeToolPayloadText(toolPayload.toolInput);
  const incomingResult = getToolResultText(toolPayload);

  return messages.some((message) => {
    if (
      message.type !== 'assistant' ||
      !message.isToolUse ||
      String(message.source || '').endsWith('-live')
    ) {
      return false;
    }

    const existingToolId = normalizeToolPayloadText(message.toolCallId || message.toolId);
    const sameToolIdentity = Boolean(incomingToolId && existingToolId && incomingToolId === existingToolId)
      || (
        incomingToolName.length > 0 &&
        incomingToolName === normalizeToolPayloadText(message.toolName) &&
        incomingToolInput === normalizeToolPayloadText(message.toolInput)
      );

    if (!sameToolIdentity) {
      return false;
    }

    const persistedResult = getToolResultText(message);
    return !incomingResult || Boolean(persistedResult);
  });
}

/**
 * Return whether a tool message came from live websocket state.
 */
function isLiveToolMessage(message: ChatMessageLike, provider: string): boolean {
  /** Limit out-of-order merging to live rows from the same provider turn. */
  const source = String(message.source || '');
  return message.type === 'assistant' &&
    message.isToolUse === true &&
    message.provider === provider &&
    (source.endsWith('-live') || source.endsWith('-realtime'));
}

/**
 * Check whether two live tool fragments describe the same tool call.
 */
function isSameLiveToolIdentity(
  existing: ChatMessageLike,
  incoming: Partial<ChatMessageLike>,
  activeTurnFields: Partial<ChatMessageLike>,
): boolean {
  /** Match by call id first, then cautiously by name/input within one turn. */
  if (!hasSameLiveTurnIdentity(existing, activeTurnFields)) {
    return false;
  }

  const existingToolId = normalizeToolPayloadText(existing.toolCallId || existing.toolId);
  const incomingToolId = normalizeToolPayloadText(incoming.toolCallId || incoming.toolId);
  if (existingToolId || incomingToolId) {
    return Boolean(existingToolId && incomingToolId && existingToolId === incomingToolId);
  }

  const existingToolName = normalizeToolPayloadText(existing.toolName);
  const incomingToolName = normalizeToolPayloadText(incoming.toolName);
  if (!existingToolName || existingToolName !== incomingToolName) {
    return false;
  }

  const existingInput = normalizeToolPayloadText(existing.toolInput);
  const incomingInput = normalizeToolPayloadText(incoming.toolInput);
  return Boolean(
    (existingInput && incomingInput && existingInput === incomingInput) ||
    (existing.toolResult && incomingInput && !existingInput) ||
    (incoming.toolResult && existingInput && !incomingInput),
  );
}

/**
 * Preserve accumulated subagent child state while applying a live fragment.
 */
function mergeSubagentState(
  existing: ChatMessageLike,
  incoming: Partial<ChatMessageLike>,
): Partial<ChatMessageLike> {
  /** Combine start and result fragments without resetting known child tools. */
  if (!existing.isSubagentContainer && !incoming.isSubagentContainer) {
    return {};
  }

  const existingState = existing.subagentState;
  const incomingState = incoming.subagentState;
  const childTools = Array.isArray(incomingState?.childTools) && incomingState.childTools.length > 0
    ? incomingState.childTools
    : (Array.isArray(existingState?.childTools) ? existingState.childTools : []);

  return {
    isSubagentContainer: true,
    subagentState: {
      childTools,
      currentToolIndex: childTools.length > 0 ? childTools.length - 1 : -1,
      isComplete: Boolean(existingState?.isComplete || incomingState?.isComplete || incoming.toolResult),
    },
  };
}

/**
 * Keep terminal tool state when a start/input fragment arrives after output.
 */
function mergeToolStatus(
  existing: ChatMessageLike,
  incoming: Partial<ChatMessageLike>,
): string | undefined {
  /** Live providers can deliver completed output before the running input echo. */
  const existingStatus = typeof existing.status === 'string' ? existing.status : '';
  const incomingStatus = typeof incoming.status === 'string' ? incoming.status : '';
  const terminalStatuses = new Set(['completed', 'complete', 'done', 'final']);
  const runningStatuses = new Set(['in_progress', 'running', 'started']);

  if (terminalStatuses.has(existingStatus) && runningStatuses.has(incomingStatus)) {
    return existingStatus;
  }
  return incomingStatus || existingStatus || undefined;
}

/**
 * Merge a late live tool call/result fragment into an existing card.
 */
function mergeToolPayloadIntoMessage(
  existing: ChatMessageLike,
  input: {
    targetType: string;
    provider: string;
    messageKey: string;
    mergedText: string;
    toolPayload: Partial<ChatMessageLike>;
    activeTurnFields: Partial<ChatMessageLike>;
    isThinking: boolean;
    shouldHidePending: boolean;
  },
): ChatMessageLike {
  /** Keep whichever side has input/result so output-first streams converge. */
  const mergedToolInput =
    input.toolPayload.toolInput !== undefined && input.toolPayload.toolInput !== null && input.toolPayload.toolInput !== ''
      ? input.toolPayload.toolInput
      : existing.toolInput;
  const mergedToolResult =
    input.toolPayload.toolResult !== undefined && input.toolPayload.toolResult !== null
      ? input.toolPayload.toolResult
      : existing.toolResult;
  const mergedToolName =
    input.toolPayload.toolName !== undefined && input.toolPayload.toolName !== null && input.toolPayload.toolName !== ''
      ? input.toolPayload.toolName
      : existing.toolName;
  const mergedToolCallId =
    input.toolPayload.toolCallId !== undefined && input.toolPayload.toolCallId !== null && input.toolPayload.toolCallId !== ''
      ? input.toolPayload.toolCallId
      : existing.toolCallId;
  const mergedToolId =
    input.toolPayload.toolId !== undefined && input.toolPayload.toolId !== null && input.toolPayload.toolId !== ''
      ? input.toolPayload.toolId
      : existing.toolId;
  const mergedStatus = mergeToolStatus(existing, input.toolPayload);

  return {
    ...existing,
    type: input.targetType,
    content: input.mergedText,
    provider: input.provider,
    source: `${input.provider}-live`,
    messageKey: input.messageKey,
    timestamp: existing?.timestamp || new Date(),
    ...(input.isThinking ? { isThinking: true } : {}),
    ...input.toolPayload,
    toolInput: mergedToolInput,
    toolResult: mergedToolResult,
    toolName: mergedToolName,
    toolId: mergedToolId,
    toolCallId: mergedToolCallId,
    status: mergedStatus,
    ...mergeSubagentState(existing, input.toolPayload),
    ...input.activeTurnFields,
    ...(input.shouldHidePending
      ? { renderVisibility: 'pending' as const, pending: true }
      : { renderVisibility: undefined, pending: undefined }),
  };
}

/**
 * Find an existing live card for out-of-order tool call/result fragments.
 */
function findMergeableLiveToolIndex(
  messages: ChatMessageLike[],
  toolPayload: Partial<ChatMessageLike>,
  provider: string,
  activeTurnFields: Partial<ChatMessageLike>,
): number {
  /** Search newest first so consecutive tools with similar names stay distinct. */
  if (!toolPayload.isToolUse) {
    return -1;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (
      isLiveToolMessage(candidate, provider) &&
      isSameLiveToolIdentity(candidate, toolPayload, activeTurnFields)
    ) {
      return index;
    }
  }

  return -1;
}

function buildVisibleContent(data: Record<string, unknown>, itemType: string): string {
  const item = getNestedItem(data);
  if (itemType === 'command_execution') return '';
  if (itemType === 'tool_call' || itemType === 'mcp_tool_call') return '';
  if (itemType === 'function_call' || itemType === 'custom_tool_call') return '';
  if (itemType === 'tool_result' || itemType === 'function_call_output') {
    return '';
  }
  if (itemType === 'file_change') return '';
  if (itemType === 'error') return String(data.message || '');
  const message = data.message as Record<string, unknown> | undefined;
  if (typeof message?.content === 'string') return message.content;
  if (message?.content) return extractText(message.content);
  // Streaming deltas for agent_message and reasoning arrive via delta.text,
  // not message.content.  Extract them so live transcript updates are visible.
  const delta = data.delta && typeof data.delta === 'object' ? (data.delta as Record<string, unknown>) : null;
  if (delta) {
    if (typeof delta.text === 'string' && delta.text) return delta.text;
    if (typeof delta.content === 'string' && delta.content) return delta.content;
    if (delta.text) return extractText(delta.text);
    if (delta.content) return extractText(delta.content);
  }
  return '';
}

function isCompletedEvent(data: Record<string, unknown>): boolean {
  const status = String(data.status ?? '');
  if (status === 'in_progress' || status === 'running' || status === 'started') {
    return false;
  }
  if (status === 'completed' || status === 'complete' || status === 'done' || status === 'final') {
    return true;
  }
  const itemType = String(data.itemType ?? '');
  if (itemType === 'function_call_output' || itemType === 'tool_result') {
    return true;
  }
  const delta = data.delta && typeof data.delta === 'object' ? (data.delta as Record<string, unknown>) : null;
  const message = data.message as Record<string, unknown> | undefined;
  if (!delta && message && typeof message.content === 'string' && message.content) {
    return true;
  }
  return false;
}

function isEmptyOutput(output: string): boolean {
  return output.trim().length === 0;
}

function hasRenderableToolPayload(toolPayload: Partial<ChatMessageLike>): boolean {
  /**
   * Live function_call/file_change events are useful before a terminal status
   * arrives because their input already contains the command or changed paths.
   * Empty tool placeholders still stay pending until completion or output.
   */
  return Boolean(
    toolPayload.isToolUse
    && (
      toolPayload.toolInput !== undefined
      || toolPayload.toolResult !== undefined
      || toolPayload.toolName
    ),
  );
}

function getActiveTurnOverlayFields(messages: ChatMessageLike[]): Partial<ChatMessageLike> {
  /**
   * Copy turn identity from the latest local user into subsequent live rows.
   * First/new turns may only have clientRequestId until the persisted echo
   * arrives, so keep both identities when available.
   */
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.type !== 'user') {
      continue;
    }
    const turnAnchorKey = typeof message.turnAnchorKey === 'string' ? message.turnAnchorKey : '';
    const clientRequestId = typeof message.clientRequestId === 'string' ? message.clientRequestId : '';
    return {
      ...(turnAnchorKey ? { turnAnchorKey } : {}),
      ...(clientRequestId ? { clientRequestId } : {}),
    };
  }
  return {};
}

/**
 * Drop rows that are still pending and must not enter the visible transcript.
 * This is the single source of truth for the renderable vs pending boundary;
 * both the production UI and contract tests must use it.
 */
export function filterRenderableMessages<T extends ChatMessageLike>(messages: T[]): T[] {
  return messages.filter((message) => (
    message.renderVisibility !== 'pending'
    && message.hiddenUntilComplete !== true
    && message.pending !== true
  ));
}

export function reduceNativeRuntimeEvent(
  messages: ChatMessageLike[],
  event: NativeRuntimeEvent,
): ChatMessageLike[] {
  const eventType = String(event?.type ?? '');
  const data = event?.data;
  if (!data || typeof data !== 'object') {
    return messages;
  }

  const dataRecord = data as Record<string, unknown>;
  const itemType = String(dataRecord?.itemType ?? '');
  const innerType = String(dataRecord?.type ?? '');

  if (innerType !== 'item' || !LIVE_ITEM_TYPES.has(itemType)) {
    return messages;
  }

  if (itemType === 'update') {
    const normalizedUpdate = resolveProviderToolUpdatePayload(dataRecord);
    if (normalizedUpdate) {
      return reduceNativeRuntimeEvent(messages, { ...event, data: normalizedUpdate });
    }
    return messages;
  }

  const provider = eventType === 'pi-response' ? 'pi' : 'codex';
  const itemId = getItemId(dataRecord);
  const messageData = dataRecord?.message;
  const role =
    messageData && typeof messageData === 'object' ? String((messageData as Record<string, unknown>)?.role ?? '') : '';
  const rawContent =
    messageData && typeof messageData === 'object' ? (messageData as Record<string, unknown>)?.content : '';
  // Codex streaming deltas carry text in delta.text; prefer it over message.content
  // when message.content is absent, so agent_message fragments are visible.
  const deltaContent =
    dataRecord?.delta && typeof dataRecord.delta === 'object'
      ? (dataRecord.delta as Record<string, unknown>)?.text ?? (dataRecord.delta as Record<string, unknown>)?.content
      : undefined;
  const content = rawContent || deltaContent || '';

  // For agent_message, restrict to assistant role; other item types bypass role check.
  if (itemType === 'agent_message' && role !== 'assistant') {
    return messages;
  }
  if (itemType === 'agent_message') {
    const fileOperation = normalizeCodexFileOperationPayload(content);
    if (fileOperation) {
      return reduceNativeRuntimeEvent(messages, buildLiveFileChangeEvent(event, itemId, fileOperation));
    }
    if (isProviderFileUpdatePayload(content)) {
      return messages;
    }
    const normalizedUpdate = resolveProviderToolUpdatePayload(content);
    if (normalizedUpdate) {
      return reduceNativeRuntimeEvent(messages, { ...event, data: normalizedUpdate });
    }
  }

  const activeTurnFields = getActiveTurnOverlayFields(messages);
  const targetType = messageTypeFromItemType(itemType);
  const visibleContent = buildVisibleContent(dataRecord, itemType);
  const isThinking = itemType === 'reasoning' || itemType === 'thinking';
  const isCompleted = isCompletedEvent(dataRecord);
  const toolPayload = buildToolPayload(dataRecord, itemType);
  const isPendingToolCall = Boolean(toolPayload.isToolUse && !isCompleted);
  const hasVisibleTextDelta = (
    itemType === 'agent_message' ||
    itemType === 'reasoning' ||
    itemType === 'thinking'
  ) && Boolean(visibleContent || extractText(content));
  const hasVisibleToolPayload = hasRenderableToolPayload(toolPayload);
  const shouldHidePending = (provider === 'codex' || provider === 'pi')
    && !isCompleted
    && itemType !== 'command_execution'
    && ((isPendingToolCall && !hasVisibleToolPayload) || (!hasVisibleTextDelta && !hasVisibleToolPayload));

  // Thinking events without a stable itemId: merge into the most recent
  // thinking block from the same provider if no non-thinking messages were
  // inserted in between.  Otherwise create a new block to preserve the
  // provider's live event order.
  if (isThinking && (!itemId || typeof itemId !== 'string')) {
    const last = messages.length > 0 ? messages[messages.length - 1] : null;
    if (last && last.isThinking && last.provider === provider) {
      const updated = [...messages];
      const existingText = extractText(last.content);
      const newText = extractText(content) || visibleContent;
      const mergedText =
        !isCompleted && provider === 'pi' && newText && !existingText.endsWith(newText) && !newText.startsWith(existingText)
          ? existingText + newText
          : newText;
      updated[messages.length - 1] = {
        ...last,
        type: targetType,
        content: mergedText,
        timestamp: last.timestamp || new Date(),
        ...(shouldHidePending ? { renderVisibility: 'pending' as const, pending: true } : { renderVisibility: undefined, pending: undefined }),
      };
      return updated;
    }
    // Derive a unique stable key for reasoning/thinking blocks that lack a
    // provider-assigned itemId.  Without this, two reasoning blocks
    // separated by a tool card both get buildMessageKey(provider, '')
    // → "provider:unknown", which collides in React key maps and triggers
    // "Maximum update depth exceeded" crashes.
    const thinkingCount = messages.filter((m) => m.isThinking && m.provider === provider).length;
    const uniqueKey = `${provider}:thinking-${thinkingCount + 1}`;
    return [
      ...messages,
      {
        type: targetType,
        content: extractText(content) || visibleContent,
        provider,
        source: `${provider}-live`,
        messageKey: uniqueKey,
        timestamp: new Date(),
        isThinking: true,
        ...activeTurnFields,
        ...(shouldHidePending ? { renderVisibility: 'pending' as const, pending: true } : {}),
      },
    ];
  }

  const keyItemId = isThinking && typeof itemId === 'string' && itemId
    ? `thinking:${itemId}`
    : (toolPayload.toolCallId ?? itemId);
  const messageKey = buildMessageKey(provider, keyItemId, activeTurnFields.turnAnchorKey);
  const existingIndex = messages.findIndex((m) => m.messageKey === messageKey);

  if (hasConvergedPersistedTool(messages, toolPayload)) {
    return messages;
  }

  if (existingIndex >= 0) {
    const updated = [...messages];
    const existing = updated[existingIndex];
    const existingText = extractText(existing?.content);
    const newText = extractText(content) || visibleContent;
    // For streaming deltas the content may be partial; append if it looks
    // like a delta fragment rather than a full replacement.  Both Codex and
    // Pi can send incremental or full-replacement deltas depending on the
    // SDK version, so apply the same append-or-replace heuristic.
    const mergedText =
      !isCompleted && newText && !existingText.endsWith(newText) && !newText.startsWith(existingText)
        ? existingText + newText
        : newText;

    if (itemType === 'agent_message') {
      const mergedFileOperation = normalizeCodexFileOperationPayload(mergedText);
      if (mergedFileOperation) {
        const withoutExisting = messages.filter((_, index) => index !== existingIndex);
        return reduceNativeRuntimeEvent(
          withoutExisting,
          buildLiveFileChangeEvent(event, itemId, mergedFileOperation),
        );
      }
    }

    updated[existingIndex] = mergeToolPayloadIntoMessage(existing, {
      targetType,
      provider,
      messageKey,
      mergedText,
      toolPayload,
      activeTurnFields,
      isThinking,
      shouldHidePending,
    });
    return updated;
  }

  const mergeableLiveToolIndex = findMergeableLiveToolIndex(messages, toolPayload, provider, activeTurnFields);
  if (mergeableLiveToolIndex >= 0) {
    const updated = [...messages];
    const existing = updated[mergeableLiveToolIndex];
    const existingText = extractText(existing?.content);
    const newText = extractText(content) || visibleContent;
    const mergedText =
      !isCompleted && newText && !existingText.endsWith(newText) && !newText.startsWith(existingText)
        ? existingText + newText
        : (newText || existingText);

    updated[mergeableLiveToolIndex] = mergeToolPayloadIntoMessage(existing, {
      targetType,
      provider,
      messageKey: existing.messageKey || messageKey,
      mergedText,
      toolPayload,
      activeTurnFields,
      isThinking,
      shouldHidePending,
    });
    return updated;
  }

  // If no stable itemId and an assistant message from the same provider
  // already exists, update the most recent one instead of creating a
  // duplicate with an unknown key. This handles Pi agent_end summaries
  // that arrive without an itemId after streaming deltas.
  if (provider === 'pi' && (!itemId || typeof itemId !== 'string') && itemType === 'agent_message') {
    let lastProviderAssistant = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].provider === provider && messages[i].type === 'assistant') {
        lastProviderAssistant = i;
        break;
      }
    }
    if (lastProviderAssistant >= 0) {
      const existing = messages[lastProviderAssistant];
      // Only merge into the most recent live assistant row from the same
      // provider. Persisted history rows must not be overwritten by new
      // live deltas that lack a stable itemId.
      const existingSource = String(existing.source || '');
      const isLiveSource = existingSource.endsWith('-live') || existingSource.endsWith('-realtime');
      if (isLiveSource) {
        const updated = [...messages];
        const existingText = extractText(existing?.content);
        const newText = extractText(content);
        const mergedText =
          !isCompleted && provider === 'pi' && newText && !existingText.endsWith(newText) && !newText.startsWith(existingText)
            ? existingText + newText
            : newText;
        updated[lastProviderAssistant] = {
          ...existing,
          type: targetType,
          content: mergedText,
          provider,
          source: `${provider}-live`,
          timestamp: existing?.timestamp || new Date(),
          ...activeTurnFields,
          ...(shouldHidePending ? { renderVisibility: 'pending' as const, pending: true } : { renderVisibility: undefined, pending: undefined }),
        };
        return updated;
      }
    }
  }

  if (itemType === 'agent_message') {
    const incomingText = extractText(content) || visibleContent;
    if (incomingText) {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const existing = messages[index];
        const existingSource = String(existing.source || '');
        if (
          existing.type !== 'assistant' ||
          existing.isToolUse ||
          existing.provider !== provider ||
          !(existingSource.endsWith('-live') || existingSource.endsWith('-realtime')) ||
          !hasSameLiveTurnIdentity(existing, activeTurnFields) ||
          !isLiveTextCovered(extractText(existing.content), incomingText)
        ) {
          continue;
        }

        const updated = [...messages];
        const existingText = extractText(existing.content);
        const mergedText = incomingText.length >= existingText.length ? incomingText : existingText;
        updated[index] = {
          ...existing,
          type: targetType,
          content: mergedText,
          provider,
          source: `${provider}-live`,
          timestamp: existing.timestamp || new Date(),
          ...activeTurnFields,
          ...(shouldHidePending ? { renderVisibility: 'pending' as const, pending: true } : { renderVisibility: undefined, pending: undefined }),
        };
        return updated;
      }
    }
  }

  return [
    ...messages,
    {
      type: targetType,
      content: extractText(content) || visibleContent,
      provider,
      source: `${provider}-live`,
      messageKey,
      timestamp: new Date(),
      ...(isThinking ? { isThinking: true } : {}),
      ...toolPayload,
      ...activeTurnFields,
      ...(shouldHidePending ? { renderVisibility: 'pending' as const, pending: true } : {}),
    },
  ];
}
