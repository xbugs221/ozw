/**
 * PURPOSE: Public project-domain service facade.
 *
 * Backend route modules import this stable entry while focused ReadModel and
 * Service modules own the reviewable project-domain boundaries.
 */
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
} from './manual-session-route-read-model.js';
export {
  buildProviderSessionListReadModel,
  deleteProviderSessionIndexFile,
  getCachedPiSessionsIndex,
  getCodexSessionMessages,
  getCodexSessions,
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
  renameCodexSession,
  renameProject,
  renameSession,
  updateSessionUiState,
} from './project-domain-core.js';
