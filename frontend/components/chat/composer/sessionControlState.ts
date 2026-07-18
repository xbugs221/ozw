/**
 * PURPOSE: Own model and depth control rules for chat sessions.
 */

import type { SessionProvider } from '../../../types/app';

export interface SessionControlSelection {
  provider: SessionProvider;
  model: string;
  reasoningEffort?: string;
  thinkingLevel?: string;
}

/**
 * Decide whether a new control selection differs from the current user value.
 */
export function hasSessionControlChanged(
  current: SessionControlSelection,
  next: SessionControlSelection,
): boolean {
  return current.provider !== next.provider
    || current.model !== next.model
    || current.reasoningEffort !== next.reasoningEffort
    || current.thinkingLevel !== next.thinkingLevel;
}
