/**
 * PURPOSE: Build turn-level display blocks so assistant body text stays
 * primary while thinking and tool activity can collapse as inspectable detail.
 */
import type { ChatMessage } from '../types/types';

export type TurnNonBodyItemKind = 'thinking-group' | 'tool-group';

export interface TurnNonBodyItem {
  kind: TurnNonBodyItemKind;
  groupKey: string;
  defaultOpen: boolean;
  commandCount: number;
  messages: ChatMessage[];
}

export interface TurnNonBodyGroupBlock {
  kind: 'turn-non-body-group';
  turnKey: string;
  defaultOpen: boolean;
  items: TurnNonBodyItem[];
}

export interface AssistantBodyBlock {
  kind: 'assistant-body';
  message: ChatMessage;
}

export interface MessageBlock {
  kind: 'message';
  message: ChatMessage;
}

export type TurnDisplayBlock = TurnNonBodyGroupBlock | AssistantBodyBlock | MessageBlock;

/**
 * Return a stable identity for grouping rows in one visible transcript window.
 */
function getMessageKey(message: ChatMessage, index: number): string {
  return String(message.messageKey || message.toolCallId || message.toolId || `message-${index}`);
}

/**
 * Detect messages that are process detail rather than final assistant body.
 */
function getNonBodyKind(message: ChatMessage): TurnNonBodyItemKind | null {
  if (message.isThinking || message.type === 'thinking' || message.type === 'reasoning') {
    return 'thinking-group';
  }
  if (message.isTaskNotification && message.taskKind !== 'goal_complete' && message.taskStatus !== 'completed') {
    return 'thinking-group';
  }
  if (
    message.isToolUse ||
    message.isSubagentContainer ||
    message.type === 'tool_use' ||
    message.type === 'tool_result' ||
    message.type === 'command_execution'
  ) {
    return 'tool-group';
  }
  return null;
}

/**
 * Detect active websocket/live process rows. Persisted history should not
 * default-open process detail just because no final assistant body exists.
 */
function isLiveProcessMessage(message: ChatMessage): boolean {
  const source = String(message.source || '');
  return message.isStreaming === true ||
    source.endsWith('-live') ||
    source.endsWith('-realtime');
}

/**
 * Identify assistant body rows that should make prior process detail collapse.
 */
function isAssistantBody(message: ChatMessage): boolean {
  return message.type === 'assistant' && !message.isThinking && !message.isToolUse && !message.isTaskNotification;
}

/**
 * Detect later tool or thinking activity in the same turn.
 */
function hasLaterNonBodyBeforeNextUser(messages: ChatMessage[], index: number): boolean {
  for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
    const nextMessage = messages[nextIndex];
    if (nextMessage.type === 'user') {
      return false;
    }
    if (getNonBodyKind(nextMessage)) {
      return true;
    }
  }
  return false;
}

/**
 * Detect whether another assistant body appears later in the same turn.
 */
function hasLaterAssistantBodyBeforeNextUser(messages: ChatMessage[], index: number): boolean {
  for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
    const nextMessage = messages[nextIndex];
    if (nextMessage.type === 'user') {
      return false;
    }
    if (isAssistantBody(nextMessage)) {
      return true;
    }
  }
  return false;
}

/**
 * Count commands in batch-like tool input for group summaries and tests.
 */
function parseToolInput(toolInput: unknown): unknown {
  if (typeof toolInput !== 'string') {
    return toolInput;
  }
  const trimmed = toolInput.trim();
  if (!trimmed) {
    return toolInput;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return toolInput;
  }
}

/**
 * Count commands from historical string payloads that are not strict JSON.
 */
function countCommandsFromToolInputText(toolInput: string): number {
  const commandMatch = toolInput.match(/"command"\s*:\s*"([\s\S]*?)"\s*(?:[,}\n]|$)/);
  if (commandMatch?.[1]) {
    return countCommandLines(commandMatch[1].replace(/\\n/g, '\n'));
  }
  return 1;
}

