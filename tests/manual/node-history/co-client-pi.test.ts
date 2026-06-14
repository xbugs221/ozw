// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify Pi provider normalization, co doctor schema, request build,
 * and send gating in co-client.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCoRequest,
  isCoProviderAvailable,
  assertCoProviderAvailable,
  normalizeCoProviders,
} from '../../../backend/co-client.ts';

test('normalizeCoProviders includes pi in provider set', () => {
  const normalized = normalizeCoProviders({ pi: true });
  assert.equal(normalized.pi.available, true);
});

test('normalizeCoProviders marks pi unavailable when not in input', () => {
  const normalized = normalizeCoProviders({});
  assert.equal(normalized.pi.available, false);
});

test('isCoProviderAvailable returns true when pi is available', () => {
  assert.equal(isCoProviderAvailable({ providers: { pi: true } }, 'pi'), true);
});

test('isCoProviderAvailable returns false when pi is unavailable', () => {
  assert.equal(isCoProviderAvailable({ providers: { pi: false } }, 'pi'), false);
  assert.equal(isCoProviderAvailable({ providers: {} }, 'pi'), false);
});

test('assertCoProviderAvailable throws for unavailable pi', () => {
  assert.throws(
    () => assertCoProviderAvailable({
      error: 'pi not found',
      providers: { pi: false },
    }, 'pi'),
    /co provider "pi" is unavailable/,
  );
});

test('buildCoRequest accepts provider="pi"', () => {
  const request = buildCoRequest({
    requestId: 'req_test_pi',
    op: 'message',
    conversationId: 'c42',
    projectPath: '/tmp/test-project',
    provider: 'pi',
    text: 'hello pi',
  });

  assert.equal(request.provider, 'pi');
  assert.equal(request.contract, 'co-request-v1');
  assert.equal(request.op, 'message');
  assert.equal(request.conversation_id, 'c42');
  assert.equal(request.text, 'hello pi');
});

test('buildCoRequest rejects unknown provider', () => {
  assert.throws(
    () => buildCoRequest({
      conversationId: 'c1',
      projectPath: '/tmp',
      provider: 'claude',
    }),
    /provider must be one of/,
  );
});

test('buildCoRequest accepts pi in abort op', () => {
  const request = buildCoRequest({
    requestId: 'req_abort_pi',
    op: 'abort',
    conversationId: 'c42',
    projectPath: '/tmp/test-project',
    provider: 'pi',
    targetTurnId: 'turn_1',
  });

  assert.equal(request.provider, 'pi');
  assert.equal(request.op, 'abort');
  assert.equal(request.conversation_id, 'c42');
});

test('normalizeManualProvider accepts pi (via co-client PROVIDERS set)', () => {
  // Indirect test: buildCoRequest validates using PROVIDERS set
  const request = buildCoRequest({
    conversationId: 'c1',
    projectPath: '/tmp',
    provider: 'pi',
  });
  assert.equal(request.provider, 'pi');
});
