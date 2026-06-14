/**
 * PURPOSE: Lock the chat message type contract so transcript utilities reuse
 * the business ChatMessage shape instead of maintaining a drifting duplicate.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();

/**
 * Read a repository source file as UTF-8 text.
 */
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('message dedup utilities reuse the business ChatMessage type source', () => {
  const messageDedup = readSource('frontend/components/chat/utils/messageDedup.ts');
  const sessionMerge = readSource('frontend/components/chat/utils/sessionMessageMerge.ts');
  const messageKeys = readSource('frontend/components/chat/utils/messageKeys.ts');

  assert.doesNotMatch(
    messageDedup,
    /export\s+interface\s+ChatMessage\b/,
    'messageDedup.ts must not declare its own ChatMessage interface',
  );
  assert.match(
    messageDedup,
    /import\s+type\s+\{[^}]*ChatMessage[^}]*\}\s+from\s+['"]\.\.\/types\/types['"]/,
    'messageDedup.ts should import ChatMessage from the chat business types module',
  );
  assert.doesNotMatch(
    sessionMerge,
    /import\s+type\s+\{[^}]*ChatMessage[^}]*\}\s+from\s+['"]\.\/messageDedup['"]/,
    'sessionMessageMerge.ts should not import ChatMessage from messageDedup.ts',
  );
  assert.doesNotMatch(
    messageKeys,
    /import\s+type\s+\{[^}]*ChatMessage[^}]*\}\s+from\s+['"]\.\/messageDedup['"]/,
    'messageKeys.ts should not import ChatMessage from messageDedup.ts',
  );
});

test('business ChatAttachment remains compatible with transcript utility metadata', () => {
  const businessTypes = readSource('frontend/components/chat/types/types.ts');

  assert.match(
    businessTypes,
    /export\s+interface\s+ChatAttachment\s*\{[\s\S]*\[key:\s*string\]:\s*unknown;[\s\S]*\}/,
    'ChatAttachment must allow provider metadata without breaking utility generics',
  );
  assert.match(
    businessTypes,
    /deliveryStatus\?:\s*'pending'\s*\|\s*'sent'\s*\|\s*'persisted'\s*\|\s*'failed'/,
    'ChatMessage.deliveryStatus must stay a narrow business status union',
  );
});
