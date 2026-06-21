/**
 * PURPOSE: Host composer dispatch policy exports split from the composer runtime.
 */
export {
  CHAT_SUBMIT_DEDUP_WINDOW_MS,
  createComposerClientRequestId,
  isDuplicateComposerSubmit,
} from './submitDedupPolicy';
