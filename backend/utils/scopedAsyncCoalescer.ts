/**
 * PURPOSE: Coalesce simultaneous backend heavy reads by business scope without
 * caching settled results beyond the current in-flight task.
 */

type ScopedAsyncCoalescerOptions = {
  label?: string;
  now?: () => number;
};

type ScopedAsyncCoalescerStats = {
  label: string;
  inFlight: number;
  executed: number;
  coalesced: number;
  failed: number;
  scopes: string[];
};

type InFlightTask<T> = {
  promise: Promise<T>;
  startedAt: number;
};

/**
 * Create a scope-keyed promise coalescer for duplicate heavy reads.
 */
export function createScopedAsyncCoalescer(options: ScopedAsyncCoalescerOptions = {}) {
  /**
   * PURPOSE: Share only concurrently running work for identical scopes while
   * allowing each later refresh to execute again with fresh filesystem state.
   */
  const label = options.label || 'scoped-async-coalescer';
  const now = options.now || (() => Date.now());
  const inFlight = new Map<string, InFlightTask<unknown>>();
  const stats = {
    executed: 0,
    coalesced: 0,
    failed: 0,
  };

  return {
    async run<T>(scope: string, task: () => Promise<T> | T): Promise<T> {
      /**
       * PURPOSE: Return the existing in-flight promise for duplicate scope
       * calls and remove it after either success or failure.
       */
      const normalizedScope = String(scope || 'default');
      const existing = inFlight.get(normalizedScope) as InFlightTask<T> | undefined;
      if (existing) {
        stats.coalesced += 1;
        return existing.promise;
      }

      stats.executed += 1;
      const promise = Promise.resolve()
        .then(task)
        .catch((error) => {
          stats.failed += 1;
          throw error;
        })
        .finally(() => {
          const current = inFlight.get(normalizedScope);
          if (current?.promise === promise) {
            inFlight.delete(normalizedScope);
          }
        });

      inFlight.set(normalizedScope, { promise, startedAt: now() });
      return promise;
    },

    getStats(): ScopedAsyncCoalescerStats {
      /**
       * PURPOSE: Expose lightweight runtime evidence for tests and diagnostics.
       */
      return {
        label,
        inFlight: inFlight.size,
        executed: stats.executed,
        coalesced: stats.coalesced,
        failed: stats.failed,
        scopes: Array.from(inFlight.keys()),
      };
    },
  };
}
