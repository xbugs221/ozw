import type { ChatMessage } from '../types/types';
import { decodeHtmlEntities, unescapeWithMathProtection } from './chatFormatting';
import { dedupeAdjacentChatMessages } from './messageDedup';
import {
  normalizeCodexFunctionCall,
  normalizeCodexToolOutput,
  parseCodexJsonMaybe,
} from '../../../../shared/codex-message-normalizer.js';

export interface DiffLine {
  type: 'added' | 'removed';
  content: string;
  lineNum: number;
}

export type DiffCalculator = (oldStr: string, newStr: string) => DiffLine[];

type CursorBlob = {
  id?: string;
  sequence?: number;
  rowid?: number;
  content?: any;
};

const USER_UPLOAD_NOTE_MARKER = '[User uploaded files for this message]';
const PROVIDER_FILE_UPDATE_KINDS = new Set([
  'add',
  'added',
  'create',
  'created',
  'delete',
  'deleted',
  'modify',
  'modified',
  'update',
  'updated',
]);

/**
 * Detect provider bookkeeping JSON that reports a file update instead of a
 * user-visible assistant reply.
 */
function resolveProviderFileUpdatePayload(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5 || value === null || value === undefined) {
    return null;
  }

  const parsed = parseCodexJsonMaybe(value);
  if (parsed !== value) {
    return resolveProviderFileUpdatePayload(parsed, depth + 1);
  }

  if (Array.isArray(value)) {
    for (const part of value) {
      const payload = resolveProviderFileUpdatePayload(part, depth + 1);
      if (payload) {
        return payload;
      }
    }
    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.path === 'string' && (typeof record.kind === 'string' || typeof record.type === 'string')) {
    return record;
  }

  const nested = record.message ?? record.content ?? record.text ?? record.output ?? record.result;
  if (nested !== undefined && nested !== value) {
    return resolveProviderFileUpdatePayload(nested, depth + 1);
  }

  return null;
}

/**
 * Return true when assistant content is only provider file-update bookkeeping.
 */
function isProviderFileUpdatePayload(value: unknown): boolean {
  const payload = resolveProviderFileUpdatePayload(value);
  const kind = typeof payload?.kind === 'string'
    ? payload.kind
    : (typeof payload?.type === 'string' ? payload.type : '');
  return typeof payload?.path === 'string' && PROVIDER_FILE_UPDATE_KINDS.has(kind);
}

/**
 * Resolve Codex update/functionCall JSON that leaked into assistant text from
 * provider read models, so refresh/follow-latest renders a tool card instead.
 */
