/**
 * PURPOSE: Merge persisted session transcripts with local optimistic chat
 * messages so refreshes do not hide in-flight user sends.
 */
import type { ChatMessage } from '../types/types';
import { dedupeAdjacentChatMessages } from './messageDedup';
import { getIntrinsicMessageKey } from './messageKeys';
import { convertSessionMessages } from './messageTransforms';
import { isSubagentToolCall } from '../../../../shared/subagent-tool-utils.js';
import {
  canRenderLiveRowForAcceptedTurn,
  shouldPreserveAcceptedOptimisticUser,
  shouldPreserveLiveTurnDuringEmptyReload,
} from './liveTurnMergePolicy';
import { isProviderFileUpdatePayload } from './providerPayloadParsers';

const USER_UPLOAD_NOTE_MARKER = '[User uploaded files for this message]';
const LIVE_ASSISTANT_SOURCES = new Set([
  'codex-live',
  'pi-live',
  'codex-realtime',
  'claude-realtime',
]);

type MergeSessionMessageDeltaArgs = {
  existingMessages: ChatMessage[];
  incomingRawMessages: any[];
  sessionId?: string | null;
};

/**
 * Convert only newly appended provider rows and merge them into the current UI
 * transcript without replacing existing ChatMessage object references.
 */
export function mergeSessionMessageDelta({
  existingMessages,
  incomingRawMessages,
}: MergeSessionMessageDeltaArgs): ChatMessage[] {
  /**
   * Keep long-session external append refreshes proportional to the delta size.
   * Existing UI rows are copied by reference; only unseen converted rows append.
   */
  if (!Array.isArray(incomingRawMessages) || incomingRawMessages.length === 0) {
    return existingMessages;
  }

  const incomingToolResults = collectIncomingToolResultPatches(incomingRawMessages);
  const convertedDelta = convertSessionMessages(incomingRawMessages);
  const firstDeltaIndexByKey = new Map<string, number>();
  convertedDelta.forEach((message, index) => {
    const key = getIntrinsicMessageKey(message);
    if (key && !firstDeltaIndexByKey.has(key)) {
      firstDeltaIndexByKey.set(key, index);
    }
  });
  const usedDeltaIndexes = new Set<number>();
  const filteredExistingMessages: ChatMessage[] = [];
  let didReplaceOrFilterExisting = false;
  for (const message of existingMessages) {
    const messageWithToolResult = applyIncomingToolResultPatch(message, incomingToolResults);
    if (messageWithToolResult !== message) {
      didReplaceOrFilterExisting = true;
    }

    if (messageWithToolResult.type === 'user' && messageWithToolResult.deliveryStatus) {
      const persistedUserIndex = convertedDelta.findIndex((candidate, index) => (
        !usedDeltaIndexes.has(index) &&
        isPersistedUserMessageMatch(messageWithToolResult, candidate)
      ));
      if (persistedUserIndex >= 0) {
        filteredExistingMessages.push(mergePersistedUserWithOptimistic(
          convertedDelta[persistedUserIndex],
          messageWithToolResult,
        ));
        usedDeltaIndexes.add(persistedUserIndex);
        didReplaceOrFilterExisting = true;
        continue;
      }
    }

    const key = getIntrinsicMessageKey(messageWithToolResult);
    const replacementIndex = key ? firstDeltaIndexByKey.get(key) : undefined;
    if (replacementIndex !== undefined) {
      const replacement = convertedDelta[replacementIndex];
      if (shouldKeepLiveAssistantOverPersistedPartial(messageWithToolResult, replacement)) {
        filteredExistingMessages.push(messageWithToolResult);
      } else {
        filteredExistingMessages.push(replacement);
      }
      usedDeltaIndexes.add(replacementIndex);
      didReplaceOrFilterExisting = true;
      continue;
    }

    if (
      isProviderFileUpdateLiveMessage(messageWithToolResult) ||
      isPersistedLiveAssistantDuplicate(messageWithToolResult, convertedDelta) ||
      isPersistedLiveToolDuplicate(messageWithToolResult, convertedDelta)
    ) {
      didReplaceOrFilterExisting = true;
      continue;
    }

    filteredExistingMessages.push(messageWithToolResult);
  }
  const existingKeys = new Set(
    filteredExistingMessages
      .map((message) => getIntrinsicMessageKey(message))
      .filter((value): value is string => Boolean(value)),
  );
  const appended = convertedDelta.filter((message, index) => {
    if (usedDeltaIndexes.has(index)) {
      return false;
    }
    if (isIncomingPersistedPartialCoveredByLive(message, filteredExistingMessages)) {
      return false;
    }
    const key = getIntrinsicMessageKey(message);
    if (key && existingKeys.has(key)) {
      return false;
    }
    if (key) {
      existingKeys.add(key);
    }
    return true;
  });

  if (appended.length === 0) {
    return !didReplaceOrFilterExisting
      ? existingMessages
      : dedupeAdjacentChatMessages(filteredExistingMessages) as ChatMessage[];
  }

  return dedupeAdjacentChatMessages([...filteredExistingMessages, ...appended]) as ChatMessage[];
}

/**
 * Normalize user message text so optimistic and persisted copies can be matched
 * even when whitespace changes during provider serialization.
 */
function normalizeUserMessageText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Normalize assistant text for live/persisted coverage checks. Provider live
 * rows can arrive as display text while JSONL replay keeps Markdown marks.
 */
function normalizeAssistantCoverageText(value: unknown): string {
  return normalizeUserMessageText(value)
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize tool payload values so live SDK cards can be matched against their
 * later JSONL replay even when object formatting differs.
 */
function normalizeToolPayloadText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return normalizeUserMessageText(value);
  }
  try {
    return normalizeUserMessageText(JSON.stringify(value));
  } catch {
    return normalizeUserMessageText(String(value));
  }
}

type IncomingToolResultPatch = {
  toolResult: NonNullable<ChatMessage['toolResult']>;
  subagentTools?: unknown[];
};

/**
 * Collect standalone tool_result rows that need to update an existing tool card.
 */
