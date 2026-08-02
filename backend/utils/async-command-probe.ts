/**
 * PURPOSE: Run bounded CLI diagnostics without blocking the Node event loop,
 * and share/cache only successful probes across concurrent HTTP requests.
 */

import { execFile } from 'node:child_process';

export type AsyncCommandProbeResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error: Error | null;
};

type AsyncCommandProbeOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  timeoutMs?: number;
};

/** Execute one bounded command while leaving the event loop responsive. */
export function runAsyncCommandProbe(
  command: string,
  args: string[],
  options: AsyncCommandProbeOptions = {},
): Promise<AsyncCommandProbeResult> {
  /** Convert execFile's callback contract into a stable diagnostic result. */
  return new Promise((resolve) => {
    execFile(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      env: options.env || process.env,
      maxBuffer: options.maxBuffer || 4 * 1024 * 1024,
      timeout: options.timeoutMs ?? 3000,
    }, (error, stdout, stderr) => {
      resolve({
        status: error ? (typeof error.code === 'number' ? error.code : null) : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        error,
      });
    });
  });
}

type SuccessfulProbeCacheOptions<T> = {
  isSuccess: (value: T) => boolean;
  ttlMs: number;
};

/** Create a small cache that coalesces in-flight work and retains only success. */
export function createSuccessfulAsyncProbeCache<T>(options: SuccessfulProbeCacheOptions<T>) {
  /** Failures leave no settled entry, so dependency installation can recover immediately. */
  const successful = new Map<string, { value: T; expiresAt: number }>();
  const pending = new Map<string, Promise<T>>();
  let generation = 0;

  return {
    run(key: string, task: () => Promise<T>): Promise<T> {
      /** Return fresh success or shared in-flight work before starting a child process. */
      const now = Date.now();
      const cached = successful.get(key);
      if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);
      if (cached) successful.delete(key);

      const existing = pending.get(key);
      if (existing) return existing;

      const taskGeneration = generation;
      let promise!: Promise<T>;
      promise = Promise.resolve()
        .then(task)
        .then((value) => {
          if (taskGeneration === generation && options.isSuccess(value)) {
            successful.set(key, { value, expiresAt: Date.now() + options.ttlMs });
          }
          return value;
        })
        .finally(() => {
          if (pending.get(key) === promise) pending.delete(key);
        });
      pending.set(key, promise);
      return promise;
    },

    clear(key?: string): void {
      /** Invalidate both settled and in-flight references for isolated tests. */
      generation += 1;
      if (key) {
        successful.delete(key);
        pending.delete(key);
        return;
      }
      successful.clear();
      pending.clear();
    },
  };
}
