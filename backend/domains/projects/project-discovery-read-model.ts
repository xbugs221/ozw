/**
 * PURPOSE: ReadModel entry for project discovery and provider-only project
 * merging. This module owns the public discovery boundary while the migration
 * core keeps shared parsing helpers stable during the split.
 */
export {
  __projectDiscoveryForTest,
  clearProjectDirectoryCache,
  extractProjectDirectory,
  refreshMissingProjectPathCache,
  getProjects,
  addProjectManually,
} from './project-domain-core.js';
export { summarizeProjectForList } from './project-overview-read-model.js';

export const projectDiscoveryReadModelEntry = true;
