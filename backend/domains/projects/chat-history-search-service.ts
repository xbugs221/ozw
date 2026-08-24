/**
 * 文件目的：按项目检索 Codex 与 Pi 聊天记录，并复用未变化会话的解析结果。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { getProjects } from './project-discovery-read-model.js';
import { getCodexSessionMessages, getCodexSessions, getPiSessionMessages, getPiSessions } from './project-overview-service.js';
import type { LooseRecord } from './project-config-read-model.js';

type SearchOptions = { projectPath?: string; projectName?: string; limit?: number };
type CacheEntry = { projectPath: string; version: string; transcript: Promise<LooseRecord> };
const transcriptCache = new Map<string, CacheEntry>();
const resultRelevance = new WeakMap<LooseRecord, number>();
const MAX_CACHE_ENTRIES = 256;
const PARSE_CONCURRENCY = 6;

/**
 * Search provider histories by content or JSONL/session filename text.
 * Omitted options retain legacy global, unlimited behavior.
 */
export async function searchChatHistory(query = '', mode = 'content', options: SearchOptions = {}): Promise<LooseRecord[]> {
  const needle = String(query || '').trim();
  if (!needle) return [];
  const searchMode = mode === 'jsonl' ? 'jsonl' : 'content';
  const requestedPath = String(options.projectPath || '').trim();
  const requestedName = String(options.projectName || '').trim();
  const isScoped = Boolean(requestedPath || requestedName);
  const projects = await resolveProjects(requestedPath, requestedName);
  const searchedKeys = new Set<string>();
  const results: LooseRecord[] = [];

  for (const project of projects) {
    const projectPath = String(project.fullPath || project.path || project.projectPath || '');
    const [codex, pi] = await Promise.all([
      getCodexSessions(projectPath, { includeHidden: true }),
      getPiSessions(projectPath, { includeHidden: true }),
    ]);
    const sessions = [...codex, ...pi];
    invalidateDeleted(projectPath, sessions);
    sessions.forEach((session) => searchedKeys.add(`${session.provider || 'codex'}:${session.id}`));
    results.push(...await searchSessions(project, sessions, needle, searchMode, projectPath));
  }

  if (!isScoped) {
    const orphans = (await getPiSessions('', { includeHidden: true }))
      .filter((session) => !searchedKeys.has(`pi:${session.id}`));
    results.push(...await searchSessions(null, orphans, needle, searchMode, ''));
  }

  results.sort((left, right) => (
    (resultRelevance.get(right) || 0) - (resultRelevance.get(left) || 0)
    || new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime()
  ));
  const limit = normalizeLimit(options.limit);
  return limit === null ? results : results.slice(0, limit);
}

/** Resolve only projects selected by the caller's path or stable project name. */
async function resolveProjects(projectPath: string, projectName: string): Promise<LooseRecord[]> {
  const projects = await getProjects(null, { lightweightList: true });
  if (projectPath) {
    const target = normalizePath(projectPath);
    const matched = projects.find((project) => normalizePath(String(project.fullPath || project.path || project.projectPath || '')) === target);
    return [matched || { name: projectName || projectPath, displayName: path.basename(projectPath) || projectName, fullPath: projectPath }];
  }
  if (projectName) return projects.filter((project) => String(project.name || '') === projectName);
  return projects;
}

/** Search transcripts with bounded concurrency so large projects do not exhaust descriptors. */
async function searchSessions(
  project: LooseRecord | null,
  sessions: LooseRecord[],
  needle: string,
  mode: 'jsonl' | 'content',
  projectPath: string,
): Promise<LooseRecord[]> {
  const resultChunks: LooseRecord[][] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(PARSE_CONCURRENCY, sessions.length) }, async () => {
    while (nextIndex < sessions.length) {
      const session = sessions[nextIndex++];
      const effectivePath = projectPath || String(session.projectPath || session.cwd || '');
      const effectiveProject = project || providerOnlyProject(session);
      if (mode === 'jsonl') {
        const score = bestFuzzyScore([
          session.id,
          session.thread,
          session.sessionFileName,
          path.basename(session.filePath || ''),
          session.summary,
          session.title,
        ], needle);
        if (score > 0) {
          const result = buildResult(effectiveProject, session, path.basename(session.filePath || session.sessionFileName || session.id), effectivePath);
          resultRelevance.set(result, score);
          resultChunks.push([result]);
        }
        continue;
      }
      const transcript = await cachedTranscript(session, effectivePath);
      const matches: LooseRecord[] = [];
      for (const message of transcript.messages || []) {
        const text = String(message.message?.content || message.content || message.output || '');
        if (!includesIgnoreCase(text, needle)) continue;
        matches.push({
          ...buildResult(effectiveProject, session, makeSnippet(text, needle), effectivePath),
          resultType: 'message',
          messageKey: message.messageKey,
          timestamp: message.timestamp || session.lastActivity || session.createdAt || null,
        });
      }
      if (matches.length) resultChunks.push(matches);
    }
  });
  await Promise.all(workers);
  return resultChunks.flat();
}

