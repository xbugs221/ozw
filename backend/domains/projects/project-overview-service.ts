/**
 * PURPOSE: Service entry for assembling project overview details on demand
 * while keeping the default project list lightweight.
 */
export {
  getCodexSessions,
  getCodexSessionMessages,
  getCachedPiSessionsIndex,
  getPiSessionMessages,
  getPiSessions,
  getSessionMessages,
  getSessions,
  indexProviderSessionFile,
  deleteProviderSessionIndexFile,
  parseCodexSessionHeader,
  parseJsonlSessions,
  parsePiSessionHeader,
  readJsonlFirstRecord,
} from './project-domain-core.js';
export { buildProjectOverviewReadModel } from './project-overview-read-model.js';
export { buildProviderSessionListReadModel } from './provider-session-list-read-model.js';

export const projectOverviewServiceEntry = true;