/**
 * Count non-empty command lines in shell command text.
 */
function countCommandLines(command: string): number {
  return command.split('\n').filter((line) => line.trim()).length;
}

/**
 * Read command count from normalized live or history tool input payloads.
 */
function getCommandCount(message: ChatMessage): number {
  if (message.type === 'tool_result' && !message.toolInput) {
    return 0;
  }
  const toolInput = parseToolInput(message.toolInput);
  if (toolInput && typeof toolInput === 'object') {
    const commands = (toolInput as { commands?: unknown }).commands;
    if (Array.isArray(commands)) {
      return commands.length;
    }
    const command = (toolInput as { command?: unknown }).command;
    if (typeof command === 'string' && command.trim()) {
      return countCommandLines(command);
    }
  }
  if (typeof toolInput === 'string') {
    return countCommandsFromToolInputText(toolInput);
  }
  return 1;
}

/**
 * Add one non-body message to the current turn group, merging adjacent details
 * by business kind and tool call identity.
 */
function appendNonBodyItem(
  items: TurnNonBodyItem[],
  message: ChatMessage,
  kind: TurnNonBodyItemKind,
  defaultOpen: boolean,
  index: number,
): void {
  const groupKey = kind === 'tool-group'
    ? String(message.toolCallId || message.toolId || message.messageKey || `tool-${index}`)
    : String(message.messageKey || `thinking-${index}`);
  const previous = items[items.length - 1];
  if (previous && previous.kind === kind && previous.groupKey === groupKey) {
    previous.messages.push(message);
    previous.commandCount += kind === 'tool-group' ? getCommandCount(message) : 0;
    return;
  }
  items.push({
    kind,
    groupKey,
    defaultOpen,
    commandCount: kind === 'tool-group' ? getCommandCount(message) : 0,
    messages: [message],
  });
}

/**
 * Convert transcript messages into render blocks. A turn is anchored by the
 * latest user message; process rows before assistant body are grouped.
 */
export function buildTurnDisplayBlocks(messages: ChatMessage[]): TurnDisplayBlock[] {
  const blocks: TurnDisplayBlock[] = [];
  let currentTurnKey = 'turn-start';
  let pendingItems: TurnNonBodyItem[] = [];

  const flushPending = (defaultOpen: boolean) => {
    if (pendingItems.length === 0) {
      return;
    }
    const shouldDefaultOpen = defaultOpen && pendingItems.some((item) =>
      item.messages.some(isLiveProcessMessage),
    );
    blocks.push({
      kind: 'turn-non-body-group',
      turnKey: currentTurnKey,
      defaultOpen: shouldDefaultOpen,
      items: pendingItems.map((item) => ({ ...item, defaultOpen: shouldDefaultOpen })),
    });
    pendingItems = [];
  };

  messages.forEach((message, index) => {
    if (message.type === 'user') {
      flushPending(true);
      currentTurnKey = getMessageKey(message, index);
      blocks.push({ kind: 'message', message });
      return;
    }

    const nonBodyKind = getNonBodyKind(message);
    if (nonBodyKind) {
      appendNonBodyItem(pendingItems, message, nonBodyKind, true, index);
      return;
    }

    const hasPendingTurnActivity = pendingItems.length > 0;
    if (
      isAssistantBody(message) &&
      (
        hasLaterNonBodyBeforeNextUser(messages, index) ||
        (hasPendingTurnActivity && hasLaterAssistantBodyBeforeNextUser(messages, index))
      )
    ) {
      appendNonBodyItem(pendingItems, message, 'thinking-group', true, index);
      return;
    }

    if (isAssistantBody(message)) {
      flushPending(false);
      blocks.push({ kind: 'assistant-body', message });
      return;
    }

    flushPending(true);
    blocks.push({ kind: 'message', message });
  });

  flushPending(true);
  return blocks;
}
