/**
 * PURPOSE: Calculate bounded chat transcript render ranges from loaded message
 * heights so the UI can keep DOM size stable while users browse long history.
 */

export type TranscriptVirtualRange = {
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
};

export type TranscriptVirtualLayout = {
  offsets: number[];
  totalHeight: number;
};

/**
 * Build cumulative top offsets for every loaded transcript message.
 */
export function buildTranscriptVirtualLayout(
  messageKeys: string[],
  measuredHeights: ReadonlyMap<string, number>,
  estimatedMessageHeight: number,
): TranscriptVirtualLayout {
  const offsets = new Array(messageKeys.length + 1);
  offsets[0] = 0;

  for (let index = 0; index < messageKeys.length; index += 1) {
    const measured = measuredHeights.get(messageKeys[index]);
    offsets[index + 1] = offsets[index] + (measured || estimatedMessageHeight);
  }

  return {
    offsets,
    totalHeight: offsets[messageKeys.length] || 0,
  };
}

/**
 * Calculate the continuous transcript slice that should be mounted near scrollTop.
 */
export function calculateTranscriptVirtualRange({
  messageCount,
  offsets,
  totalHeight,
  scrollTop,
  viewportHeight,
  estimatedMessageHeight,
  maxRenderedMessages,
  overscan,
}: {
  messageCount: number;
  offsets: number[];
  totalHeight: number;
  scrollTop: number;
  viewportHeight: number;
  estimatedMessageHeight: number;
  maxRenderedMessages: number;
  overscan: number;
}): TranscriptVirtualRange {
  if (messageCount <= maxRenderedMessages) {
    return {
      start: 0,
      end: messageCount,
      paddingTop: 0,
      paddingBottom: 0,
    };
  }

  const viewportBottom = scrollTop + Math.max(viewportHeight, estimatedMessageHeight * 4);
  let start = 0;
  while (start < messageCount && offsets[start + 1] < scrollTop) {
    start += 1;
  }

  let end = start;
  while (end < messageCount && offsets[end] <= viewportBottom) {
    end += 1;
  }

  start = Math.max(0, start - overscan);
  end = Math.min(messageCount, end + overscan);

  if (end - start > maxRenderedMessages) {
    const midpoint = Math.floor((start + end) / 2);
    start = Math.max(0, midpoint - Math.floor(maxRenderedMessages / 2));
    end = Math.min(messageCount, start + maxRenderedMessages);
    start = Math.max(0, end - maxRenderedMessages);
  }

  return {
    start,
    end,
    paddingTop: offsets[start] || 0,
    paddingBottom: Math.max(0, totalHeight - (offsets[end] || 0)),
  };
}