function resolveCodexToolUpdateJson(value: unknown, depth = 0): { kind: 'tool_use' | 'tool_result'; payload: Record<string, unknown> } | null {
  if (depth > 5 || value === null || value === undefined) {
    return null;
  }

  const parsed = parseCodexJsonMaybe(value);
  if (parsed !== value) {
    return resolveCodexToolUpdateJson(parsed, depth + 1);
  }

  if (Array.isArray(value)) {
    for (const part of value) {
      const resolved = resolveCodexToolUpdateJson(part, depth + 1);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawType = String(record.type ?? record.itemType ?? '');
  if (rawType === 'functionCall' || rawType === 'function_call') {
    return { kind: 'tool_use', payload: { ...record, type: 'function_call' } };
  }
  if (rawType === 'functionCallOutput' || rawType === 'function_call_output') {
    return { kind: 'tool_result', payload: { ...record, type: 'function_call_output' } };
  }
  if (rawType === 'update') {
    const nested = record.item ?? record.payload ?? record.data ?? record.update;
    if (nested !== undefined && nested !== value) {
      return resolveCodexToolUpdateJson(nested, depth + 1);
    }
  }

  const nested = record.item ?? record.payload ?? record.data ?? record.update ?? record.message ?? record.content ?? record.text;
  if (nested !== undefined && nested !== value) {
    return resolveCodexToolUpdateJson(nested, depth + 1);
  }

  return null;
}

function toCodexToolUpdateChatMessage(
  value: unknown,
  timestamp: string | number | Date,
  messageKey: string | undefined,
  clientRequestId: string | undefined,
  provider?: string,
  orderFields: Partial<ChatMessage> = {},
): ChatMessage | null {
  /**
   * Convert leaked Codex tool update JSON into the same ChatMessage shape as
   * tool_use/tool_result rows from the server read model.
   */
  const resolved = resolveCodexToolUpdateJson(value);
  if (!resolved) {
    return null;
  }

  const toolCallId = resolved.payload.call_id ?? resolved.payload.callId ?? resolved.payload.id;
  const toolCallIdText = typeof toolCallId === 'string' ? toolCallId : undefined;
  if (resolved.kind === 'tool_result') {
    return {
      type: 'assistant',
      content: '',
      timestamp,
      provider,
      messageKey,
      clientRequestId,
      ...orderFields,
      isToolUse: true,
      toolCallId: toolCallIdText,
      toolId: toolCallIdText,
      toolResult: {
        content: normalizeCodexToolOutput(resolved.payload.output ?? resolved.payload.content ?? resolved.payload.result),
        isError: Boolean(resolved.payload.error),
      },
    };
  }

  const normalized = normalizeCodexFunctionCall(resolved.payload);
  const normalizedToolCallId = typeof normalized.toolCallId === 'string' ? normalized.toolCallId : undefined;
  return {
    type: 'assistant',
    content: '',
    timestamp,
    provider,
    messageKey,
    clientRequestId,
    ...orderFields,
    isToolUse: true,
    toolName: normalized.toolName,
    toolInput: normalizeToolInput(normalized.toolInput),
    toolCallId: normalizedToolCallId,
    toolId: normalizedToolCallId,
    toolResult: null,
  };
}

/**
 * Remove provider-facing upload metadata from user-visible transcript text.
 */
function stripUserUploadNoteForDisplay(content: string): string {
  const markerIndex = content.indexOf(USER_UPLOAD_NOTE_MARKER);
  if (markerIndex < 0) {
    return content;
  }

  return content.slice(0, markerIndex).trimEnd();
}

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const normalizeToolInput = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

/**
 * Convert Codex commentary updates into compact status rows so progress
 * messages do not overwhelm the main assistant transcript.
 */
const toCodexAssistantChatMessage = (
  content: string,
  timestamp: string | number | Date,
  messageKey: string | undefined,
  clientRequestId: string | undefined,
  phase: unknown,
  provider?: string,
  orderFields: Partial<ChatMessage> = {},
): ChatMessage => {
  if (phase === 'commentary') {
    return {
      type: 'assistant',
      content,
      timestamp,
      phase: 'commentary',
      provider,
      messageKey,
      clientRequestId,
      ...orderFields,
      isTaskNotification: true,
      taskStatus: 'in_progress',
    };
  }

  return {
    type: 'assistant',
    content,
    timestamp,
    phase: typeof phase === 'string' ? phase : undefined,
    provider,
    messageKey,
    clientRequestId,
    ...orderFields,
  };
};

/**
 * Convert tool outputs from mixed transport shapes into renderable text.
 */
const normalizeToolResultContent = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const joined = value
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object') {
          return normalizeToolResultContent((item as Record<string, unknown>).text
            ?? (item as Record<string, unknown>).content
            ?? (item as Record<string, unknown>).output);
        }
        return String(item ?? '');
      })
      .filter(Boolean)
      .join('\n');

    if (joined) {
      return joined;
    }
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const nestedText = record.content ?? record.output ?? record.text ?? record.stdout ?? record.stderr;
    if (nestedText !== undefined && nestedText !== value) {
      return normalizeToolResultContent(nestedText);
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return String(value);
};

const toAbsolutePath = (projectPath: string, filePath?: string) => {
  if (!filePath) {
    return filePath;
  }
  return filePath.startsWith('/') ? filePath : `${projectPath}/${filePath}`;
};

export const calculateDiff = (oldStr: string, newStr: string): DiffLine[] => {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');

  // Use LCS alignment so insertions/deletions don't cascade into a full-file "changed" diff.
  const lcsTable: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      if (oldLines[oldIndex] === newLines[newIndex]) {
        lcsTable[oldIndex][newIndex] = lcsTable[oldIndex + 1][newIndex + 1] + 1;
      } else {
        lcsTable[oldIndex][newIndex] = Math.max(
          lcsTable[oldIndex + 1][newIndex],
          lcsTable[oldIndex][newIndex + 1],
        );
      }
    }
  }

  const diffLines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];

    if (oldLine === newLine) {
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (lcsTable[oldIndex + 1][newIndex] >= lcsTable[oldIndex][newIndex + 1]) {
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      oldIndex += 1;
      continue;
    }

    diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
    newIndex += 1;
  }

  while (oldIndex < oldLines.length) {
    diffLines.push({ type: 'removed', content: oldLines[oldIndex], lineNum: oldIndex + 1 });
    oldIndex += 1;
  }

  while (newIndex < newLines.length) {
    diffLines.push({ type: 'added', content: newLines[newIndex], lineNum: newIndex + 1 });
    newIndex += 1;
  }

  return diffLines;
};

