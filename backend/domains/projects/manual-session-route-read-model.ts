/**
 * PURPOSE: ReadModel and command entry for manual cN session routes, including
 * draft creation, provider binding, runtime lookup, and route finalization.
 */
export {
  bindManualSessionProvider,
  createManualSessionDraft,
  deleteSession,
  finalizeManualSessionRoute,
  getManualSessionRouteRuntime,
  initManualSessionRoute,
} from './project-domain-core.js';

export const manualSessionRouteReadModelEntry = true;
