/**
 * PURPOSE: Persist chat-uploaded files under a stable home-directory root and
 * describe them to agents as filesystem paths instead of embedding file bytes.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

import { sanitizeUploadRelativePath } from './project-file-operations.js';

const CHAT_UPLOAD_ROOT = path.join(os.homedir(), 'ozw-uploads');

/**
 * Build a filesystem-safe filename for temporary upload staging.
 */
function sanitizeFilename(filename: string): string {
  return String(filename || 'upload')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    || 'upload';
}

/**
 * Create a stable batch directory so one message's uploads stay grouped.
 */
function createBatchId(): string {
  const suffix = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : crypto.randomBytes(4).toString('hex');
  return `${Date.now()}-${suffix}`;
}

/**
 * Resolve the relative path submitted by the browser for a chat attachment.
 */
function resolveSubmittedRelativePath(file: { webkitRelativePath?: string; originalname?: string; filename?: string }, relativePaths: string[] | null, index: number): string {
  const submittedPath = Array.isArray(relativePaths) ? relativePaths[index] : null;
  const browserRelativePath = typeof file.webkitRelativePath === 'string' && file.webkitRelativePath
    ? file.webkitRelativePath
    : null;
  const fallbackName = file.originalname || file.filename || `upload-${index + 1}`;
  return submittedPath || browserRelativePath || fallbackName;
}

/**
 * Hash the persisted filename so same-named uploads never clobber each other.
 */
async function buildHashedFilename(file: { path: string; originalname?: string; filename?: string }, relativePath: string): Promise<string> {
  const fileBytes = await fs.readFile(file.path);
  const digest = crypto.createHash('sha256').update(fileBytes).digest('hex').slice(0, 20);
  const preferredExt = path.extname(relativePath) || path.extname(file.originalname || file.filename || '');
  const normalizedExt = typeof preferredExt === 'string' ? preferredExt.toLowerCase() : '';
  const safeExt = /^\.[a-z0-9]+$/.test(normalizedExt) ? normalizedExt : '';
  return `${digest}${safeExt || ''}`;
}

/**
 * Preserve submitted folders while replacing the leaf filename with a hash.
 */
async function buildPersistedRelativePath(file: { path: string; originalname?: string; filename?: string }, relativePath: string): Promise<string> {
  const normalizedPath = relativePath.split(path.sep).join(path.posix.sep);
  const parsedPath = path.posix.parse(normalizedPath);
  const hashedFilename = await buildHashedFilename(file, normalizedPath);
  return parsedPath.dir ? path.posix.join(parsedPath.dir, hashedFilename) : hashedFilename;
}

/**
 * Avoid rare hash collisions or repeated identical uploads within the same batch.
 */
async function ensureUniqueDestinationPath(destinationPath: string): Promise<string> {
  let attempt = 0;
  let candidatePath = destinationPath;

  while (true) {
    try {
      await fs.access(candidatePath);
      attempt += 1;
      const parsedPath = path.parse(destinationPath);
      candidatePath = path.join(
        parsedPath.dir,
        `${parsedPath.name}-${attempt}${parsedPath.ext}`,
      );
    } catch {
      return candidatePath;
    }
  }
}

/**
 * Persist uploaded files from multer's temporary area into the chat upload root.
 */
export async function persistChatUploads(files: Array<{ path: string; webkitRelativePath?: string; originalname?: string; filename?: string; size: number; mimetype?: string }>, options: { relativePaths?: string[] | null; userId?: string } = {}): Promise<{ rootPath: string; attachments: Array<Record<string, unknown>> }> {
  const {
    relativePaths = null,
    userId = 'anonymous',
  } = options;

  const batchId = createBatchId();
  const userDir = path.join(CHAT_UPLOAD_ROOT, String(userId));
  const batchDir = path.join(userDir, batchId);
  await fs.mkdir(batchDir, { recursive: true });

  const attachments = [];

  for (const [index, file] of files.entries()) {
    const submittedRelativePath = sanitizeUploadRelativePath(
      resolveSubmittedRelativePath(file, relativePaths, index)
    );
    const relativePath = await buildPersistedRelativePath(file, submittedRelativePath);
    const destinationPath = await ensureUniqueDestinationPath(path.join(batchDir, relativePath));

    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.rename(file.path, destinationPath);

    attachments.push({
      kind: 'file',
      name: path.basename(relativePath),
      relativePath,
      absolutePath: destinationPath,
      originalName: path.basename(submittedRelativePath),
      size: file.size,
      mimeType: file.mimetype || 'application/octet-stream',
    });
  }

  return {
    rootPath: batchDir,
    attachments,
  };
}

/**
 * Build a plain-text attachment note so the agent can inspect uploads itself.
 */
export function appendAttachmentNote(command: string, attachments: Array<Record<string, unknown>>): string {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return command;
  }

  const summary = attachments.map((attachment, index) => (
    `${index + 1}. ${attachment.relativePath} -> ${attachment.absolutePath} `
      + `(${attachment.mimeType}, ${attachment.size} bytes)`
  )).join('\n');
  const note = [
    '',
    '[User uploaded files for this message]',
    'The files were saved to local paths below. Inspect them directly and decide how to parse them.',
    summary,
  ].join('\n');

  if (!command?.trim()) {
    return note.trim();
  }

  return `${command}\n\n${note.trim()}`;
}

export {
  CHAT_UPLOAD_ROOT,
  sanitizeFilename,
  buildHashedFilename,
};