export const createCachedDiffCalculator = (): DiffCalculator => {
  const cache = new Map<string, DiffLine[]>();

  return (oldStr: string, newStr: string) => {
    const key = JSON.stringify([oldStr, newStr]);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const calculated = calculateDiff(oldStr, newStr);
    cache.set(key, calculated);
    if (cache.size > 100) {
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        cache.delete(firstKey);
      }
    }
    return calculated;
  };
};

export const convertCursorSessionMessages = (blobs: CursorBlob[], projectPath: string): ChatMessage[] => {
  const converted: ChatMessage[] = [];
  const toolUseMap: Record<string, ChatMessage> = {};

  for (let blobIdx = 0; blobIdx < blobs.length; blobIdx += 1) {
    const blob = blobs[blobIdx];
    const content = blob.content;
    let text = '';
    let role: ChatMessage['type'] = 'assistant';
    let reasoningText: string | null = null;

    try {
      if (content?.role && content?.content) {
        if (content.role === 'system') {
          continue;
        }

        if (content.role === 'tool') {
          const toolItems = asArray<any>(content.content);
          for (const item of toolItems) {
            if (item?.type !== 'tool-result') {
              continue;
            }

            const toolName = item.toolName === 'ApplyPatch' ? 'Edit' : item.toolName || 'Unknown Tool';
            const toolCallId = item.toolCallId || content.id;
            const result = item.result || '';

            if (toolCallId && toolUseMap[toolCallId]) {
              toolUseMap[toolCallId].toolResult = {
                content: result,
                isError: false,
              };
            } else {
              converted.push({
                type: 'assistant',
                content: '',
                timestamp: new Date(Date.now() + blobIdx * 1000),
                blobId: blob.id,
                sequence: blob.sequence,
                rowid: blob.rowid,
                isToolUse: true,
                toolName,
                toolId: toolCallId,
                toolInput: normalizeToolInput(null),
                toolResult: {
                  content: result,
                  isError: false,
                },
              });
            }
          }
          continue;
        }

        role = content.role === 'user' ? 'user' : 'assistant';

        if (Array.isArray(content.content)) {
          const textParts: string[] = [];

          for (const part of content.content) {
            if (part?.type === 'text' && part?.text) {
              textParts.push(decodeHtmlEntities(part.text));
              continue;
            }

            if (part?.type === 'reasoning' && part?.text) {
              reasoningText = decodeHtmlEntities(part.text);
              continue;
            }

            if (part?.type === 'tool-call' || part?.type === 'tool_use') {
              if (textParts.length > 0 || reasoningText) {
                converted.push({
                  type: role,
                  content: textParts.join('\n'),
                  reasoning: reasoningText ?? undefined,
                  timestamp: new Date(Date.now() + blobIdx * 1000),
                  blobId: blob.id,
                  sequence: blob.sequence,
                  rowid: blob.rowid,
                });
                textParts.length = 0;
                reasoningText = null;
              }

              const toolNameRaw = part.toolName || part.name || 'Unknown Tool';
              const toolName = toolNameRaw === 'ApplyPatch' ? 'Edit' : toolNameRaw;
              const toolId = part.toolCallId || part.id || `tool_${blobIdx}`;
              let toolInput = part.args || part.input;

              if (toolName === 'Edit' && part.args) {
                if (part.args.patch) {
                  const patchLines = String(part.args.patch).split('\n');
                  const oldLines: string[] = [];
                  const newLines: string[] = [];
                  let inPatch = false;

                  patchLines.forEach((line) => {
                    if (line.startsWith('@@')) {
                      inPatch = true;
                      return;
                    }
                    if (!inPatch) {
                      return;
                    }

                    if (line.startsWith('-')) {
                      oldLines.push(line.slice(1));
                    } else if (line.startsWith('+')) {
                      newLines.push(line.slice(1));
                    } else if (line.startsWith(' ')) {
                      oldLines.push(line.slice(1));
                      newLines.push(line.slice(1));
                    }
                  });

                  toolInput = {
                    file_path: toAbsolutePath(projectPath, part.args.file_path),
                    old_string: oldLines.join('\n') || part.args.patch,
                    new_string: newLines.join('\n') || part.args.patch,
                  };
                } else {
                  toolInput = part.args;
                }
              } else if (toolName === 'Read' && part.args) {
                const filePath = part.args.path || part.args.file_path;
                toolInput = {
                  file_path: toAbsolutePath(projectPath, filePath),
                };
              } else if (toolName === 'Write' && part.args) {
                const filePath = part.args.path || part.args.file_path;
                toolInput = {
                  file_path: toAbsolutePath(projectPath, filePath),
                  content: part.args.contents || part.args.content,
                };
              }

              const toolMessage: ChatMessage = {
                type: 'assistant',
                content: '',
                timestamp: new Date(Date.now() + blobIdx * 1000),
                blobId: blob.id,
                sequence: blob.sequence,
                rowid: blob.rowid,
                isToolUse: true,
                toolName,
                toolId,
                toolInput: normalizeToolInput(toolInput),
                toolResult: null,
              };
              converted.push(toolMessage);
              toolUseMap[toolId] = toolMessage;
              continue;
            }

            if (typeof part === 'string') {
              textParts.push(part);
            }
          }

          if (textParts.length > 0) {
            text = textParts.join('\n');
            if (reasoningText && !text) {
              converted.push({
                type: role,
                content: '',
                reasoning: reasoningText,
                timestamp: new Date(Date.now() + blobIdx * 1000),
                blobId: blob.id,
                sequence: blob.sequence,
                rowid: blob.rowid,
              });
              text = '';
            }
          } else {
            text = '';
          }
        } else if (typeof content.content === 'string') {
          text = content.content;
        }
      } else if (content?.message?.role && content?.message?.content) {
        if (content.message.role === 'system') {
          continue;
        }

        role = content.message.role === 'user' ? 'user' : 'assistant';
        if (Array.isArray(content.message.content)) {
          text = content.message.content
            .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
            .filter(Boolean)
            .join('\n');
        } else if (typeof content.message.content === 'string') {
          text = content.message.content;
        }
      }
    } catch (error) {
      console.log('Error parsing blob content:', error);
    }

    if (text && text.trim()) {
      const message: ChatMessage = {
        type: role,
        content: text,
        timestamp: new Date(Date.now() + blobIdx * 1000),
        blobId: blob.id,
        sequence: blob.sequence,
        rowid: blob.rowid,
      };
      if (reasoningText) {
        message.reasoning = reasoningText;
      }
      converted.push(message);
    }
  }

  converted.sort((messageA, messageB) => {
    if (messageA.sequence !== undefined && messageB.sequence !== undefined) {
      return Number(messageA.sequence) - Number(messageB.sequence);
    }
    if (messageA.rowid !== undefined && messageB.rowid !== undefined) {
      return Number(messageA.rowid) - Number(messageB.rowid);
    }
    return new Date(messageA.timestamp).getTime() - new Date(messageB.timestamp).getTime();
  });

  return converted;
};

