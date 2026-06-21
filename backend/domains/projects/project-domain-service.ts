/**
 * PURPOSE: Public project-domain service facade.
 *
 * Backend route modules import this stable entry while focused ReadModel and
 * Service modules own the reviewable project-domain boundaries.
 */
import { db } from '../../database/db.js';
import { providerSessionIndexDb } from '../../provider-session-index-store.js';
import {
  configureProviderSessionReadModel,
} from './provider-session-read-model.js';
import {
  parseCodexSessionHeader,
  parsePiSessionHeader,
} from './provider-transcript-read-model.js';

configureProviderSessionReadModel({
  getDb: async () => db,
  getProviderSessionIndexDb: async () => providerSessionIndexDb,
  parseCodexSessionHeader,
  parseCodexSessionFile: parseCodexSessionHeader,
  buildCodexSessionFromHeader: (sessionData, filePath) => ({ ...sessionData, filePath }),
  parsePiSessionHeader,
  warn: (message, error) => console.warn(message, error),
});

export {
  __projectDiscoveryForTest,
  addProjectManually,
  clearProjectDirectoryCache,
  extractProjectDirectory,
  getProjects,
  refreshMissingProjectPathCache,
} from './project-discovery-read-model.js';
export {
  buildProjectRoutePath,
  createDefaultProjectArchiveIndex,
  evaluateProjectArchival,
  findProjectChatRecord,
  getProjectArchiveFilePath,
  getSessionModelState,
  isMissingProjectPathError,
  loadProjectArchiveIndex,
  loadProjectConfig,
  saveProjectArchiveIndex,
  saveProjectConfig,
  updateSessionModelState,
  validateProjectPathAvailability,
} from './project-config-read-model.js';
export {
  bindManualSessionProvider,
  createManualSessionDraft,
  finalizeManualSessionRoute,
  getManualSessionRouteRuntime,
  initManualSessionRoute,
  updateManualSessionTitleFromFirstRequest,
} from './manual-session-route-read-model.js';
export {
  buildProviderSessionListReadModel,
  countProviderSessionsForProject,
  deleteProviderSessionIndexFile,
  getCachedPiSessionsIndex,
  getCodexSessionMessages,
  getCodexSessions,
  getProviderSessionProjectPathForFile,
  getPiSessionMessages,
  getPiSessions,
  getSessionMessages,
  getSessions,
  indexProviderSessionFile,
  parseCodexSessionHeader,
  parseJsonlSessions,
  parsePiSessionHeader,
  readJsonlFirstRecord,
} from './project-overview-service.js';
export {
  deleteCodexSession,
  deleteProject,
  deleteSession,
  isProjectEmpty,
} from './project-session-delete-service.js';
export { searchChatHistory } from './chat-history-search-service.js';
export {
  buildCodexSessionsIndex,
  buildPiSessionsIndex,
} from './provider-session-index-read-model.js';
export {
  renameCodexSession,
  renameProject,
  renameSession,
} from './project-rename-service.js';
export {
  updateSessionUiState,
} from './project-config-read-model.js';
