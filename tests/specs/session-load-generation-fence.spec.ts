/**
 * PURPOSE: Verify late session-history responses cannot overwrite pagination
 * state after the user navigates to another chat session.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  isCurrentSessionLoadGeneration,
  nextSessionLoadGeneration,
} from '../../frontend/components/chat/session/terminalReconcileController.ts';

const RUNTIME_PATH = path.join(
  process.cwd(),
  'frontend/components/chat/session/sessionRuntimeController.ts',
);

test('a late history response is fenced before it can mutate the active session pagination baseline', async () => {
  /** Reproduce session A starting first and resolving after session B became active. */
  const sessionAGeneration = nextSessionLoadGeneration(0);
  const sessionBGeneration = nextSessionLoadGeneration(sessionAGeneration);
  assert.equal(
    isCurrentSessionLoadGeneration({ current: sessionBGeneration, incoming: sessionAGeneration }),
    false,
    'the late session A response must be stale once session B owns the view',
  );

  const source = await readFile(RUNTIME_PATH, 'utf8');
  const loaderStart = source.indexOf('const loadSessionMessages = useCallback(');
  const loaderEnd = source.indexOf('\n  const convertedMessages = useMemo', loaderStart);
  const loader = source.slice(loaderStart, loaderEnd);
  const fetchCompleted = loader.indexOf('const result = await fetchSessionMessages(');
  const generationFence = loader.indexOf('isCurrentSessionLoadGeneration', fetchCompleted);
  const firstBaselineMutation = loader.indexOf('historySnapshotRawLineOffsetRef.current =', fetchCompleted);

  assert.ok(fetchCompleted >= 0, 'session loader must await the persisted-history request');
  assert.ok(
    generationFence > fetchCompleted && generationFence < firstBaselineMutation,
    'generation fence must run immediately after fetch and before history cursors, totals, or offsets are changed',
  );
  assert.match(
    loader,
    /requestGeneration[\s\S]*sessionLoadGenRef\.current/,
    'the loader must carry the generation captured when the request started',
  );
});
