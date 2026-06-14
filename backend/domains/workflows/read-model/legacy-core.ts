/**
 * PURPOSE: Keep the workflow read-model public import path stable while
 * the typed read-model modules own the proposal-facing boundaries.
 */
export {
  buildBatchContextMap,
  buildBatchReadModel,
  buildWorkflowReadModel,
  listBatchReadModels,
  listWorkflowReadModels,
} from './builder-internals.js';
