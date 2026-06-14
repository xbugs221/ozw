/**
 * PURPOSE: Safe frontmatter parser that only trusts YAML frontmatter.
 * Disables gray-matter's executable engines (js, javascript, json) so
 * untrusted command files cannot run code during metadata extraction.
 */
import matter from 'gray-matter';

/**
 * Parse markdown content and extract frontmatter metadata safely.
 * Only YAML frontmatter is trusted; js/javascript/json engines are disabled.
 *
 * @param {string} content - Raw markdown content
 * @returns {{data: object, content: string, excerpt?: string, isEmpty: boolean}} Parsed result
 */
export function parseFrontmatter(content: string) {
  return matter(content, {
    language: 'yaml',
    engines: {
      js: () => ({ }),
      javascript: () => ({ }),
      json: () => ({ }),
    },
  });
}