export const convertSessionMessages = (rawMessages: any[]): ChatMessage[] => {
  const converted: ChatMessage[] = [];
  const toolResults = new Map<
    string,
    { content: unknown; isError: boolean; timestamp: Date; toolUseResult: unknown; subagentTools?: unknown[] }
  >();

  const getClientRequestId = (message: any) =>
    typeof message?.clientRequestId === 'string'
      ? message.clientRequestId
      : (typeof message?.requestId === 'string' ? message.requestId : undefined);
  const getStoredOrderFields = (message: any): Partial<ChatMessage> => ({
    ...(message.sequence !== undefined ? { sequence: message.sequence } : {}),
    ...(message.rowid !== undefined ? { rowid: message.rowid } : {}),
  });

  rawMessages.forEach((message) => {
    if (message.message?.role === 'user' && Array.isArray(message.message?.content)) {
      message.message.content.forEach((part: any) => {
        if (part.type !== 'tool_result') {
          return;
        }
        toolResults.set(part.tool_use_id, {
          content: part.content,
          isError: Boolean(part.is_error),
          timestamp: new Date(message.timestamp || Date.now()),
          toolUseResult: message.toolUseResult || null,
          subagentTools: message.subagentTools,
        });
      });
    }
  });

  rawMessages.forEach((message) => {
    if (message.message?.role === 'user' && message.message?.content) {
      let content = '';
      if (Array.isArray(message.message.content)) {
        const textParts: string[] = [];
        message.message.content.forEach((part: any) => {
          if (part.type === 'text') {
            textParts.push(decodeHtmlEntities(part.text));
          }
        });
        content = textParts.join('\n');
      } else if (typeof message.message.content === 'string') {
        content = decodeHtmlEntities(message.message.content);
      } else {
        content = decodeHtmlEntities(String(message.message.content));
      }

      const displayContent = stripUserUploadNoteForDisplay(content);
      const shouldSkip =
        !displayContent ||
        displayContent.startsWith('<command-name>') ||
        displayContent.startsWith('<command-message>') ||
        displayContent.startsWith('<command-args>') ||
        displayContent.startsWith('<local-command-stdout>') ||
        displayContent.startsWith('<system-reminder>') ||
        displayContent.startsWith('Caveat:') ||
        displayContent.startsWith('This session is being continued from a previous') ||
        displayContent.startsWith('[Request interrupted');

      if (!shouldSkip) {
        // Parse <task-notification> blocks into compact system messages
        const taskNotifRegex = /<task-notification>\s*<task-id>[^<]*<\/task-id>\s*<output-file>[^<]*<\/output-file>\s*<status>([^<]*)<\/status>\s*<summary>([^<]*)<\/summary>\s*<\/task-notification>/g;
        const taskNotifMatch = taskNotifRegex.exec(content);
        if (taskNotifMatch) {
          const status = taskNotifMatch[1]?.trim() || 'completed';
          const summary = taskNotifMatch[2]?.trim() || 'Background task finished';
          converted.push({
            type: 'assistant',
            content: summary,
            timestamp: message.timestamp || new Date().toISOString(),
            provider: message.provider,
            messageKey: message.messageKey,
            clientRequestId: getClientRequestId(message),
            ...getStoredOrderFields(message),
            isTaskNotification: true,
            taskStatus: status,
          });
        } else {
          converted.push({
            type: 'user',
            content: unescapeWithMathProtection(displayContent),
            timestamp: message.timestamp || new Date().toISOString(),
            provider: message.provider,
            messageKey: message.messageKey,
            clientRequestId: getClientRequestId(message),
            turnAnchorKey: typeof message.turnAnchorKey === 'string' ? message.turnAnchorKey : undefined,
            ...getStoredOrderFields(message),
            deliveryStatus: 'persisted',
          });
        }
      }
      return;
    }

    if (message.type === 'thinking' && message.message?.content) {
      converted.push({
        type: 'assistant',
        content: unescapeWithMathProtection(message.message.content),
        timestamp: message.timestamp || new Date().toISOString(),
        provider: message.provider,
        messageKey: message.messageKey,
        clientRequestId: getClientRequestId(message),
        ...getStoredOrderFields(message),
        isThinking: true,
      });
      return;
    }

    if (message.type === 'tool_use' && message.toolName) {
      const isSubagentContainer = message.toolName === 'Task' || message.toolName === 'Agent';
      converted.push({
        type: 'assistant',
        content: '',
        timestamp: message.timestamp || new Date().toISOString(),
        provider: message.provider,
        messageKey: message.messageKey,
        clientRequestId: getClientRequestId(message),
        ...getStoredOrderFields(message),
        isToolUse: true,
        toolName: message.toolName,
        toolInput: normalizeToolInput(message.toolInput),
        toolCallId: message.toolCallId,
        toolId: message.toolCallId,
        status: message.status,  // Preserve running/streaming status so
                                 // MessageComponent's isRunningTool check works
        isSubagentContainer,
        subagentState: isSubagentContainer
          ? {
              childTools: [],
              currentToolIndex: -1,
              isComplete: false,
            }
          : undefined,
      });
      return;
    }

    if (message.type === 'tool_result') {
      for (let index = converted.length - 1; index >= 0; index -= 1) {
        const convertedMessage = converted[index];
        if (!convertedMessage.isToolUse || convertedMessage.toolResult) {
          continue;
        }
        if (!message.toolCallId || convertedMessage.toolCallId === message.toolCallId) {
          convertedMessage.toolResult = {
            content: normalizeToolResultContent(message.output),
            isError: false,
          };
          if (
            (convertedMessage.toolName === 'Task' || convertedMessage.toolName === 'Agent') &&
            Array.isArray(message.subagentTools)
          ) {
            const childTools = message.subagentTools.map((tool: any) => ({
              toolId: tool.toolId,
              toolName: tool.toolName,
              toolInput: tool.toolInput,
              toolResult: tool.toolResult || null,
              timestamp: new Date(tool.timestamp || message.timestamp || Date.now()),
            }));
            convertedMessage.isSubagentContainer = true;
            convertedMessage.subagentState = {
              childTools,
              currentToolIndex: childTools.length > 0 ? childTools.length - 1 : -1,
              isComplete: true,
            };
          }
          break;
        }
      }
      return;
    }

    if (message.message?.role === 'assistant' && message.message?.content) {
      if (Array.isArray(message.message.content)) {
        let partIndex = 0;
        const nextPartMessageKey = () => {
          if (typeof message.messageKey !== 'string' || !message.messageKey) {
            return undefined;
          }

          const nextKey = partIndex === 0 ? message.messageKey : `${message.messageKey}:msg:${partIndex}`;
          partIndex += 1;
          return nextKey;
        };

        message.message.content.forEach((part: any) => {
          if (part.type === 'text') {
            let text = part.text;
            if (typeof text === 'string') {
              text = unescapeWithMathProtection(text);
            }
            if (isProviderFileUpdatePayload(text)) {
              return;
            }
            const toolUpdateMessage = toCodexToolUpdateChatMessage(
              text,
              message.timestamp || new Date().toISOString(),
              part.messageKey || nextPartMessageKey(),
              getClientRequestId(message),
              message.provider,
              getStoredOrderFields(message),
            );
            if (toolUpdateMessage) {
              converted.push(toolUpdateMessage);
              return;
            }
            converted.push(
              toCodexAssistantChatMessage(
                text,
                message.timestamp || new Date().toISOString(),
                part.messageKey || nextPartMessageKey(),
                getClientRequestId(message),
                message.message?.phase,
                message.provider,
                getStoredOrderFields(message),
              ),
            );
            return;
          }

          if (part.type === 'tool_use') {
            const toolResult = toolResults.get(part.id);
            const isSubagentContainer = part.name === 'Task' || part.name === 'Agent';

            // Build child tools from server-provided subagentTools data
            const childTools: import('../types/types').SubagentChildTool[] = [];
            if (isSubagentContainer && toolResult?.subagentTools && Array.isArray(toolResult.subagentTools)) {
              for (const tool of toolResult.subagentTools as any[]) {
                childTools.push({
                  toolId: tool.toolId,
                  toolName: tool.toolName,
                  toolInput: tool.toolInput,
                  toolResult: tool.toolResult || null,
                  timestamp: new Date(tool.timestamp || Date.now()),
                });
              }
            }

            converted.push({
              type: 'assistant',
              content: '',
              timestamp: message.timestamp || new Date().toISOString(),
              provider: message.provider,
              messageKey: part.messageKey || nextPartMessageKey(),
              clientRequestId: getClientRequestId(message),
              ...getStoredOrderFields(message),
              isToolUse: true,
              toolName: part.name,
              toolInput: normalizeToolInput(part.input),
              toolId: part.id,
              toolResult: toolResult
                ? {
                    content: normalizeToolResultContent(toolResult.content),
                    isError: toolResult.isError,
                    toolUseResult: toolResult.toolUseResult,
                  }
                : null,
              toolError: toolResult?.isError || false,
              toolResultTimestamp: toolResult?.timestamp || new Date(),
              isSubagentContainer,
              subagentState: isSubagentContainer
                ? {
                    childTools,
                    currentToolIndex: childTools.length > 0 ? childTools.length - 1 : -1,
                    isComplete: Boolean(toolResult),
                  }
                : undefined,
            });
          }
        });
        return;
      }

      if (typeof message.message.content === 'string') {
        if (isProviderFileUpdatePayload(message.message.content)) {
          return;
        }
        const toolUpdateMessage = toCodexToolUpdateChatMessage(
          message.message.content,
          message.timestamp || new Date().toISOString(),
          message.messageKey,
          getClientRequestId(message),
          message.provider,
          getStoredOrderFields(message),
        );
        if (toolUpdateMessage) {
          converted.push(toolUpdateMessage);
          return;
        }
        converted.push(
          toCodexAssistantChatMessage(
            unescapeWithMathProtection(message.message.content),
            message.timestamp || new Date().toISOString(),
            message.messageKey,
            getClientRequestId(message),
            message.message?.phase,
            message.provider,
            getStoredOrderFields(message),
          ),
        );
      }
    }
  });

  return dedupeAdjacentChatMessages(converted) as ChatMessage[];
};
