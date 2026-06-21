/**
 * PURPOSE: Parse provider bookkeeping payloads shared by transcript conversion
 * and live-message merge filtering.
 */
import { parseCodexJsonMaybe } from '../../../../shared/codex-message-normalizer.js';

export type ProviderFileUpdatePayload = Record<string, unknown> & {
  path: string;
  kind?: string;
  type?: string;
};

export type CodexToolUpdatePayload = {
  kind: 'tool_use' | 'tool_result';
  payload: Record<string, unknown>;
};

const PROVIDER_FILE_UPDATE_KINDS = new Set([
  'add',
  'added',
  'create',
  'created',
  'delete',
  'deleted',
  'modify',
  'modified',
  'update',
  'updated',
]);

/**
 * Resolve provider file-update bookkeeping from nested string/object envelopes.
 */
export function resolveProviderFileUpdatePayload(value: unknown, depth = 0): ProviderFileUpdatePayload | null {
  if (depth > 5 || value === null || value === undefined) {
    return null;
  }

  const parsed = parseCodexJsonMaybe(value);
  if (parsed !== value) {
    return resolveProviderFileUpdatePayload(parsed, depth + 1);
  }

  if (Array.isArray(value)) {
    for (const part of value) {
      const payload = resolveProviderFileUpdatePayload(part, depth + 1);
      if (payload) {
        return payload;
      }
    }
    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.path === 'string' && (typeof record.kind === 'string' || typeof record.type === 'string')) {
    return record as ProviderFileUpdatePayload;
  }

  const nested = record.message ?? record.content ?? record.text ?? record.output ?? record.result ?? record.displayText;
  if (nested !== undefined && nested !== value) {
    return resolveProviderFileUpdatePayload(nested, depth + 1);
  }

  return null;
}

/**
 * Return true when content is only provider file-update bookkeeping.
 */
export function isProviderFileUpdatePayload(value: unknown): boolean {
  const payload = resolveProviderFileUpdatePayload(value);
  const kind = typeof payload?.kind === 'string'
    ? payload.kind
    : (typeof payload?.type === 'string' ? payload.type : '');
  return typeof payload?.path === 'string' && PROVIDER_FILE_UPDATE_KINDS.has(kind);
}

/**
 * Resolve Codex tool update JSON leaked into assistant text.
 */
export function resolveCodexToolUpdateJson(value: unknown, depth = 0): CodexToolUpdatePayload | null {
  if (depth > 5 || value === null || value === undefined) {
    return null;
  }

  const parsed = parseCodexJsonMaybe(value);
  if (parsed !== value) {
    return resolveCodexToolUpdateJson(parsed, depth + 1);
  }

  if (Array.isArray(value)) {
    for (const part of value) {
      const resolved = resolveCodexToolUpdateJson(part, depth + 1);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }

  if (typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const rawType = String(record.type ?? record.itemType ?? '');
  if (rawType === 'functionCall' || rawType === 'function_call' || rawType === 'custom_tool_call') {
    return { kind: 'tool_use', payload: { ...record, type: 'function_call' } };
  }
  if (rawType === 'functionCallOutput' || rawType === 'function_call_output') {
    return { kind: 'tool_result', payload: { ...record, type: 'function_call_output' } };
  }

  const nested = record.item ?? record.payload ?? record.data ?? record.update ?? record.message ?? record.content ?? record.text;
  if (nested !== undefined && nested !== value) {
    return resolveCodexToolUpdateJson(nested, depth + 1);
  }

  return null;
}
