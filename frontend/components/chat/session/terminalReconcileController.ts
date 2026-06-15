/**
 * PURPOSE: Own stale-load and terminal reconciliation decisions for session hydration.
 */

export interface TerminalReconcileGeneration {
  current: number;
  incoming: number;
}

/**
 * Decide whether an async session load result still belongs to the active view.
 */
export function isCurrentSessionLoadGeneration(generation: TerminalReconcileGeneration): boolean {
  return generation.current === generation.incoming;
}

/**
 * Advance the monotonic generation used to discard stale session loads.
 */
export function nextSessionLoadGeneration(current: number): number {
  return current + 1;
}
