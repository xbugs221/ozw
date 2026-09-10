/**
 * PURPOSE: Run asynchronous session-history commits only while their captured
 * generation still owns the active view.
 */
export interface GenerationFencedSessionLoadArgs<Result, CommitResult> {
  load: () => Promise<Result>;
  isCurrent: () => boolean;
  commit: (result: Result) => CommitResult;
  finish: () => void;
  staleResult: CommitResult;
}

/**
 * Await a history response, then atomically decide whether its commit and
 * loading cleanup still belong to the active session generation.
 */
export async function runGenerationFencedSessionLoad<Result, CommitResult>({
  load,
  isCurrent,
  commit,
  finish,
  staleResult,
}: GenerationFencedSessionLoadArgs<Result, CommitResult>): Promise<CommitResult> {
  try {
    const result = await load();
    if (!isCurrent()) {
      return staleResult;
    }
    return commit(result);
  } finally {
    if (isCurrent()) {
      finish();
    }
  }
}