function collectIncomingToolResultPatches(incomingRawMessages: any[]): Map<string, IncomingToolResultPatch> {
  /**
   * Incremental refresh often receives the result row after the tool_use row was
   * already rendered from a previous live or persisted batch.
   */
  const patches = new Map<string, IncomingToolResultPatch>();
  for (const rawMessage of incomingRawMessages) {
    if (rawMessage?.type === 'tool_result') {
      const toolCallId = getIncomingToolCallId(rawMessage);
      if (!toolCallId) {
        continue;
      }
      const toolResult = buildIncomingToolResult({
        content: normalizeIncomingToolResultContent(
          rawMessage.output ?? rawMessage.content ?? rawMessage.result ?? rawMessage.toolResult,
        ),
        isError: Boolean(rawMessage.isError ?? rawMessage.error),
        timestamp: rawMessage.timestamp,
        toolUseResult: rawMessage.toolUseResult,
      });
      const patch: IncomingToolResultPatch = { toolResult };
      if (Array.isArray(rawMessage.subagentTools)) {
        patch.subagentTools = rawMessage.subagentTools;
      }
      patches.set(toolCallId, patch);
      continue;
    }

    const contentParts = Array.isArray(rawMessage?.message?.content)
      ? rawMessage.message.content
      : [];
    for (const part of contentParts) {
      if (part?.type !== 'tool_result') {
        continue;
      }
      const toolCallId = getIncomingToolCallId(part);
      if (!toolCallId) {
        continue;
      }
      const toolResult = buildIncomingToolResult({
        content: normalizeIncomingToolResultContent(part.content ?? part.output ?? part.result),
        isError: Boolean(part.is_error ?? part.isError ?? part.error),
        timestamp: rawMessage.timestamp,
        toolUseResult: rawMessage.toolUseResult,
      });
      const patch: IncomingToolResultPatch = { toolResult };
      if (Array.isArray(rawMessage.subagentTools)) {
        patch.subagentTools = rawMessage.subagentTools;
      }
      patches.set(toolCallId, patch);
    }
  }
  return patches;
}

/**
 * Build a result object while omitting undefined optional fields.
 */
function buildIncomingToolResult(input: {
  content: unknown;
  isError: boolean;
  timestamp?: unknown;
  toolUseResult?: unknown;
}): NonNullable<ChatMessage['toolResult']> {
  /**
   * Some TypeScript configs treat explicit undefined differently from an
   * omitted optional field, so only attach fields that are actually present.
   */
  const result: NonNullable<ChatMessage['toolResult']> = {
    content: input.content,
    isError: input.isError,
  };
  if (input.timestamp !== undefined) {
    result.timestamp = input.timestamp as string | number | Date;
  }
  if (input.toolUseResult !== undefined) {
    result.toolUseResult = input.toolUseResult;
  }
  return result;
}

/**
 * Resolve the provider tool call id from common Codex and Pi field names.
 */
function getIncomingToolCallId(value: Record<string, unknown> | null | undefined): string {
  /**
   * Different read models use snake_case, camelCase, or provider-native names.
   */
  const id = value?.toolCallId ?? value?.tool_use_id ?? value?.toolUseId ?? value?.call_id ?? value?.callId ?? value?.id;
  return typeof id === 'string' ? id : '';
}

/**
 * Normalize result payloads into the same displayable content shape as persisted conversion.
 */
