/**
 * PURPOSE: Expose chat composer runtime as a small orchestration entrypoint.
 */
export {
  useChatComposerState,
  useChatComposerState as useChatComposerStateRuntime,
} from './useChatComposerStateRuntime.impl';
export type { UseChatComposerStateArgs } from './useChatComposerStateRuntime.impl';
