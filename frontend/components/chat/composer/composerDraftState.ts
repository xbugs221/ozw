/**
 * PURPOSE: Own pure chat composer draft rules so React hooks only wire state to UI.
 */

export interface ComposerDraftSnapshot {
  input: string;
  projectName: string | null;
}

/**
 * Build the localStorage key used for a project's draft composer text.
 */
export function getComposerDraftStorageKey(projectName: string): string {
  return `draft_input_${projectName}`;
}

/**
 * Decide whether a draft snapshot should be persisted for later restoration.
 */
export function shouldPersistComposerDraft(snapshot: ComposerDraftSnapshot): boolean {
  return Boolean(snapshot.projectName);
}
