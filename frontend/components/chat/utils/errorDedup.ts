/**
 * PURPOSE: Keep repeated provider transport errors from creating duplicate
 * visible chat error bubbles after websocket replay or page refresh.
 */

type ErrorDedupChatMessage = {
  type: string;
  content?: string;
  timestamp?: string | number | Date;
  [key: string]: unknown;
};

/**
 * Append one visible provider error unless the same text already exists in the
 * current transcript. Replayed co events can arrive repeatedly after refreshes
 * or reconnects, but the user only needs one copy of an identical diagnostic.
 */
export function appendUniqueErrorMessage<T extends ErrorDedupChatMessage>(
  previous: T[],
  content: string,
): T[] {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return previous;
  }

  const alreadyShown = previous.some((message) =>
    message.type === 'error' &&
    typeof message.content === 'string' &&
    message.content.trim() === normalizedContent,
  );

  if (alreadyShown) {
    return previous;
  }

  return [
    ...previous,
    {
      type: 'error',
      content: normalizedContent,
      timestamp: new Date(),
    } as T,
  ];
}
