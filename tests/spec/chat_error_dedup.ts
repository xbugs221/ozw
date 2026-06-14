/**
 * PURPOSE: Verify repeated provider transport diagnostics do not create
 * duplicate visible chat error bubbles.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { appendUniqueErrorMessage } from '../../frontend/components/chat/utils/errorDedup.ts';

type TestChatMessage = {
  type: string;
  content?: string;
  timestamp?: Date;
};

test('appendUniqueErrorMessage suppresses repeated identical error content', () => {
  const first = appendUniqueErrorMessage<TestChatMessage>([], 'tls handshake eof');
  const second = appendUniqueErrorMessage(first, 'tls handshake eof');

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(second[0].content, 'tls handshake eof');
});

test('appendUniqueErrorMessage still shows distinct error content', () => {
  const first = appendUniqueErrorMessage<TestChatMessage>([], 'tls handshake eof');
  const second = appendUniqueErrorMessage(first, 'token expired');

  assert.equal(second.length, 2);
  assert.equal(second[1].content, 'token expired');
});
