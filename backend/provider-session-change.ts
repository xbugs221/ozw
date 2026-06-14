/**
 * PURPOSE: Resolve provider JSONL watcher changes into lightweight session
 * invalidation events that the frontend can match to an open chat.
 *
 * NOTE: The co protocol read model has been removed. ozwSessionId resolution
 * now relies on the provider session id and project-level config lookups.
 */

import path from 'path';
import { readJsonlFirstRecord } from './projects.js';

type ProviderName = 'codex' | 'pi' | string;

export type ProviderSessionChangeInput = {
  provider: ProviderName;
  filePath: string;
  rootPath: string;
  changeType?: string;
};

export type ProviderSessionChangeEvent = {
  provider: ProviderName;
  projectPath: string;
  sessionId: string;
  ozwSessionId: string;
  providerSessionId: string;
  sourceSessionId: string;
  changedFile: string;
  changeType: string;
};

type ProviderSessionMetadata = {
  routeSessionId: string;
  providerSessionId: string;
  projectPath: string;
};

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig;

/**
 * Normalize unknown metadata values to trimmed strings.
 */
function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Derive the route-facing provider session id from the changed JSONL path.
 */
function deriveRouteSessionId(relativePath: string, provider: ProviderName): string {
  const filename = path.basename(relativePath).replace(/\.jsonl$/i, '');
  return filename;
}

/**
 * Extract the UUID-like provider id embedded in current Codex and Pi filenames.
 */
function deriveProviderSessionIdFromPath(relativePath: string): string {
  const filename = path.basename(relativePath).replace(/\.jsonl$/i, '');
  const matches = filename.match(UUID_PATTERN);
  return matches?.[matches.length - 1] || '';
}

/**
 * Read provider-specific session id and project path from the first JSONL record.
 */
function extractProviderSessionMetadata(
  provider: ProviderName,
  firstRecord: Record<string, unknown> | null,
  routeSessionId: string,
  fallbackProviderSessionId: string,
): ProviderSessionMetadata {
  if (provider === 'codex') {
    const payload = firstRecord?.payload;
    if (firstRecord?.type === 'session_meta' && payload && typeof payload === 'object') {
      const payloadRecord = payload as Record<string, unknown>;
      return {
        routeSessionId,
        providerSessionId: stringValue(payloadRecord.id) || fallbackProviderSessionId,
        projectPath: stringValue(payloadRecord.cwd),
      };
    }
  }

  if (provider === 'pi' && firstRecord?.type === 'session') {
    return {
      routeSessionId,
      providerSessionId: stringValue(firstRecord.id) || fallbackProviderSessionId,
      projectPath: stringValue(firstRecord.cwd),
    };
  }

  return {
    routeSessionId,
    providerSessionId: fallbackProviderSessionId,
    projectPath: '',
  };
}

/**
 * Resolve a provider JSONL write into the frontend session_changed payload.
 */
export async function resolveProviderSessionChange({
  provider,
  filePath,
  rootPath,
  changeType = 'change',
}: ProviderSessionChangeInput): Promise<ProviderSessionChangeEvent> {
  const relativePath = path.relative(rootPath, filePath);
  const changedFile = relativePath.replace(/\\/g, '/');
  const routeSessionId = deriveRouteSessionId(changedFile, provider);
  const fallbackProviderSessionId = deriveProviderSessionIdFromPath(changedFile);

  let firstRecord: Record<string, unknown> | null = null;
  try {
    const parsed = await readJsonlFirstRecord(filePath);
    firstRecord = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    firstRecord = null;
  }

  const metadata = extractProviderSessionMetadata(
    provider,
    firstRecord,
    routeSessionId,
    fallbackProviderSessionId,
  );
  const providerSessionId = metadata.providerSessionId || fallbackProviderSessionId || routeSessionId;
  const projectPath = metadata.projectPath;

  // Without the co read model, ozwSessionId is the stable route id when
  // available; otherwise fall back to the provider session id itself.
  const ozwSessionId = routeSessionId || providerSessionId;

  return {
    provider,
    projectPath,
    sessionId: ozwSessionId || providerSessionId,
    ozwSessionId,
    providerSessionId,
    sourceSessionId: providerSessionId,
    changedFile,
    changeType,
  };
}
