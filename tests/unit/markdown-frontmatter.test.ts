/**
 * PURPOSE: Verify frontend Markdown frontmatter parsing before React renderers
 * turn markdown files and chat markdown into visible HTML.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { parseMarkdownFrontmatter } from '../../frontend/utils/markdownFrontmatter';

describe('markdown frontmatter parsing', () => {
  it('extracts YAML metadata and returns markdown body content', () => {
    /**
     * docstring: Standard markdown files should render metadata separately and
     * pass only the body into React Markdown.
     */
    const parsed = parseMarkdownFrontmatter([
      '---',
      'title: Release note',
      'tags:',
      '  - ui',
      '  - markdown',
      'published: true',
      '---',
      '# Body',
    ].join('\n'));

    assert.equal(parsed.hasFrontmatter, true);
    assert.equal(parsed.content.trim(), '# Body');
    assert.equal(parsed.data.title, 'Release note');
    assert.deepEqual(
      parsed.entries.map((entry) => [entry.key, entry.value]),
      [
        ['title', 'Release note'],
        ['tags', 'ui, markdown'],
        ['published', 'true'],
      ],
    );
  });

  it('does not execute JavaScript frontmatter engines', () => {
    /**
     * docstring: Untrusted markdown can contain gray-matter engine markers; the
     * frontend parser must strip them without running code.
     */
    delete (globalThis as Record<string, unknown>).__ozw_frontmatter_executed;

    const parsed = parseMarkdownFrontmatter([
      '---js',
      'globalThis.__ozw_frontmatter_executed = true;',
      "module.exports = { title: 'unsafe' };",
      '---',
      '正文仍然应该可见。',
    ].join('\n'));

    assert.equal((globalThis as Record<string, unknown>).__ozw_frontmatter_executed, undefined);
    assert.equal(parsed.hasFrontmatter, true);
    assert.deepEqual(parsed.data, {});
    assert.equal(parsed.content.trim(), '正文仍然应该可见。');
  });

  it('keeps the original markdown visible when frontmatter parsing fails', () => {
    /**
     * docstring: A malformed YAML block must not blank the preview or crash the
     * chat transcript renderer.
     */
    const source = ['---', 'title: [broken', '---', '# Body'].join('\n');
    const parsed = parseMarkdownFrontmatter(source);

    assert.equal(parsed.content, source);
    assert.equal(parsed.hasFrontmatter, false);
    assert.equal(parsed.entries.length, 0);
    assert.ok(parsed.parseError);
  });
});
