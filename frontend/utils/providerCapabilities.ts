import type { SessionProvider } from '../types/app';

export type ProviderCapabilities = {
  listSessions: boolean;
  readHistory: boolean;
  createSession: boolean;
  sendMessage: boolean;
  renameSession: boolean;
  deleteSession: boolean;
  subscribeRealtime: boolean;
  checkRuntimeStatus: boolean;
  shellResume: boolean;
};

const writable: ProviderCapabilities = {
  listSessions: true, readHistory: true, createSession: true, sendMessage: true,
  renameSession: true, deleteSession: true, subscribeRealtime: true,
  checkRuntimeStatus: true, shellResume: true,
};

const capabilities: Record<SessionProvider, ProviderCapabilities> = {
  codex: { ...writable },
  pi: { ...writable },
  claude: { ...writable },
  hermes: {
    listSessions: true, readHistory: true, createSession: false, sendMessage: false,
    renameSession: false, deleteSession: false, subscribeRealtime: false,
    checkRuntimeStatus: false, shellResume: false,
  },
};

export function normalizeSessionProvider(value: unknown): SessionProvider | null {
  return value === 'codex' || value === 'pi' || value === 'claude' || value === 'hermes' ? value : null;
}

export function getProviderCapabilities(provider: unknown): ProviderCapabilities | null {
  const normalized = normalizeSessionProvider(provider);
  return normalized ? capabilities[normalized] : null;
}

/** Hermes route ids always encode the server-side profile scope before `~`. */
export function isHermesScopedSessionId(value: unknown): boolean {
  return typeof value === 'string' && /^[^~]+~[^~]+$/.test(value);
}
