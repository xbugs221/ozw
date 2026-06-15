/**
 * PURPOSE: Own chat submit control decisions that are independent from React rendering.
 */

export const CHAT_USER_MESSAGE_DELIVERY_TIMEOUT_MS = 30000;

export interface ChatSubmitControlInput {
  input: string;
  hasProject: boolean;
  isConnected: boolean;
}

export type ChatSubmitBlockReason = 'empty-input' | 'missing-project' | 'disconnected' | null;

/**
 * Validate whether a composer submit can enter the dispatch pipeline.
 */
export function getChatSubmitBlockReason(input: ChatSubmitControlInput): ChatSubmitBlockReason {
  if (!input.input.trim()) {
    return 'empty-input';
  }
  if (!input.hasProject) {
    return 'missing-project';
  }
  if (!input.isConnected) {
    return 'disconnected';
  }
  return null;
}
