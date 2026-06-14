/**
 * PURPOSE: Publish workflow read-model entry points while the business
 * read-model implementation lives in smaller domain modules.
 */
export {
  buildBatchContextMap,
  buildBatchReadModel,
  buildWorkflowReadModel,
  listBatchReadModels,
  listWorkflowReadModels,
} from './read-model/legacy-core.js';
