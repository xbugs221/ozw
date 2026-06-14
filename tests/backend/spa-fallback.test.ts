/**
 * PURPOSE: Verify React shell routing works for project workflow URLs.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldServeSpaIndex } from '../../backend/utils/spaFallback.ts';

function request(path: string, accept: string = 'text/html,application/xhtml+xml') {
  /**
   * Build the minimal Express request shape needed by the SPA fallback helper.
   */
  return {
    path,
    headers: { accept },
  };
}

test('serves workflow route when run id contains timestamp dots', () => {
  /**
   * oz flow run ids use RFC3339-like timestamps such as 20260508T165749.722Z; direct
   * browser navigation must still receive index.html instead of a static 404.
   */
  assert.equal(
    shouldServeSpaIndex(request('/projects/ozw/runs/20260508T165749.722778398Z')),
    true,
  );
});

test('continues rejecting missing static assets with file extensions', () => {
  /**
   * Asset URLs that miss express.static should not be rewritten to the React app.
   */
  assert.equal(shouldServeSpaIndex(request('/assets/index-missing.js', '*/*')), false);
  assert.equal(shouldServeSpaIndex(request('/favicon-missing.svg', 'image/svg+xml,*/*')), false);
});

test('serves extensionless project routes', () => {
  /**
   * Normal project and session routes have no extension and should keep using the
   * SPA shell fallback.
   */
  assert.equal(shouldServeSpaIndex(request('/projects/ozw')), true);
  assert.equal(shouldServeSpaIndex(request('/projects/ozw/c1')), true);
});
