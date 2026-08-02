/**
 * PURPOSE: Schedule optional startup maintenance after the HTTP listener is
 * available so slow filesystem watchers cannot delay health checks.
 */

type BackgroundStartupOptions = {
  setupProviderWatchers: () => Promise<unknown> | unknown;
  onError: (error: unknown) => void;
};

/**
 * Start Provider watcher initialization on a later event-loop turn.
 */
export function scheduleProviderWatchersAfterListen(options: BackgroundStartupOptions): void {
  /** PURPOSE: Keep watcher readiness and failures outside the server-listening contract. */
  setImmediate(() => {
    void Promise.resolve()
      .then(() => options.setupProviderWatchers())
      .catch(options.onError);
  });
}
