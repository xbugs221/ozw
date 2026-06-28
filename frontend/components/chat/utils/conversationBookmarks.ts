/**
 * PURPOSE: Build current-session message navigation bookmarks from chat messages
 * without requiring generated summaries or DOM inspection.
 */
import type { ChatMessage } from '../types/types';

export const CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT = 50;
export const CHAT_BOOKMARK_PENDING_SUMMARY = '回复中';

export interface ConversationBookmark {
  id: string;
  userMessageKey: string;
  userPreview: string;
  assistantMessageKey: string | null;
  assistantSummary: string;
  assistantStatus: 'complete' | 'pending';
}

/**
 * Return the first user-visible characters for direct excerpt summaries.
 */
function firstCharacters(value: string, count: number): string {
  return Array.from(value).slice(0, count).join('');
}

/**
 * Decide whether a message is a final assistant body that can summarize a user turn.
 */
function isFinalAssistantMessage(message: ChatMessage): boolean {
  return message.type === 'assistant'
    && !message.isThinking
    && !message.isToolUse
    && !message.isSubagentContainer
    && !message.isInteractivePrompt
    && typeof message.content === 'string'
    && message.content.trim().length > 0;
}

/**
 * Build one bookmark per user message and pair it with the next final assistant reply.
 */
export function buildConversationBookmarks(messages: ChatMessage[]): ConversationBookmark[] {
  const bookmarks: ConversationBookmark[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.type !== 'user') {
      continue;
    }

    const userMessageKey = message.messageKey || `user-message-${index}`;
    const userPreview = firstCharacters(String(message.content || '').trim(), 80);
    let assistantMessage: ChatMessage | null = null;

    for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
      const nextMessage = messages[nextIndex];
      if (nextMessage.type === 'user') {
        break;
      }
      if (isFinalAssistantMessage(nextMessage)) {
        assistantMessage = nextMessage;
        break;
      }
    }

    bookmarks.push({
      id: userMessageKey,
      userMessageKey,
      userPreview,
      assistantMessageKey: assistantMessage?.messageKey || null,
      assistantSummary: assistantMessage
        ? firstCharacters(String(assistantMessage.content || '').trim(), CHAT_BOOKMARK_ASSISTANT_SUMMARY_LIMIT)
        : CHAT_BOOKMARK_PENDING_SUMMARY,
      assistantStatus: assistantMessage ? 'complete' : 'pending',
    });
  }

  return bookmarks;
}
