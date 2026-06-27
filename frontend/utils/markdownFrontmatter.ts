/**
 * PURPOSE: Parse Markdown frontmatter for frontend renderers without shipping
 * executable frontmatter engines into the browser bundle.
 */
import { parseDocument } from 'yaml';

export type MarkdownFrontmatterEntry = {
  key: string;
  value: string;
  rawValue: unknown;
};

export type ParsedMarkdownFrontmatter = {
  content: string;
  data: Record<string, unknown>;
  entries: MarkdownFrontmatterEntry[];
  hasFrontmatter: boolean;
  parseError: string | null;
};

type FrontmatterBlock = {
  language: string;
  matter: string;
  content: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  /**
   * docstring: Keep parsed frontmatter data object-shaped before the renderer
   * turns it into key/value rows.
   */
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringifyStructuredValue(value: unknown): string {
  /**
   * docstring: Render nested metadata compactly while avoiding renderer crashes
   * from unexpected circular or non-JSON values.
   */
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatFrontmatterValue(value: unknown): string {
  /**
   * docstring: Convert YAML frontmatter values into predictable one-line text
   * for the compact metadata block.
   */
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().replace(/T00:00:00\.000Z$/, '');
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => (isRecord(item) || Array.isArray(item) ? stringifyStructuredValue(item) : String(item)))
      .join(', ');
  }

  if (isRecord(value)) {
    return stringifyStructuredValue(value);
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function extractFrontmatterBlock(content: string): FrontmatterBlock | null {
  /**
   * docstring: Detect a leading Markdown frontmatter block and split it from
   * the body while preserving normal markdown that has no closing delimiter.
   */
  const source = content.replace(/^\uFEFF/, '');
  const lines = source.split(/\r?\n/);
  const openMatch = /^---(?:\s*([A-Za-z0-9_-]+))?\s*$/.exec(lines[0] || '');
  if (!openMatch) {
    return null;
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  if (closingIndex < 0) {
    return null;
  }

  return {
    language: (openMatch[1] || 'yaml').toLowerCase(),
    matter: lines.slice(1, closingIndex).join('\n'),
    content: lines.slice(closingIndex + 1).join('\n'),
  };
}

function parseYamlFrontmatter(matter: string): Record<string, unknown> {
  /**
   * docstring: Parse YAML metadata into a plain object and surface syntax
   * errors to the caller so renderers can fall back to original markdown.
   */
  const document = parseDocument(matter, { prettyErrors: false });
  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => error.message).join('; '));
  }

  const parsed = document.toJSON();
  return isRecord(parsed) ? parsed : {};
}

export function parseMarkdownFrontmatter(content: string): ParsedMarkdownFrontmatter {
  /**
   * docstring: Safely parse only YAML frontmatter and return the markdown body
   * that should continue through the existing React Markdown renderer.
   */
  const frontmatterBlock = extractFrontmatterBlock(content);
  if (!frontmatterBlock) {
    return {
      content,
      data: {},
      entries: [],
      hasFrontmatter: false,
      parseError: null,
    };
  }

  if (frontmatterBlock.language !== 'yaml' && frontmatterBlock.language !== 'yml') {
    return {
      content: frontmatterBlock.content,
      data: {},
      entries: [],
      hasFrontmatter: true,
      parseError: null,
    };
  }

  try {
    const data = parseYamlFrontmatter(frontmatterBlock.matter);
    const entries = Object.entries(data).map(([key, rawValue]) => ({
      key,
      value: formatFrontmatterValue(rawValue),
      rawValue,
    }));

    return {
      content: frontmatterBlock.content,
      data,
      entries,
      hasFrontmatter: true,
      parseError: null,
    };
  } catch (error) {
    return {
      content,
      data: {},
      entries: [],
      hasFrontmatter: false,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}
