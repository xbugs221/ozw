/**
 * PURPOSE: Own chat attachment queue validation and stable local attachment keys.
 */

export const CHAT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_COUNT = 100;

export interface AttachmentValidationResult {
  accepted: File[];
  rejected: Array<{ key: string; reason: string }>;
}

/**
 * Build a stable local key so duplicate filenames from folder uploads and
 * clipboard pastes remain distinct in upload progress state.
 */
export function getChatAttachmentKey(file: File): string {
  return file.webkitRelativePath || `${file.name}:${file.size}:${file.lastModified}`;
}

/**
 * Validate local uploads before the browser sends them to the server.
 */
export function validateChatAttachmentQueue(files: File[]): AttachmentValidationResult {
  const accepted: File[] = [];
  const rejected: Array<{ key: string; reason: string }> = [];

  for (const file of files) {
    if (!file || typeof file !== 'object') {
      rejected.push({ key: 'invalid-file', reason: 'Invalid file' });
      continue;
    }
    if (!file.size || file.size > CHAT_ATTACHMENT_MAX_BYTES) {
      rejected.push({ key: getChatAttachmentKey(file), reason: 'File too large (max 25MB)' });
      continue;
    }
    accepted.push(file);
  }

  return { accepted: accepted.slice(0, CHAT_ATTACHMENT_MAX_COUNT), rejected };
}
