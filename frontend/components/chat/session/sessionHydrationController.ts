/**
 * PURPOSE: Reserve the chat session hydration boundary for runtime orchestration.
 */
export function describeSessionHydrationBoundary(): string {
  /** Describe the business boundary used by contract tests and future hydration moves. */
  return 'chat-session-hydration';
}
