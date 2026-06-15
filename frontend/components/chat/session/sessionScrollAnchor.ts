/**
 * PURPOSE: Own scroll anchor calculations for paginated chat transcripts.
 */

export interface SessionScrollSnapshot {
  height: number;
  top: number;
}

/**
 * Capture the scroll values needed to restore position after prepending history.
 */
export function captureSessionScrollSnapshot(element: HTMLElement | null): SessionScrollSnapshot | null {
  if (!element) {
    return null;
  }
  return { height: element.scrollHeight, top: element.scrollTop };
}

/**
 * Calculate the restored scrollTop after the transcript height changes.
 */
export function restoreSessionScrollTop(snapshot: SessionScrollSnapshot, nextHeight: number): number {
  return snapshot.top + Math.max(nextHeight - snapshot.height, 0);
}
