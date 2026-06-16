/**
 * PURPOSE: Typed chat-history search across Codex and Pi provider transcripts.
 */
import path from 'path';

import { getProjects } from './project-discovery-read-model.js';
import {
  getCodexSessionMessages,
  getCodexSessions,
  getPiSessionMessages,
  getPiSessions,
} from './project-overview-service.js';
import type { LooseRecord } from './project-config-read-model.js';

/**
 * Search provider histories by content or JSONL/session filename text.
 */
export async function searchChatHistory(query = '', mode = 'content'): Promise<LooseRecord[]> {
  const needle = String(query || '').trim();
  if (!needle) {
    return [];
  }
  const searchMode = mode === 'jsonl' ? 'jsonl' : 'content';
  const projects = await getProjects(null, { lightweightList: true });
  const results: LooseRecord[] = [];
  const searchedSessionKeys = new Set<string>();
  for (const project of projects) {
    const projectPath = String(project.fullPath || project.path || '');
    const sessions = [
      ...await getCodexSessions(projectPath, { includeHidden: true }),
      ...await getPiSessions(projectPath, { includeHidden: true }),
    ];
    for (const session of sessions) {
      searchedSessionKeys.add(`${session.provider || 'codex'}:${session.id}`);
      if (searchMode === 'jsonl') {
        const haystack = [session.id, session.thread, session.sessionFileName, path.basename(session.filePath || '')].join('\n');
        if (includesIgnoreCase(haystack, needle)) {
          results.push(buildSessionResult(project, session, path.basename(session.filePath || session.sessionFileName || session.id)));
        }
        continue;
      }
      const transcript = session.provider === 'pi'
        ? await getPiSessionMessages(session.providerSessionId || session.id)
        : await getCodexSessionMessages(session.id);
      for (const message of transcript.messages || []) {
        const text = String(message.message?.content || message.content || message.output || '');
        if (!includesIgnoreCase(text, needle)) {
          continue;
        }
        results.push({
          ...buildSessionResult(project, session, makeSnippet(text, needle)),
          resultType: 'message',
          messageKey: message.messageKey,
          timestamp: message.timestamp || session.lastActivity || session.createdAt || null,
        });
      }
    }
  }
  for (const session of await getPiSessions('', { includeHidden: true })) {
    const sessionKey = `pi:${session.id}`;
    if (searchedSessionKeys.has(sessionKey)) {
      continue;
    }
    if (searchMode === 'jsonl') {
      const haystack = [session.id, session.thread, session.sessionFileName, path.basename(session.filePath || '')].join('\n');
      if (includesIgnoreCase(haystack, needle)) {
        results.push(buildSessionResult(buildProviderOnlyProject(session), session, path.basename(session.filePath || session.sessionFileName || session.id)));
      }
      continue;
    }
    const transcript = await getPiSessionMessages(session.providerSessionId || session.id);
    for (const message of transcript.messages || []) {
      const text = String(message.message?.content || message.content || message.output || '');
      if (!includesIgnoreCase(text, needle)) {
        continue;
      }
      results.push({
        ...buildSessionResult(buildProviderOnlyProject(session), session, makeSnippet(text, needle)),
        resultType: 'message',
        messageKey: message.messageKey,
        timestamp: message.timestamp || session.lastActivity || session.createdAt || null,
      });
    }
  }
  return results.sort((left, right) => new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime());
}

/**
 * Build a search result for a matched provider session.
 */
function buildSessionResult(project: LooseRecord, session: LooseRecord, snippet: string): LooseRecord {
  return {
    resultType: 'session',
    projectName: project.name,
    projectDisplayName: project.displayName,
    provider: session.provider || 'codex',
    sessionId: session.id,
    routeIndex: session.routeIndex,
    sessionSummary: session.summary || session.title || session.id,
    thread: session.thread || session.id,
    sessionFileName: session.sessionFileName,
    snippet,
    timestamp: session.updated_at || session.lastActivity || session.createdAt || null,
  };
}

/**
 * Build the minimal project shape needed for provider-only search results.
 */
function buildProviderOnlyProject(session: LooseRecord): LooseRecord {
  const projectPath = String(session.projectPath || session.cwd || '');
  return {
    name: projectPath,
    displayName: path.basename(projectPath) || projectPath,
  };
}

/**
 * Case-insensitive substring match.
 */
function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Return a compact snippet around the search term.
 */
function makeSnippet(text: string, query: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const index = normalized.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) {
    return normalized.slice(0, 160);
  }
  const start = Math.max(0, index - 48);
  const end = Math.min(normalized.length, index + query.length + 72);
  return `${start > 0 ? '...' : ''}${normalized.slice(start, end)}${end < normalized.length ? '...' : ''}`;
}
