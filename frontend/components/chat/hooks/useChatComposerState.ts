/**
 * PURPOSE: Keep the public chat composer hook path stable while delegating the
 * input, attachment, and submit lifecycle implementation to the composer module.
 */
export { useChatComposerState } from '../composer/useChatComposerStateImpl';
