/**
 * PURPOSE: Lock the mobile follow-latest contract for virtualized chat rows whose
 * real heights settle after tool and markdown content renders.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();

function readSource(relativePath: string): string {
  /**
   * Read a repository source file for focused architecture contract checks.
   */
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('follow-latest stays pinned after virtual row height measurements settle', () => {
  /**
   * Business case: on mobile, tool/markdown rows often grow after the initial
   * scroll-to-bottom; follow mode must react to measurement changes, not only
   * to new chat message objects.
   */
  const pane = readSource('frontend/components/chat/view/subcomponents/ChatMessagesPane.tsx');
  const chatInterface = readSource('frontend/components/chat/view/ChatInterface.tsx');

  assert.match(pane, /isFollowingLatest: boolean/);
  assert.match(pane, /scheduleFollowLatestMeasurementScroll/);
  assert.match(pane, /container\.scrollTop = container\.scrollHeight/);
  assert.match(
    pane,
    /useLayoutEffect\(\(\) => \{\s*scheduleFollowLatestMeasurementScroll\(\);\s*\}, \[measurementVersion, scheduleFollowLatestMeasurementScroll\]\)/,
  );
  assert.match(chatInterface, /isFollowingLatest=\{isFollowingLatest\}/);
});
