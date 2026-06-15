/**
 * PURPOSE: ReadModel entry for project config loading, display metadata, and
 * archived project state used by project list and overview flows.
 */
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
} from './project-domain-core.js';

export const projectConfigReadModelEntry = true;
