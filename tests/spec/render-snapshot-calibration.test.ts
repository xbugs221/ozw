/**
 * PURPOSE: Verify mixed-height transcript snapshots cannot oscillate through
 * unbounded synchronous React layout updates.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRenderSnapshotCalibrationStep } from '../../frontend/components/chat/session/renderSnapshotController.ts';

test('重复消息数和过长校准都会停止同步更新', () => {
  /** A revisited count proves the measured layout is oscillating. */
  assert.equal(resolveRenderSnapshotCalibrationStep({
    currentCount: 7,
    nextCount: 12,
    visitedCounts: new Set([50, 12, 7]),
  }), null);
  assert.equal(resolveRenderSnapshotCalibrationStep({
    currentCount: 7,
    nextCount: 9,
    visitedCounts: new Set([50, 12, 7]),
  }), 9);
  assert.equal(resolveRenderSnapshotCalibrationStep({
    currentCount: 1,
    nextCount: 2,
    visitedCounts: new Set(Array.from({ length: 12 }, (_, index) => index + 10)),
  }), null);
});
