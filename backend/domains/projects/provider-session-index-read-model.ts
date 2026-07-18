/**
 * PURPOSE: Typed entry for building provider session indexes grouped by
 * project path.
 */
import {
  listCodexSessionFiles,
  listPiSessionFiles,
  parseCodexSessionHeader,
  parsePiSessionHeader,
  listClaudeSessionFiles,
  parseClaudeSessionHeader,
} from './provider-transcript-read-model.js';
import { normalizeProjectPath, type LooseRecord } from './project-config-read-model.js';

let codexSessionsIndexPromise: Promise<Map<string, LooseRecord[]>> | null = null;
let piSessionsIndexPromise: Promise<Map<string, LooseRecord[]>> | null = null;
let claudeSessionsIndexPromise: Promise<Map<string, LooseRecord[]>> | null = null;

/**
 * Clear provider session index promises between isolated test homes.
 */
export function clearProviderSessionIndexCaches(): void {
  codexSessionsIndexPromise = null;
  piSessionsIndexPromise = null;
  claudeSessionsIndexPromise = null;
}

/**
 * Build Codex sessions grouped by normalized project path.
 */
export async function buildCodexSessionsIndex(): Promise<Map<string, LooseRecord[]>> {
  codexSessionsIndexPromise ||= buildProviderSessionsIndex('codex');
  return codexSessionsIndexPromise;
}

/**
 * Build Pi sessions grouped by normalized project path.
 */
export async function buildPiSessionsIndex(): Promise<Map<string, LooseRecord[]>> {
  piSessionsIndexPromise ||= buildProviderSessionsIndex('pi');
  return piSessionsIndexPromise;
}

/** Build Claude project/session headers without reading transcript bodies. */
export async function buildClaudeSessionsIndex(): Promise<Map<string, LooseRecord[]>> {
  claudeSessionsIndexPromise ||= buildProviderSessionsIndex('claude');
  return claudeSessionsIndexPromise;
}

/**
 * Build one provider index directly from transcript headers.
 */
async function buildProviderSessionsIndex(provider: 'codex' | 'pi' | 'claude'): Promise<Map<string, LooseRecord[]>> {
  const files = provider === 'codex'
    ? await listCodexSessionFiles()
    : provider === 'pi' ? await listPiSessionFiles() : await listClaudeSessionFiles();
  const sessions: LooseRecord[] = [];
  for (const filePath of files) {
    const session = provider === 'codex'
      ? await parseCodexSessionHeader(filePath)
      : provider === 'pi' ? await parsePiSessionHeader(filePath) : await parseClaudeSessionHeader(filePath);
    if (!session?.id) {
      continue;
    }
    sessions.push(normalizeIndexedProviderSession({ ...session, provider }, provider));
  }
  return groupSessionsByProject(sessions);
}

/**
 * Keep provider indexes lightweight; detail endpoints still deep-read messages.
 */
function normalizeIndexedProviderSession(session: LooseRecord, provider: 'codex' | 'pi' | 'claude'): LooseRecord {
  if (provider !== 'codex') {
    return session;
  }
  return {
    ...session,
    messageCount: null,
    messageCountKnown: false,
  };
}

/**
 * Group provider sessions by normalized project path.
 */
function groupSessionsByProject(sessions: LooseRecord[]): Map<string, LooseRecord[]> {
  const grouped = new Map<string, LooseRecord[]>();
  for (const session of sessions) {
    const projectPath = normalizeProjectPath(session.projectPath || session.cwd || '');
    grouped.set(projectPath, [...(grouped.get(projectPath) || []), session]);
  }
  return grouped;
}