function normalizeIncomingToolResultContent(value: unknown): string {
  /**
   * Tool outputs may arrive as strings, arrays of chunks, or structured records
   * with nested content/output fields.
   */
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeIncomingToolResultContent(item)).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const nested = record.content ?? record.output ?? record.result ?? record.stdout ?? record.stderr ?? record.text;
    if (nested !== undefined && nested !== value) {
      return normalizeIncomingToolResultContent(nested);
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Attach a standalone result patch to an existing tool card by tool id.
 */
function applyIncomingToolResultPatch(
  message: ChatMessage,
  incomingToolResults: Map<string, IncomingToolResultPatch>,
): ChatMessage {
  /**
   * Keep existing rows referentially stable unless a visible tool result changes.
   */
  if (!message.isToolUse || incomingToolResults.size === 0) {
    return message;
  }

  const toolCallId = typeof message.toolCallId === 'string'
    ? message.toolCallId
    : (typeof message.toolId === 'string' ? message.toolId : '');
  const patch = toolCallId ? incomingToolResults.get(toolCallId) : undefined;
  if (!patch) {
    return message;
  }

  const existingResult = message.toolResult;
  const existingText = existingResult && typeof existingResult === 'object'
    ? normalizeToolPayloadText((existingResult as Record<string, unknown>).content)
    : '';
  const incomingText = normalizeToolPayloadText(patch.toolResult.content);
  const existingIsError = Boolean(
    existingResult && typeof existingResult === 'object'
      ? (existingResult as Record<string, unknown>).isError
      : false,
  );
  if (existingResult && existingText === incomingText && existingIsError === Boolean(patch.toolResult.isError)) {
    return message;
  }

  const nextMessage: ChatMessage = {
    ...message,
    toolResult: patch.toolResult,
    toolError: Boolean(patch.toolResult.isError),
    toolResultTimestamp: patch.toolResult.timestamp || message.timestamp,
  };

  if (
    isSubagentToolCall(message.toolName, message.toolInput) &&
    Array.isArray(patch.subagentTools)
  ) {
    const childTools = patch.subagentTools.map((tool: any) => ({
      toolId: tool.toolId,
      toolName: tool.toolName,
      toolInput: tool.toolInput,
      toolResult: tool.toolResult || null,
      timestamp: new Date(tool.timestamp || patch.toolResult.timestamp || Date.now()),
    }));
    nextMessage.isSubagentContainer = true;
    nextMessage.subagentState = {
      childTools,
      currentToolIndex: childTools.length > 0 ? childTools.length - 1 : -1,
      isComplete: true,
    };
  }

  return nextMessage;
}

/**
 * Extract visible tool result text from the chat message shape.
 */
function getToolResultText(message: ChatMessage): string {
  const result = message.toolResult;
  if (!result || typeof result !== 'object') {
    return '';
  }

  return normalizeToolPayloadText((result as Record<string, unknown>).content);
}

/**
 * Classify a UI chat row into the stable view kind used for overlay coverage.
 */
function getViewMessageKind(message: ChatMessage): 'user_text' | 'assistant_text' | 'thinking' | 'tool_use' | 'tool_result' | 'other' {
  if (message.type === 'user') {
    return 'user_text';
  }

  if (message.type !== 'assistant') {
    return 'other';
  }

  if (message.isToolUse) {
    return getToolResultText(message) ? 'tool_result' : 'tool_use';
  }

  if (message.isThinking) {
    return 'thinking';
  }

  return 'assistant_text';
}

/**
 * Collect anchor identities that may be recorded before UI key decoration.
 */
function getTurnAnchorCandidateKeys(message: ChatMessage): string[] {
  return [
    typeof message.turnAnchorKey === 'string' ? message.turnAnchorKey : null,
    getIntrinsicMessageKey(message),
    typeof message.messageKey === 'string' ? message.messageKey : null,
  ].filter((value): value is string => Boolean(value));
}

/**
 * Collect active-turn identities that live rows can share with their user row.
 */
function getLiveTurnIdentityKeys(message: ChatMessage): string[] {
  return [
    typeof message.turnAnchorKey === 'string' ? message.turnAnchorKey : null,
    typeof message.clientRequestId === 'string' ? message.clientRequestId : null,
    typeof message.requestId === 'string' ? message.requestId : null,
  ].filter((value): value is string => Boolean(value));
}

/**
 * Detect local user rows that have been accepted by the send path but have not
 * yet been replaced by the authoritative transcript row.
 */
function getAnchoredTurnInsertIndex(messages: ChatMessage[], anchorIndex: number): number {
  /**
   * Insert a follow-up after the whole anchored turn.  If the anchor resolves
   * to the prior user row, anchorIndex + 1 would split that user from its
   * assistant reply.
   */
  let insertIndex = anchorIndex + 1;
  while (insertIndex < messages.length && messages[insertIndex].type !== 'user') {
    insertIndex += 1;
  }
  return insertIndex;
}

/**
 * Drop provider bookkeeping rows that slipped into live state before persisted
 * history catches up; JSONL intentionally has no matching visible row.
 */
function isProviderFileUpdateLiveMessage(message: ChatMessage): boolean {
  if (
    message.type !== 'assistant' ||
    !LIVE_ASSISTANT_SOURCES.has(String(message.source || ''))
  ) {
    return false;
  }

  return isProviderFileUpdatePayload(message.content ?? message.displayText);
}

/**
 * Check whether the persisted user text confirms the optimistic send text.
 */
function isPersistedUserTextMatch(optimisticContent: string, persistedContent: string): boolean {
  if (!optimisticContent || !persistedContent) {
    return false;
  }

  if (optimisticContent === persistedContent) {
    return true;
  }

  return persistedContent.startsWith(`${optimisticContent} ${USER_UPLOAD_NOTE_MARKER}`);
}

/**
 * Match upload-only sends when the provider transcript only has the file note.
 */
function isPersistedAttachmentNoteMatch(optimisticMessage: ChatMessage, persistedContent: string): boolean {
  if (!persistedContent.includes(USER_UPLOAD_NOTE_MARKER) || !Array.isArray(optimisticMessage.attachments)) {
    return false;
  }

  const attachmentPaths = optimisticMessage.attachments
    .map((attachment) => {
      const attachmentRecord = attachment && typeof attachment === 'object'
        ? attachment as unknown as Record<string, unknown>
        : {};
      return normalizeUserMessageText(attachmentRecord.absolutePath)
        || normalizeUserMessageText(attachmentRecord.relativePath)
        || normalizeUserMessageText(attachmentRecord.name);
    })
    .filter(Boolean);

  return attachmentPaths.length > 0
    && attachmentPaths.every((attachmentPath) => persistedContent.includes(attachmentPath));
}

/**
 * Detect stale local user bubbles that contain only provider-facing upload notes.
 */
function isUploadNoteOnlyUserMessage(message: ChatMessage): boolean {
  if (message.type !== 'user') {
    return false;
  }

  const content = typeof message.content === 'string' ? message.content : '';
  const markerIndex = content.indexOf(USER_UPLOAD_NOTE_MARKER);
  if (markerIndex < 0) {
    return false;
  }

  const visibleText = content.slice(0, markerIndex).trim();
  const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
  return !visibleText && !hasAttachments;
}

/**
 * Collect stable request identities before falling back to lossy text matching.
 */
function getReliableUserMessageIdentities(message: ChatMessage): string[] {
  return [
    message.clientRequestId,
    message.requestId,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

/**
 * Decide whether reliable request identities prove same-send or different-send.
 */
function getReliableIdentityMatch(
  optimisticMessage: ChatMessage,
  persistedMessage: ChatMessage,
): boolean | null {
  const optimisticIdentities = getReliableUserMessageIdentities(optimisticMessage);
  const persistedIdentities = getReliableUserMessageIdentities(persistedMessage);
  if (optimisticIdentities.length === 0 || persistedIdentities.length === 0) {
    return null;
  }

  const persistedIdentitySet = new Set(persistedIdentities);
  return optimisticIdentities.some((identity) => persistedIdentitySet.has(identity));
}

/**
 * Check whether a persisted transcript entry confirms an optimistic user send.
 */
function isPersistedUserMessageMatch(optimisticMessage: ChatMessage, persistedMessage: ChatMessage): boolean {
  if (optimisticMessage.type !== 'user' || persistedMessage.type !== 'user') {
    return false;
  }

  const identityMatch = getReliableIdentityMatch(optimisticMessage, persistedMessage);
  if (identityMatch !== null) {
    return identityMatch;
  }

  const persistedContent = normalizeUserMessageText(persistedMessage.content);
  const optimisticContents = [
    optimisticMessage.content,
    optimisticMessage.submittedContent,
  ].map(normalizeUserMessageText).filter(Boolean);

  return optimisticContents.some((optimisticContent) => (
    isPersistedUserTextMatch(optimisticContent, persistedContent)
  )) || isPersistedAttachmentNoteMatch(optimisticMessage, persistedContent);
}

/**
 * Replace a local accepted user row with the authoritative persisted echo while
 * keeping client-only display fields that may not be present in provider JSONL.
 */
function mergePersistedUserWithOptimistic(persistedMessage: ChatMessage, optimisticMessage: ChatMessage): ChatMessage {
  const optimisticAttachments = Array.isArray(optimisticMessage.attachments)
    && optimisticMessage.attachments.length > 0
    ? optimisticMessage.attachments
    : undefined;
  const optimisticContent = typeof optimisticMessage.submittedContent === 'string'
    ? optimisticMessage.submittedContent
    : (typeof optimisticMessage.content === 'string' ? optimisticMessage.content : '');

  return {
    ...persistedMessage,
    clientRequestId: optimisticMessage.clientRequestId || persistedMessage.clientRequestId,
    content: optimisticContent || persistedMessage.content,
    submittedContent: optimisticMessage.submittedContent || persistedMessage.submittedContent,
    attachments: optimisticAttachments || persistedMessage.attachments,
    deliveryStatus: 'persisted',
  };
}

/**
 * Keep local realtime messages visible while the persisted history catches up.
 */
function shouldPreserveLocalMessage(message: ChatMessage): boolean {
  if (message.type === 'user') {
    if (isUploadNoteOnlyUserMessage(message)) {
      return false;
    }
    return shouldPreserveLiveTurnDuringEmptyReload(message);
  }

  return shouldPreserveLiveTurnDuringEmptyReload(message);
}

/**
 * Identify Codex realtime assistant rows that belong to a user turn still
 * waiting for its authoritative persisted echo.
 */
function isCodexLiveAssistantAwaitingPersistedUser(
  message: ChatMessage,
  previousMessages: ChatMessage[],
  mergedMessages: ChatMessage[],
): boolean {
  if (
    !canRenderLiveRowForAcceptedTurn(message) ||
    (message.source !== 'codex-live' && message.source !== 'codex-realtime')
  ) {
    return false;
  }

  const turnIdentityKeys = getLiveTurnIdentityKeys(message);
  if (turnIdentityKeys.length === 0) {
    return false;
  }

  const hasSentUserForTurn = previousMessages.some((candidate) => (
    candidate.type === 'user' &&
    candidate.deliveryStatus === 'sent' &&
    getLiveTurnIdentityKeys(candidate).some((identity) => turnIdentityKeys.includes(identity))
  ));
  if (!hasSentUserForTurn) {
    return false;
  }

  return !mergedMessages.some((candidate) => (
    candidate.type === 'user' &&
    candidate.deliveryStatus === 'persisted' &&
    getLiveTurnIdentityKeys(candidate).some((identity) => turnIdentityKeys.includes(identity))
  ));
}

/**
 * Check whether a local realtime assistant bubble has already been confirmed by
 * the persisted transcript, even when JSONL and WS identities differ.
 */
function isPersistedLiveAssistantDuplicate(
  localMessage: ChatMessage,
  persistedMessages: ChatMessage[],
): boolean {
  if (
    localMessage.type !== 'assistant' ||
    getViewMessageKind(localMessage) !== 'assistant_text' ||
    !LIVE_ASSISTANT_SOURCES.has(String(localMessage.source || ''))
  ) {
    return false;
  }

  const localContent = normalizeAssistantCoverageText(localMessage.content);
  if (!localContent) {
    return false;
  }

  return persistedMessages.some((persistedMessage) => (
    persistedMessage.type === 'assistant' &&
    getViewMessageKind(persistedMessage) === 'assistant_text' &&
    isLiveAssistantContentCoveredByPersistedText(
      localContent,
      normalizeAssistantCoverageText(persistedMessage.content),
    )
  ));
}

/**
 * Check whether a local realtime thinking row has already been replayed from
 * persisted provider history.
 */
function isPersistedLiveThinkingDuplicate(
  localMessage: ChatMessage,
  persistedMessages: ChatMessage[],
): boolean {
  if (
    localMessage.type !== 'assistant' ||
    !localMessage.isThinking ||
    !LIVE_ASSISTANT_SOURCES.has(String(localMessage.source || ''))
  ) {
    return false;
  }

  const localContent = normalizeAssistantCoverageText(localMessage.content);
  if (!localContent) {
    return false;
  }

  return persistedMessages.some((persistedMessage) => (
    persistedMessage.type === 'assistant' &&
    persistedMessage.isThinking &&
    isLiveAssistantContentCoveredByPersistedText(
      localContent,
      normalizeAssistantCoverageText(persistedMessage.content),
    )
  ));
}

/**
 * Prefer the richer WS live draft while a follow-latest refresh returns only a
 * short JSONL assistant partial for the same turn.
 */
function shouldKeepLiveAssistantOverPersistedPartial(
  localMessage: ChatMessage,
  incomingMessage: ChatMessage,
): boolean {
  if (
    localMessage.type !== 'assistant' ||
    incomingMessage.type !== 'assistant' ||
    getViewMessageKind(localMessage) !== 'assistant_text' ||
    getViewMessageKind(incomingMessage) !== 'assistant_text' ||
    !LIVE_ASSISTANT_SOURCES.has(String(localMessage.source || ''))
  ) {
    return false;
  }

  const liveContent = normalizeAssistantCoverageText(localMessage.content);
  const incomingContent = normalizeAssistantCoverageText(incomingMessage.content);
  if (!liveContent || !incomingContent || incomingContent.length >= liveContent.length) {
    return false;
  }

  return liveContent.startsWith(incomingContent);
}

/**
 * Delta appends can contain a new persisted row with a different key from the
 * active live overlay.  If it is only a prefix already shown by live text, drop
 * the persisted partial and wait for a converged final row.
 */
function isIncomingPersistedPartialCoveredByLive(
  incomingMessage: ChatMessage,
  existingMessages: ChatMessage[],
): boolean {
  if (
    incomingMessage.type !== 'assistant' ||
    getViewMessageKind(incomingMessage) !== 'assistant_text' ||
    LIVE_ASSISTANT_SOURCES.has(String(incomingMessage.source || ''))
  ) {
    return false;
  }

  return existingMessages.some((existingMessage) => (
    shouldKeepLiveAssistantOverPersistedPartial(existingMessage, incomingMessage)
  ));
}

const MIN_PARTIAL_LIVE_ASSISTANT_COVERAGE_LENGTH = 12;

/**
 * Detect whether a persisted assistant row supersedes a live text row from the
 * same provider item after JSONL/read-model refresh.
 */
function isLiveAssistantContentCoveredByPersistedText(
  localContent: string,
  persistedContent: string,
): boolean {
  if (!localContent || !persistedContent) {
    return false;
  }

  if (persistedContent === localContent) {
    return true;
  }

  const shortestLength = Math.min(localContent.length, persistedContent.length);
  if (shortestLength < MIN_PARTIAL_LIVE_ASSISTANT_COVERAGE_LENGTH) {
    return false;
  }

  return persistedContent.startsWith(localContent) || localContent.startsWith(persistedContent);
}

/**
 * Check whether a local realtime tool card has already been replayed from JSONL.
 */
function isPersistedLiveToolDuplicate(
  localMessage: ChatMessage,
  persistedMessages: ChatMessage[],
): boolean {
  if (
    localMessage.type !== 'assistant' ||
    !localMessage.isToolUse ||
    !LIVE_ASSISTANT_SOURCES.has(String(localMessage.source || ''))
  ) {
    return false;
  }

  const localToolId = normalizeToolPayloadText(localMessage.toolCallId || localMessage.toolId);
  const localName = normalizeToolPayloadText(localMessage.toolName);
  const localInput = normalizeToolPayloadText(localMessage.toolInput);
  const localResult = getToolResultText(localMessage);

  return persistedMessages.some((persistedMessage) => {
    if (persistedMessage.type !== 'assistant' || !persistedMessage.isToolUse) {
      return false;
    }

    const persistedToolId = normalizeToolPayloadText(persistedMessage.toolCallId || persistedMessage.toolId);
    const sameToolIdentity = Boolean(localToolId && persistedToolId && localToolId === persistedToolId)
      || (
        localName.length > 0 &&
        localName === normalizeToolPayloadText(persistedMessage.toolName) &&
        localInput === normalizeToolPayloadText(persistedMessage.toolInput)
      );

    if (!sameToolIdentity) {
      return false;
    }

    const persistedResult = getToolResultText(persistedMessage);
    return !localResult || Boolean(persistedResult);
  });
}

/**
 * Decide whether one live row is covered by a same-kind persisted replay row.
 */
function isPersistedLiveDuplicate(
  localMessage: ChatMessage,
  persistedMessages: ChatMessage[],
): boolean {
  return isPersistedLiveAssistantDuplicate(localMessage, persistedMessages)
    || isPersistedLiveThinkingDuplicate(localMessage, persistedMessages)
    || isPersistedLiveToolDuplicate(localMessage, persistedMessages);
}

/**
 * Decide whether one live row from a matched turn is superseded by the current
 * persisted rows for that same turn.
 */
function shouldCoverLiveRowFromPersistedTurn(
  localMessage: ChatMessage,
  persistedTurnMessages: ChatMessage[],
): boolean {
  /**
   * Assistant text is a final-answer draft, so any persisted assistant text in
   * the same turn owns it. Thinking and tool rows are separate visible
   * artifacts and require same-kind persisted coverage.
   */
  if (
    localMessage.type === 'assistant' &&
    getViewMessageKind(localMessage) === 'assistant_text' &&
    LIVE_ASSISTANT_SOURCES.has(String(localMessage.source || ''))
  ) {
    return persistedTurnMessages.some((message) => (
      message.type === 'assistant' &&
      getViewMessageKind(message) === 'assistant_text' &&
      Boolean(normalizeAssistantCoverageText(message.content))
    ));
  }

  return isPersistedLiveDuplicate(localMessage, persistedTurnMessages);
}

/**
 * Decide whether a late live row from an already-persisted owner turn is stale.
 */
function shouldCoverLateLiveRowFromPersistedTurn(
  localMessage: ChatMessage,
  persistedMessages: ChatMessage[],
): boolean {
  if (
    localMessage.type === 'assistant' &&
    getViewMessageKind(localMessage) === 'assistant_text' &&
    LIVE_ASSISTANT_SOURCES.has(String(localMessage.source || ''))
  ) {
    return true;
  }

  return isPersistedLiveDuplicate(localMessage, persistedMessages);
}

/** Session-scoped store of converged live message keys so late-arriving
 * WS events re-inserting an already-converged item can be caught across
 * merge calls without leaking keys between different sessions. */
const convergedLiveKeysBySession = new Map<string, Set<string>>();

function getSessionConvergedLiveKeys(sessionId: string): Set<string> {
  let keys = convergedLiveKeysBySession.get(sessionId);
  if (!keys) {
    keys = new Set<string>();
    convergedLiveKeysBySession.set(sessionId, keys);
  }
  return keys;
}

interface MessageMergeOptions {
  preservePreviousMessages?: boolean;
  /**
   * When provided, the merge function looks up (or creates) a session-scoped
   * set of already-converged live-assistant message keys so that
   * late-arriving WS events re-inserting the same item at a different
   * position can still be recognised as stale duplicates — without leaking
   * keys between different sessions.
   */
  sessionId?: string | null;
}

/**
 * Convert a stored timestamp into a comparable value without inventing a fresh
 * historical time for rows that do not carry one.
 */
function getStoredTimestampMs(value: unknown): number | null {
  const timestamp = new Date(value as string | number | Date).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Parse provider line order from generated Codex message keys.
 */
function getCodexMessageKeyOrder(messageKey: unknown): number | null {
  if (typeof messageKey !== 'string') {
    return null;
  }
  const match = messageKey.match(/:line:(\d+):msg:(\d+)$/);
  if (!match) {
    return null;
  }
  const lineNumber = Number(match[1]);
  const subIndex = Number(match[2]);
  return Number.isFinite(lineNumber) && Number.isFinite(subIndex)
    ? (lineNumber * 1000) + subIndex
    : null;
}

/**
 * Rank transcript rows inside the same turn so a persisted user echo cannot be
 * displayed after its assistant answer when the read model arrives out of order.
 */
function getTranscriptRoleRank(message: ChatMessage): number {
  if (message.type === 'user') {
    return 0;
  }
  if (message.type === 'assistant') {
    return 1;
  }
  return 2;
}

/**
 * Resolve turn identity fields that can be shared across rows in one turn.
 * Assistant-only message keys are row identities, not turn identities.
 */
function getPersistedReliableTurnSortKey(message: ChatMessage): string {
  const candidates = [
    message.turnId,
    message.turnAnchorKey,
    message.clientRequestId,
    message.requestId,
    message.type === 'user' ? message.messageKey : undefined,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.length > 0);
  return typeof value === 'string' ? value : '';
}

/**
 * Collect stable persisted ordering fields in business-priority order.
 */
function getPersistedSortKey(message: ChatMessage, index: number): {
  timestampMs: number | null;
  turnKey: string;
  inferredTurnKey: string;
  roleRank: number;
  sequence: number | null;
  rowid: number | null;
  providerOrder: number | null;
  index: number;
} {
  const sequence = typeof message.sequence === 'number' || typeof message.sequence === 'string'
    ? Number(message.sequence)
    : null;
  const rowid = typeof message.rowid === 'number' || typeof message.rowid === 'string'
    ? Number(message.rowid)
    : null;
  return {
    timestampMs: getStoredTimestampMs(message.timestamp),
    turnKey: getPersistedReliableTurnSortKey(message),
    inferredTurnKey: '',
    roleRank: getTranscriptRoleRank(message),
    sequence: Number.isFinite(sequence) ? sequence : null,
    rowid: Number.isFinite(rowid) ? rowid : null,
    providerOrder: getCodexMessageKeyOrder(message.messageKey),
    index,
  };
}

type PersistedSortEntry = {
  message: ChatMessage;
  sortKey: ReturnType<typeof getPersistedSortKey>;
};

function findDisplayMessageIndex(displayMessages: ChatMessage[], candidate: ChatMessage): number {
  /**
   * PURPOSE: Locate a row from the previous visible frame after a partial
   * persisted refresh so unmatched rows can stay near their original turn.
   */
  const candidateKey = getIntrinsicMessageKey(candidate);
  if (candidateKey) {
    const keyedIndex = displayMessages.findIndex((message) => getIntrinsicMessageKey(message) === candidateKey);
    if (keyedIndex >= 0) {
      return keyedIndex;
    }
  }

  const candidateKind = getViewMessageKind(candidate);
  const candidateContent = normalizeUserMessageText(candidate.content || candidate.displayText || candidate.toolName);
  const candidateTimestamp = getStoredTimestampMs(candidate.timestamp);
  if (!candidateContent || candidateTimestamp === null) {
    return -1;
  }

  return displayMessages.findIndex((message) => (
    getViewMessageKind(message) === candidateKind
    && normalizeUserMessageText(message.content || message.displayText || message.toolName) === candidateContent
    && getStoredTimestampMs(message.timestamp) === candidateTimestamp
  ));
}

function findFollowingDisplayIndex(
  displayMessages: ChatMessage[],
  previousMessages: ChatMessage[],
  previousIndex: number,
  endIndex: number = previousMessages.length,
): number {
  /**
   * PURPOSE: Anchor an unmatched local row before the next row from the same
   * previous transcript frame that survived the persisted reload.
   */
  for (let index = previousIndex + 1; index < endIndex; index += 1) {
    const displayIndex = findDisplayMessageIndex(displayMessages, previousMessages[index]);
    if (displayIndex >= 0) {
      return displayIndex;
    }
  }
  return -1;
}

/**
 * Build the primary persisted order bucket used before turn reconstruction.
 */
function getPersistedOrderBucketKey(sortKey: ReturnType<typeof getPersistedSortKey>): string {
  return [
    sortKey.sequence ?? '',
    sortKey.rowid ?? '',
    sortKey.providerOrder ?? '',
    sortKey.timestampMs ?? '',
  ].join('\u0000');
}

/**
 * Infer missing assistant turn keys inside one persisted ordering bucket from
 * the ordinal user turns already present in that bucket.
 */
function inferAssistantTurnKeys(entries: PersistedSortEntry[]): void {
  const orderedEntries = [...entries].sort((left, right) => {
    if (left.sortKey.providerOrder !== null && right.sortKey.providerOrder !== null && left.sortKey.providerOrder !== right.sortKey.providerOrder) {
      return left.sortKey.providerOrder - right.sortKey.providerOrder;
    }
    return left.sortKey.index - right.sortKey.index;
  });
  const userTurnKeys = orderedEntries
    .filter(({ message, sortKey }) => message.type === 'user' && sortKey.turnKey)
    .map(({ sortKey }) => sortKey.turnKey);
  if (userTurnKeys.length === 0) {
    return;
  }

  let assistantIndex = 0;
  for (const entry of orderedEntries) {
    if (entry.message.type !== 'assistant' || entry.sortKey.turnKey) {
      continue;
    }
    entry.sortKey.inferredTurnKey = userTurnKeys[assistantIndex] || '';
    if (getViewMessageKind(entry.message) === 'assistant_text') {
      assistantIndex += 1;
    }
  }
}

/**
 * Infer assistant turn ownership only among rows that share the same persisted
 * storage-order fields.
 */
function inferPersistedTurnKeys(entries: PersistedSortEntry[]): void {
  const buckets = new Map<string, PersistedSortEntry[]>();
  for (const entry of entries) {
    const bucketKey = getPersistedOrderBucketKey(entry.sortKey);
    const bucket = buckets.get(bucketKey);
    if (bucket) {
      bucket.push(entry);
    } else {
      buckets.set(bucketKey, [entry]);
    }
  }
  buckets.forEach(inferAssistantTurnKeys);
}

/**
 * Stabilize persisted history before overlaying optimistic/live rows.
 */
function sortPersistedMessages(messages: ChatMessage[]): ChatMessage[] {
  const entries = messages
    .map((message, index) => ({ message, sortKey: getPersistedSortKey(message, index) }));
  inferPersistedTurnKeys(entries);

  return entries
    .sort((left, right) => {
      if (left.sortKey.sequence !== null && right.sortKey.sequence !== null && left.sortKey.sequence !== right.sortKey.sequence) {
        return left.sortKey.sequence - right.sortKey.sequence;
      }
      if (left.sortKey.rowid !== null && right.sortKey.rowid !== null && left.sortKey.rowid !== right.sortKey.rowid) {
        return left.sortKey.rowid - right.sortKey.rowid;
      }
      if (left.sortKey.timestampMs !== null && right.sortKey.timestampMs !== null && left.sortKey.timestampMs !== right.sortKey.timestampMs) {
        return left.sortKey.timestampMs - right.sortKey.timestampMs;
      }
      if (left.sortKey.providerOrder !== null && right.sortKey.providerOrder !== null && left.sortKey.providerOrder !== right.sortKey.providerOrder) {
        return left.sortKey.providerOrder - right.sortKey.providerOrder;
      }
      const leftTurnKey = left.sortKey.turnKey || left.sortKey.inferredTurnKey;
      const rightTurnKey = right.sortKey.turnKey || right.sortKey.inferredTurnKey;
      if (leftTurnKey && rightTurnKey && leftTurnKey !== rightTurnKey) {
        return leftTurnKey.localeCompare(rightTurnKey);
      }
      if (left.sortKey.roleRank !== right.sortKey.roleRank) {
        return left.sortKey.roleRank - right.sortKey.roleRank;
      }
      if (leftTurnKey !== rightTurnKey) {
        return leftTurnKey.localeCompare(rightTurnKey);
      }
      return left.sortKey.index - right.sortKey.index;
    })
    .map(({ message }) => message);
}

function isAuthoritativeJsonlMessage(message: ChatMessage): boolean {
  return typeof message.messageKey === 'string' && message.messageKey.includes(':line:');
}

function shouldReplacePersistedAssistantDuplicate(existing: ChatMessage, incoming: ChatMessage): boolean {
  const existingIsJsonl = isAuthoritativeJsonlMessage(existing);
  const incomingIsJsonl = isAuthoritativeJsonlMessage(incoming);
  if (incomingIsJsonl !== existingIsJsonl) {
    return incomingIsJsonl;
  }

  return normalizeUserMessageText(incoming.content).length >= normalizeUserMessageText(existing.content).length;
}

/**
 * Remove duplicate assistant text rows that already entered persisted history
 * from both live overlay storage and authoritative JSONL replay.
 */
function dedupePersistedAssistantTextWithinTurns(messages: ChatMessage[]): ChatMessage[] {
  const deduped: ChatMessage[] = [];
  const assistantIndexByCoverage = new Map<string, number>();

  const resetTurnCoverage = () => {
    assistantIndexByCoverage.clear();
  };

  for (const message of messages) {
    if (message.type === 'user') {
      resetTurnCoverage();
      deduped.push(message);
      continue;
    }

    if (message.type !== 'assistant' || getViewMessageKind(message) !== 'assistant_text') {
      deduped.push(message);
      continue;
    }

    const coverageText = normalizeAssistantCoverageText(message.content);
    if (!coverageText) {
      deduped.push(message);
      continue;
    }

    const existingIndex = assistantIndexByCoverage.get(coverageText);
    if (existingIndex === undefined) {
      assistantIndexByCoverage.set(coverageText, deduped.length);
      deduped.push(message);
      continue;
    }

    if (shouldReplacePersistedAssistantDuplicate(deduped[existingIndex], message)) {
      deduped[existingIndex] = message;
    }
  }

  return deduped;
}

/**
 * Merge persisted history with local in-flight messages from the same session.
 */
export function mergePersistedAndOptimisticMessages(
  persistedMessages: ChatMessage[],
  previousMessages: ChatMessage[],
  options: MessageMergeOptions = {},
): ChatMessage[] {
  const { preservePreviousMessages = true, sessionId } = options;
  const crossCallConvergedLiveKeys: Set<string> | undefined =
    sessionId ? getSessionConvergedLiveKeys(sessionId) : undefined;
  const mergedMessages = dedupePersistedAssistantTextWithinTurns(sortPersistedMessages(persistedMessages));
  const matchedPersistedIndexes = new Set<number>();

  /**
   * When a local user send is confirmed by a persisted row, the live
   * assistant(s) that follow it in the same turn are superseded by the
   * persisted transcript — even when the exact text differs after provider
   * finalisation.  Track which local indices are covered so they are not
   * re-appended.
   */
  const coveredLocalIndexes = new Set<number>();

  // Track intrinsic message keys of live assistants that have already been
  // covered so late-arriving WS duplicates at different positions can be
  // caught by identity rather than relying solely on turn-boundary position.
  const convergedMessageKeys = new Set<string>();

  // Track which users were matched AND already have at least one persisted
  // assistant so later we can identify stale live assistants from those turns.
  const usersWithPersistedAssistantsPrevIndexes = new Set<number>();

  // Collect unmatched local messages with their original previous-frame
  // index so we can preserve relative ordering across user and live types.
  const unmatchedLocalMessages: { message: ChatMessage; previousIndex: number }[] = [];

  previousMessages
    .filter((message) => message.type === 'user' && message.deliveryStatus)
    .forEach((optimisticMessage) => {
      const previousIndex = previousMessages.indexOf(optimisticMessage);
      let matchIndex = -1;
      for (let index = mergedMessages.length - 1; index >= 0; index -= 1) {
        if (
          !matchedPersistedIndexes.has(index)
          && isPersistedUserMessageMatch(optimisticMessage, mergedMessages[index])
        ) {
          matchIndex = index;
          break;
        }
      }

      if (matchIndex >= 0) {
        matchedPersistedIndexes.add(matchIndex);
        mergedMessages[matchIndex] = mergePersistedUserWithOptimistic(
          mergedMessages[matchIndex],
          optimisticMessage,
        );

        // When the read model already carries an assistant reply for this
        // turn, the live assistant rows that follow this user in the
        // previous frame represent the same turn content and must not be
        // re-appended alongside the persisted version.
        // Empty persisted text assistants represent read-model lag and must
        // not count as converged. Tool cards can have empty text content
        // while still being the authoritative replay row.
        let persistedTurnMessageCount = 0;
        for (let searchIdx = matchIndex + 1; searchIdx < mergedMessages.length; searchIdx += 1) {
          if (mergedMessages[searchIdx].type === 'user') break;
          if (
            mergedMessages[searchIdx].type === 'assistant' &&
            (mergedMessages[searchIdx].content || mergedMessages[searchIdx].isToolUse)
          ) {
            persistedTurnMessageCount += 1;
          }
        }

        if (persistedTurnMessageCount > 0) {
          usersWithPersistedAssistantsPrevIndexes.add(previousIndex);
          const persistedTurnMessages = mergedMessages.slice(matchIndex + 1);
          const nextPersistedUserIdx = persistedTurnMessages.findIndex((candidate) => candidate.type === 'user');
          const persistedTurnWindow = nextPersistedUserIdx >= 0
            ? persistedTurnMessages.slice(0, nextPersistedUserIdx)
            : persistedTurnMessages;
          // Cover assistant text once the final persisted answer owns the turn,
          // but require same-kind persisted coverage for Pi thinking/tool rows.
          // A lagging read model may replay the final assistant text before it
          // has replayed Pi thinking/tool rows, and those live rows must stay
          // visible until their own persisted rows arrive.
          const nextUserIdx = previousMessages.findIndex(
            (m, i) => i > previousIndex && m.type === 'user',
          );
          const turnEnd = nextUserIdx > previousIndex ? nextUserIdx : previousMessages.length;
          for (let index = previousIndex + 1; index < turnEnd; index += 1) {
            const turnMessage = previousMessages[index];
            if (
              turnMessage.type === 'assistant'
              && LIVE_ASSISTANT_SOURCES.has(String(turnMessage.source || ''))
              && shouldCoverLiveRowFromPersistedTurn(turnMessage, persistedTurnWindow)
            ) {
              coveredLocalIndexes.add(index);
              const turnKey = getIntrinsicMessageKey(turnMessage);
              if (turnKey) {
                convergedMessageKeys.add(turnKey);
                crossCallConvergedLiveKeys?.add(turnKey);
              }
            }
          }
        } else {
          // Empty persisted assistants represent read-model lag — remove
          // them from mergedMessages so they don't display as ghost bubbles
          // alongside the non-empty live draft that will be appended.
          let removeIdx = matchIndex + 1;
          while (removeIdx < mergedMessages.length && mergedMessages[removeIdx].type !== 'user') {
            if (
              mergedMessages[removeIdx].type === 'assistant' &&
              !mergedMessages[removeIdx].content &&
              !mergedMessages[removeIdx].isToolUse
            ) {
              mergedMessages.splice(removeIdx, 1);
            } else {
              removeIdx += 1;
            }
          }
        }
        return;
      }

      if (
        !preservePreviousMessages
        || isUploadNoteOnlyUserMessage(optimisticMessage)
      ) {
        return;
      }

      unmatchedLocalMessages.push({ message: optimisticMessage, previousIndex });
    });

  /**
   * After turn-boundary coverage, handle late-arriving WS events that
   * re-insert a live assistant outside its original turn (e.g. after a merge
   * pass already removed the in-boundary copy).
   *
   * Each live assistant belongs to the closest preceding user with
   * deliveryStatus.  If that user was already matched AND its turn already
   * carries persisted assistants, this live row is a stale duplicate from an
   * already-resolved turn and must be covered.  Otherwise (unmatched user, or
   * matched user whose read model has not yet caught up) the live row is the
   * canonical source for its turn and must be kept.
   */
  {
    // Build owning-user lookup: for each index, track the closest preceding
    // user with deliveryStatus (or -1 for orphan live rows).
    const owningUserIndex = new Array(previousMessages.length).fill(-1);
    let lastUserIdx = -1;
    for (let i = 0; i < previousMessages.length; i += 1) {
      if (previousMessages[i].type === 'user' && previousMessages[i].deliveryStatus) {
        lastUserIdx = i;
      }
      owningUserIndex[i] = lastUserIdx;
    }

    for (let index = 0; index < previousMessages.length; index += 1) {
      const message = previousMessages[index];
      if (
        message.type !== 'assistant'
        || !LIVE_ASSISTANT_SOURCES.has(String(message.source || ''))
        || coveredLocalIndexes.has(index)
      ) {
        continue;
      }

      // Before checking positional ownership, catch any live assistant
      // whose intrinsic identity was already converged — either by the
      // current merge pass or by a previous merge call (e.g. a
      // late-arriving WS event re-inserting an already-converged item at
      // a different position).
      const messageKey = getIntrinsicMessageKey(message);
      if (messageKey && (
        convergedMessageKeys.has(messageKey)
        || crossCallConvergedLiveKeys?.has(messageKey)
      )) {
        coveredLocalIndexes.add(index);
        continue;
      }

      const ownerIdx = owningUserIndex[index];
      if (ownerIdx < 0) {
        // Orphan live assistant with no owning user.  Only cover it when
        // at least one user with deliveryStatus exists — otherwise the
        // live content is the canonical source before any user is persisted.
        if (lastUserIdx >= 0) {
          coveredLocalIndexes.add(index);
          if (messageKey) {
            convergedMessageKeys.add(messageKey);
            crossCallConvergedLiveKeys?.add(messageKey);
          }
        }
        continue;
      }

      if (
        usersWithPersistedAssistantsPrevIndexes.has(ownerIdx) &&
        shouldCoverLateLiveRowFromPersistedTurn(message, persistedMessages)
      ) {
        // The owning user's turn already has persisted state that supersedes
        // this live row, so a late duplicate should not be reinserted.
        coveredLocalIndexes.add(index);
        if (messageKey) {
          convergedMessageKeys.add(messageKey);
          crossCallConvergedLiveKeys?.add(messageKey);
        }
      }
    }
  }

  const persistedKeys = new Set(
    persistedMessages.map((m) => getIntrinsicMessageKey(m)).filter((k): k is string => Boolean(k)),
  );

  previousMessages.forEach((message, previousIndex) => {
    if (message.type === 'user' && message.deliveryStatus) {
      return;
    }

    if (!preservePreviousMessages || !shouldPreserveLocalMessage(message)) {
      return;
    }

    if (coveredLocalIndexes.has(previousIndex)) {
      return;
    }

    if (isCodexLiveAssistantAwaitingPersistedUser(message, previousMessages, mergedMessages)) {
      return;
    }

    if (isProviderFileUpdateLiveMessage(message)) {
      return;
    }

    if (
      isPersistedLiveDuplicate(message, persistedMessages)
    ) {
      return;
    }

    const key = getIntrinsicMessageKey(message);
    if (key && persistedKeys.has(key)) {
      return;
    }

    unmatchedLocalMessages.push({ message, previousIndex });
  });

  // Preserve relative order from the previous frame by sorting unmatched
  // local messages by their original position before anchored insertion.
  unmatchedLocalMessages.sort((a, z) => a.previousIndex - z.previousIndex);
  const displayMessages = [...mergedMessages];
  const anchorInsertPositions = new Map<string, number>();
  const anchorsWithUnmatchedUsers = new Set(
    unmatchedLocalMessages
      .filter(({ message }) => message.type === 'user' && typeof message.turnAnchorKey === 'string')
      .map(({ message }) => message.turnAnchorKey as string),
  );
  for (const { message, previousIndex } of unmatchedLocalMessages) {
    const anchorKey = typeof message.turnAnchorKey === 'string' ? message.turnAnchorKey : '';
    if (anchorKey && (message.type === 'user' || anchorsWithUnmatchedUsers.has(anchorKey))) {
      let insertIndex = anchorInsertPositions.get(anchorKey);
      if (insertIndex === undefined) {
        const anchorIndex = displayMessages.findIndex((candidate) => getTurnAnchorCandidateKeys(candidate).includes(anchorKey));
        if (anchorIndex >= 0) {
          insertIndex = getAnchoredTurnInsertIndex(displayMessages, anchorIndex);
        }
      }

      if (insertIndex !== undefined) {
        displayMessages.splice(insertIndex, 0, message);
        anchorInsertPositions.set(anchorKey, insertIndex + 1);
        for (const [key, position] of anchorInsertPositions) {
          if (key !== anchorKey && position >= insertIndex) {
            anchorInsertPositions.set(key, position + 1);
          }
        }
        continue;
      }
    }

    const isPersistedHistoricalUser = message.type === 'user'
      && message.deliveryStatus === 'persisted'
      && !shouldPreserveAcceptedOptimisticUser(message);
    const nextUserIndex = isPersistedHistoricalUser
      ? previousMessages.findIndex((candidate, index) => index > previousIndex && candidate.type === 'user')
      : -1;
    const followingSearchEndIndex = nextUserIndex > previousIndex ? nextUserIndex : previousMessages.length;
    const followingDisplayIndex = findFollowingDisplayIndex(
      displayMessages,
      previousMessages,
      previousIndex,
      followingSearchEndIndex,
    );
    if (followingDisplayIndex >= 0) {
      displayMessages.splice(followingDisplayIndex, 0, message);
      continue;
    }

    if (isPersistedHistoricalUser) {
      continue;
    }

    displayMessages.push(message);
  }

  return dedupeAdjacentChatMessages(displayMessages) as ChatMessage[];
}
