/**
 * PURPOSE: Prove a delayed history response cannot overwrite pagination state
 * after another session advances the active load generation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { runGenerationFencedSessionLoad } from '../../frontend/components/chat/session/sessionLoadGenerationFence.ts';
import { nextSessionLoadGeneration } from '../../frontend/components/chat/session/terminalReconcileController.ts';

interface PaginationState {
  historyCursor: string | null;
  appendCursor: string | null;
  offset: number;
  total: number;
  hasMore: boolean;
  loading: boolean;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test('a delayed session A response cannot mutate session B pagination state', async () => {
  let generation = 0;
  const sessionAGeneration = generation;
  const sessionAResponse = deferred<Omit<PaginationState, 'loading'>>();
  const state: PaginationState = {
    historyCursor: 'b-history',
    appendCursor: 'b-append',
    offset: 17,
    total: 41,
    hasMore: true,
    loading: true,
  };
  const sessionBState = { ...state };

  const pendingSessionA = runGenerationFencedSessionLoad({
    load: () => sessionAResponse.promise,
    isCurrent: () => generation === sessionAGeneration,
    commit: (result) => {
      state.historyCursor = result.historyCursor;
      state.appendCursor = result.appendCursor;
      state.offset = result.offset;
      state.total = result.total;
      state.hasMore = result.hasMore;
      return true;
    },
    finish: () => {
      state.loading = false;
    },
    staleResult: false,
  });

  generation = nextSessionLoadGeneration(generation);
  sessionAResponse.resolve({
    historyCursor: 'a-history',
    appendCursor: 'a-append',
    offset: 3,
    total: 9,
    hasMore: false,
  });

  const didCommit = await pendingSessionA;
  assert.deepEqual(
    state,
    sessionBState,
    'session A must not rewrite session B cursors, offset, totals, has-more, or loading state',
  );
  assert.equal(didCommit, false, 'the stale load must report that it did not commit');
});
