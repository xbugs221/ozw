/**
 * PURPOSE: Own scroll anchor calculations for paginated chat transcripts.
 */

export interface SessionScrollSnapshot {
  height: number;
  top: number;
}

export interface SessionElementScrollSnapshot extends SessionScrollSnapshot {
  anchorKey: string | null;
  anchorOffset: number | null;
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
 * Capture the first rendered transcript row and its viewport-relative offset.
 */
export function captureSessionElementScrollSnapshot(element: HTMLElement | null): SessionElementScrollSnapshot | null {
  /** Stable row identity keeps the reader on the same content after history is prepended. */
  const base = captureSessionScrollSnapshot(element);
  if (!element || !base) return null;
  const containerBounds = element.getBoundingClientRect();
  const rows = Array.from(element.querySelectorAll<HTMLElement>('[data-virtual-row-key]'));
  const anchor = rows.find((row) => {
    const bounds = row.getBoundingClientRect();
    return bounds.bottom > containerBounds.top && bounds.top < containerBounds.bottom;
  });
  return {
    ...base,
    anchorKey: anchor?.dataset.virtualRowKey || null,
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - containerBounds.top : null,
  };
}

/**
 * Calculate the restored scrollTop after the transcript height changes.
 */
export function restoreSessionScrollTop(snapshot: SessionScrollSnapshot, nextHeight: number): number {
  return snapshot.top + Math.max(nextHeight - snapshot.height, 0);
}

/**
 * Restore an estimated height-delta position, then correct it to a stable row.
 */
export function restoreSessionElementScrollPosition(
  snapshot: SessionElementScrollSnapshot,
  element: HTMLElement,
): number {
  /** The height fallback mounts the former row before precise element correction. */
  element.scrollTop = restoreSessionScrollTop(snapshot, element.scrollHeight);
  if (!snapshot.anchorKey || snapshot.anchorOffset === null) return element.scrollTop;
  const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-virtual-row-key]'))
    .find((row) => row.dataset.virtualRowKey === snapshot.anchorKey);
  if (!anchor) return element.scrollTop;
  const currentOffset = anchor.getBoundingClientRect().top - element.getBoundingClientRect().top;
  element.scrollTop += currentOffset - snapshot.anchorOffset;
  return element.scrollTop;
}
