/**
 * PURPOSE: Keep the public chat session hook path stable while delegating the
 * history loading and scroll control implementation to the session module.
 */
export { useChatSessionState } from '../session/useChatSessionStateImpl';
