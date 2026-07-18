/**
 * PURPOSE: Load complete chat history in bounded pages so large sessions do not
 * force one unbounded backend response into memory.
 */

export const SESSION_BULK_MESSAGE_PAGE_SIZE = 50;
const SESSION_BULK_MAX_PAGE_ATTEMPTS = 1000;

export type SessionBulkMessageApi = (
  projectName: string,
  sessionId: string,
  limit: number,
  offset: number,
  provider: string,
  afterLine?: number | null,
  afterCursor?: string | null,
  projectPath?: string,
  historySnapshotRawLineOffset?: number | null,
) => Promise<Response>;

export type SessionBulkMessageResult = {
  messages: unknown[];
  total: number;
  historySnapshotRawLineOffset: number | null;
};

/**
 * Pick the next history offset from message metadata, retaining legacy compatibility.
 */
function resolveNextBulkMessageOffset(data: Record<string, unknown>, offset: number, loadedCount: number): number {
  /** Claude pages by visible messages; older providers may still expose only a raw-line cursor. */
  const nextMessageOffset = Number(data?.nextMessageOffset);
  if (Number.isSafeInteger(nextMessageOffset) && nextMessageOffset > offset) {
    return nextMessageOffset;
  }
  const nextRawLineOffset = Number(data?.nextRawLineOffset);
  if (Number.isSafeInteger(nextRawLineOffset) && nextRawLineOffset > offset) {
    return nextRawLineOffset;
  }
  return offset + loadedCount;
}

export async function loadSessionMessagesInPages({
  sessionMessages,
  projectName,
  sessionId,
  provider,
  projectPath = '',
  pageSize = SESSION_BULK_MESSAGE_PAGE_SIZE,
}: {
  sessionMessages: SessionBulkMessageApi;
  projectName: string;
  sessionId: string;
  provider: string;
  projectPath?: string;
  pageSize?: number;
}): Promise<SessionBulkMessageResult> {
  /** Fetch every available page using an explicit upper bound per request. */
  const messages: unknown[] = [];
  let offset = 0;
  let total = 0;
  let historySnapshotRawLineOffset: number | null = null;

  for (let attempt = 0; attempt < SESSION_BULK_MAX_PAGE_ATTEMPTS; attempt += 1) {
    const response = await sessionMessages(projectName, sessionId, pageSize, offset, provider, null, null, projectPath, historySnapshotRawLineOffset);
    if (!response.ok) {
      throw new Error('Failed to load all session messages');
    }

    const data = await response.json();
    const pageMessages = Array.isArray(data?.messages) ? data.messages : (Array.isArray(data) ? data : []);
    messages.unshift(...pageMessages);
    total = Number.isFinite(Number(data?.total)) ? Number(data.total) : messages.length;
    if (historySnapshotRawLineOffset === null && Number.isSafeInteger(Number(data?.historySnapshotRawLineOffset))) {
      historySnapshotRawLineOffset = Number(data.historySnapshotRawLineOffset);
    }

    if (!data?.hasMore) {
      return { messages, total: Math.max(total, messages.length), historySnapshotRawLineOffset };
    }
    const nextOffset = resolveNextBulkMessageOffset(data, offset, pageMessages.length);
    if (nextOffset <= offset) {
      return { messages, total: Math.max(total, messages.length), historySnapshotRawLineOffset };
    }
    offset = nextOffset;
  }

  throw new Error('Exceeded bounded session message page attempts');
}