/** Reuse parsed messages until the session file's mtime or size changes. */
async function cachedTranscript(session: LooseRecord, projectPath: string): Promise<LooseRecord> {
  const filePath = String(session.filePath || '').trim();
  if (!filePath) return readTranscript(session);
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    transcriptCache.delete(filePath);
    return { messages: [], total: 0 };
  }
  const version = `${stat.mtimeMs}:${stat.size}`;
  const cached = transcriptCache.get(filePath);
  if (cached?.version === version) {
    transcriptCache.delete(filePath);
    transcriptCache.set(filePath, cached);
    return cached.transcript;
  }
  const transcript = readTranscript(session);
  transcriptCache.set(filePath, { projectPath: normalizePath(projectPath), version, transcript });
  trimCache();
  try {
    return await transcript;
  } catch (error) {
    if (transcriptCache.get(filePath)?.transcript === transcript) transcriptCache.delete(filePath);
    throw error;
  }
}

/** Read one transcript through the provider-specific normalized adapter. */
function readTranscript(session: LooseRecord): Promise<LooseRecord> {
  const id = session.providerSessionId || session.id;
  const indexedFilePath = String(session.filePath || '');
  return session.provider === 'pi'
    ? getPiSessionMessages(id, null, 0, null, indexedFilePath)
    : getCodexSessionMessages(id, null, 0, null, indexedFilePath);
}

/** Remove cached files absent from a fresh listing of the same project. */
function invalidateDeleted(projectPath: string, sessions: LooseRecord[]): void {
  const normalized = normalizePath(projectPath);
  const visible = new Set(sessions.map((session) => String(session.filePath || '')).filter(Boolean));
  for (const [filePath, entry] of transcriptCache) {
    if (entry.projectPath === normalized && !visible.has(filePath)) transcriptCache.delete(filePath);
  }
}

/** Evict least-recently-used transcript entries above the memory bound. */
function trimCache(): void {
  while (transcriptCache.size > MAX_CACHE_ENTRIES) {
    const oldest = transcriptCache.keys().next().value;
    if (typeof oldest !== 'string') return;
    transcriptCache.delete(oldest);
  }
}

/** Normalize the optional result limit; omission intentionally remains unlimited. */
function normalizeLimit(limit: number | undefined): number | null {
  if (limit === undefined) return null;
  const numeric = Number(limit);
  return Number.isFinite(numeric) && numeric > 0 ? Math.min(200, Math.floor(numeric)) : 50;
}

/** Normalize path identity for scope and cache comparisons. */
function normalizePath(candidate: string): string {
  return candidate ? path.resolve(candidate) : '';
}

/** Build a normalized search result for either a session or message match. */
function buildResult(project: LooseRecord, session: LooseRecord, snippet: string, projectPath: string): LooseRecord {
  return {
    resultType: 'session', projectName: project.name, projectDisplayName: project.displayName, projectPath,
    provider: session.provider || 'codex', sessionId: session.id, routeIndex: session.routeIndex,
    sessionSummary: session.summary || session.title || session.id, thread: session.thread || session.id,
    sessionFileName: session.sessionFileName, snippet,
    timestamp: session.updated_at || session.lastActivity || session.createdAt || null,
  };
}

/** Build minimal project identity for an unbound global Pi result. */
function providerOnlyProject(session: LooseRecord): LooseRecord {
  const projectPath = String(session.projectPath || session.cwd || '');
  return { name: projectPath, displayName: path.basename(projectPath) || projectPath };
}

/** Match case-insensitive text without changing legacy substring semantics. */
function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Score filename metadata with substring priority and subsequence fallback. */
function bestFuzzyScore(candidates: unknown[], needle: string): number {
  return candidates.reduce<number>((best, candidate) => Math.max(best, fuzzyScore(String(candidate || ''), needle)), 0);
}

/** Return a stable relevance score for substring or ordered-character matches. */
function fuzzyScore(haystack: string, needle: string): number {
  const normalizedHaystack = haystack.toLowerCase();
  const normalizedNeedle = needle.toLowerCase();
  const substringIndex = normalizedHaystack.indexOf(normalizedNeedle);
  if (substringIndex >= 0) {
    return 2_000 - Math.min(999, substringIndex + normalizedHaystack.length - normalizedNeedle.length);
  }
  let haystackIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  for (const character of normalizedNeedle) {
    const matchedAt = normalizedHaystack.indexOf(character, haystackIndex);
    if (matchedAt < 0) return 0;
    if (firstMatch < 0) firstMatch = matchedAt;
    lastMatch = matchedAt;
    haystackIndex = matchedAt + 1;
  }
  const span = lastMatch - firstMatch + 1;
  return 1_000 - Math.min(999, firstMatch + span - normalizedNeedle.length);
}

/** Return compact surrounding context for a message match. */
function makeSnippet(text: string, query: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const index = normalized.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return normalized.slice(0, 160);
  const start = Math.max(0, index - 48);
  const end = Math.min(normalized.length, index + query.length + 72);
  return `${start > 0 ? '...' : ''}${normalized.slice(start, end)}${end < normalized.length ? '...' : ''}`;
}
