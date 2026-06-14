/**
 * Sources: 2026-06-11-98-稳定Codex流式和ToolCall渲染
 *
 * PURPOSE: Verify command tool-card output normalization keeps meaningful text
 * while removing outer blank rows before rendering.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { parseContextCommandPayload } from '../../frontend/components/chat/tools/components/ContentRenderers/toolPayloadParsers.ts';

const CONTEXT_COMMAND_CONTENT_SOURCE = fs.readFileSync(
  new URL('../../frontend/components/chat/tools/components/ContentRenderers/ContextCommandContent.tsx', import.meta.url),
  'utf8',
);

test('ToolCall results trim outer blank lines before command card rendering', () => {
  const parsed = parseContextCommandPayload(
    { intent: 'inspect file', path: 'frontend/components/chat/view/subcomponents/MessageComponent.tsx' },
    { content: 'line one\nline two\n\n\n' },
  );

  assert.equal(parsed.output, 'line one\nline two');
});

test('ToolCall result normalization preserves meaningful indentation', () => {
  const parsed = parseContextCommandPayload(
    { intent: 'inspect file', path: 'indented-output.txt' },
    { content: '\n\n  indented line\n  second line\n\n' },
  );

  assert.equal(parsed.output, '  indented line\n  second line');
});

test('command card collapsed output control does not reserve a blank row', () => {
  assert.doesNotMatch(
    CONTEXT_COMMAND_CONTENT_SOURCE,
    /<summary[^>]*className="[^"]*\bh-6\b[^"]*text-transparent[\s\S]*?&nbsp;/,
    'collapsed command cards must not keep a transparent summary row below the command',
  );
  assert.match(
    CONTEXT_COMMAND_CONTENT_SOURCE,
    /<summary[\s\S]*absolute left-1\.5 top-1/,
    'collapsed command cards should use the visible inline triangle as the only output summary',
  );
  assert.match(
    CONTEXT_COMMAND_CONTENT_SOURCE,
    /<div[\s\S]*data-testid="tool-context-code-card"/,
    'the command card shell must stay as a div so the command remains visible while output details are collapsed',
  );
  assert.doesNotMatch(
    CONTEXT_COMMAND_CONTENT_SOURCE,
    /const CardTag = hasOutput \? 'details' : 'div'/,
    'the command body must not be inside a closed details element',
  );
});
