// @ts-nocheck -- Complex cross-module type dependencies; needs dedicated pass.
/**
 * PURPOSE: Provide provider-specific 5h/7d remaining usage data for WebUI.
 * This module reads local Codex state and normalizes it into
 * a shared API response shape that the frontend can render consistently.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_CACHE_TTL_MS = 60_000;
const usageRemainingCache = new Map();

/**
 * Parse numeric values safely from unknown payload fields.
 */
function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

/**
 * Convert used-percent to remaining-percent and clamp to [0, 100].
 */
function toRemainingPercent(usedPercent) {
  const normalizedUsed = parseNumber(usedPercent);
  if (normalizedUsed === null) {
    return null;
  }

  const remaining = 100 - normalizedUsed;
  return Math.max(0, Math.min(100, Number(remaining.toFixed(1))));
}

/**
 * Build a stable API payload for usage remaining responses.
 */
function buildUsageRemainingPayload({
  provider,
  status,
  source,
  updatedAt,
  fiveHourRemaining,
  sevenDayRemaining,
  reason = null,
}) {
  return {
    provider,
    status,
    source,
    updatedAt,
    reason,
    fiveHourRemaining: {
      value: fiveHourRemaining,
      unit: 'percent',
    },
    sevenDayRemaining: {
      value: sevenDayRemaining,
      unit: 'percent',
    },
  };
}

/**
 * Build an unavailable payload with placeholders for both usage windows.
 */
export function createUnavailableUsageRemaining(provider, source, reason = null) {
  return buildUsageRemainingPayload({
    provider,
    status: 'unavailable',
    source,
    updatedAt: null,
    fiveHourRemaining: null,
    sevenDayRemaining: null,
    reason,
  });
}

/**
 * Recursively collect JSONL session files from Codex sessions directory.
 */
async function collectCodexSessionFiles(dir) {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await collectCodexSessionFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    return files;
  }

  return files;
}

/**
 * Find Codex session files sorted by newest mtime first.
 */
async function findCodexSessionFilesByRecency(sessionsDir) {
  const sessionFiles = await collectCodexSessionFiles(sessionsDir);
  if (sessionFiles.length === 0) {
    return [];
  }

  const withStats = [];

  for (const filePath of sessionFiles) {
    try {
      const stat = await fs.stat(filePath);
      withStats.push({ filePath, mtimeMs: stat.mtimeMs || 0 });
    } catch (error) {
      // Ignore unreadable files and continue.
    }
  }

  return withStats
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map((item) => item.filePath);
}

/**
 * Extract the latest rate-limit payload from a Codex JSONL session file.
 */
async function parseCodexRateLimits(sessionFilePath) {
  let fileContent;
  let fileStat;

  try {
    fileContent = await fs.readFile(sessionFilePath, 'utf8');
    fileStat = await fs.stat(sessionFilePath);
  } catch (error) {
    return null;
  }

  const lines = fileContent.split('\n').filter((line) => line.trim().length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]);

      const tokenPayload = entry?.type === 'event_msg' && entry?.payload?.type === 'token_count'
        ? entry.payload
        : entry?.type === 'token_count'
          ? entry
          : null;
      const tokenInfo = tokenPayload?.info || null;
      const rateLimits = tokenPayload?.rate_limits || tokenInfo?.rate_limits;
      if (!rateLimits || typeof rateLimits !== 'object') {
        continue;
      }

      const primaryUsed = parseNumber(rateLimits?.primary?.used_percent);
      const secondaryUsed = parseNumber(rateLimits?.secondary?.used_percent);

      return {
        primaryUsed,
        secondaryUsed,
        updatedAt: entry?.timestamp || fileStat?.mtime?.toISOString?.() || null,
      };
    } catch (error) {
      // Ignore malformed lines.
    }
  }

  return null;
}

/**
 * Load and parse Codex usage limits based on configured statusline modules.
 */
export async function getCodexUsageRemaining(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const sessionsDir = path.join(homeDir, '.codex', 'sessions');

  const sessionFilesByRecency = await findCodexSessionFilesByRecency(sessionsDir);
  if (sessionFilesByRecency.length === 0) {
    return createUnavailableUsageRemaining('codex', 'codex-rate-limits', 'session-file-not-found');
  }

  let rateLimitPayload = null;
  for (const sessionFile of sessionFilesByRecency) {
    rateLimitPayload = await parseCodexRateLimits(sessionFile);
    if (rateLimitPayload) {
      break;
    }
  }

  if (!rateLimitPayload) {
    return createUnavailableUsageRemaining('codex', 'codex-rate-limits', 'rate-limits-not-found');
  }

  const fiveHourRemaining = toRemainingPercent(rateLimitPayload.primaryUsed);
  const sevenDayRemaining = toRemainingPercent(rateLimitPayload.secondaryUsed);

  if (fiveHourRemaining === null && sevenDayRemaining === null) {
    return createUnavailableUsageRemaining('codex', 'codex-rate-limits', 'rate-limits-invalid');
  }

  return buildUsageRemainingPayload({
    provider: 'codex',
    status: 'ok',
    source: 'codex-rate-limits',
    updatedAt: rateLimitPayload.updatedAt,
    fiveHourRemaining,
    sevenDayRemaining,
  });
}

/**
 * Fetch cached provider usage remaining values with short-lived in-memory caching.
 */
export async function getUsageRemaining(provider, options = {}) {
  const normalizedProvider = provider === 'codex'
    ? 'codex'
    : String(provider || 'unknown');
  const homeDir = options.homeDir || os.homedir();
  const cacheTtlMs = typeof options.cacheTtlMs === 'number'
    ? options.cacheTtlMs
    : DEFAULT_CACHE_TTL_MS;
  const nowMs = typeof options.nowMs === 'number' ? options.nowMs : Date.now();

  const cacheKey = `${normalizedProvider}:${homeDir}`;
  const cached = usageRemainingCache.get(cacheKey);
  if (cached && cacheTtlMs > 0 && nowMs - cached.timestamp < cacheTtlMs) {
    return cached.payload;
  }

  let payload;
  if (normalizedProvider === 'codex') {
    payload = await getCodexUsageRemaining({ homeDir });
  } else {
    payload = createUnavailableUsageRemaining(normalizedProvider, `${normalizedProvider}-usage`, 'provider-unsupported');
  }

  usageRemainingCache.set(cacheKey, {
    timestamp: nowMs,
    payload,
  });

  return payload;
}

/**
 * Clear in-memory cache for deterministic tests.
 */
export function clearUsageRemainingCache() {
  usageRemainingCache.clear();
}
