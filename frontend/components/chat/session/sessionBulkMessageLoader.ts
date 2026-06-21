/**
 * PURPOSE: Load complete chat history in bounded pages so large sessions do not
 * force one unbounded backend response into memory.
 */

export const SESSION_BULK_MESSAGE_PAGE_SIZE = 100;

export type SessionBulkMessageApi = (
  projectName: string,
  sessionId: string,
  limit: number,
  offset: number,
  provider: string,
) => Promise<Response>;

export type SessionBulkMessageResult = {
  messages: unknown[];
  total: number;
};

export async function loadSessionMessagesInPages({
  sessionMessages,
  projectName,
  sessionId,
  provider,
  pageSize = SESSION_BULK_MESSAGE_PAGE_SIZE,
}: {
  sessionMessages: SessionBulkMessageApi;
  projectName: string;
  sessionId: string;
  provider: string;
  pageSize?: number;
}): Promise<SessionBulkMessageResult> {
  /** Fetch every available page using an explicit upper bound per request. */
  const messages: unknown[] = [];
  let offset = 0;
  let total = 0;

  while (true) {
    const response = await sessionMessages(projectName, sessionId, pageSize, offset, provider);
    if (!response.ok) {
      throw new Error('Failed to load all session messages');
    }

    const data = await response.json();
    const pageMessages = Array.isArray(data?.messages) ? data.messages : (Array.isArray(data) ? data : []);
    messages.push(...pageMessages);
    total = Number.isFinite(Number(data?.total)) ? Number(data.total) : messages.length;

    if (!data?.hasMore || pageMessages.length === 0 || messages.length >= total) {
      return { messages, total: Math.max(total, messages.length) };
    }
    offset += pageMessages.length;
  }
}
