/**
 * PURPOSE: Own local recovery limits and storage keys for chat session state.
 */

export const SESSION_LOCAL_RECOVERY_MESSAGE_LIMIT = 100;

/**
 * Build the localStorage key used for recovered chat messages.
 */
export function getSessionRecoveryStorageKey(projectName: string): string {
  return `chat_messages_${projectName}`;
}

/**
 * Trim recovered messages to the maximum local recovery window.
 */
export function trimSessionRecoveryMessages<T>(messages: T[]): T[] {
  return messages.slice(-SESSION_LOCAL_RECOVERY_MESSAGE_LIMIT);
}
