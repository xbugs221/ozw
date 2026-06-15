/**
 * PURPOSE: Service entry for deleting project sessions and whole projects,
 * including provider indexes, JSONL files, config cleanup, and archive rules.
 */
export {
  deleteCodexSession,
  deleteProject,
  deleteSession,
  isProjectEmpty,
} from './project-domain-core.js';

export const projectSessionDeleteServiceEntry = true;
