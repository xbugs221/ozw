/**
 * PURPOSE: Parse assistant markdown href values into selected-project workspace
 * file opens without broadening interception to unrelated browser links.
 */

import type { Project } from '../../../types/app';

export type WorkspaceFileReference = {
  filePath: string;
  line?: number;
  column?: number;
};

const HASH_LINE_SUFFIX_PATTERN = /#L(\d+)(?:C(\d+))?$/i;
const COLON_LINE_SUFFIX_PATTERN = /:(\d+)(?::(\d+))?$/;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Remove supported line suffixes while preserving the normalized workspace path.
 */
function stripLineSuffix(reference: string): WorkspaceFileReference {
  const hashMatch = reference.match(HASH_LINE_SUFFIX_PATTERN);

  if (hashMatch) {
    return {
      filePath: reference.slice(0, -hashMatch[0].length),
      line: Number.parseInt(hashMatch[1], 10),
      column: hashMatch[2] ? Number.parseInt(hashMatch[2], 10) : undefined,
    };
  }

  const colonMatch = reference.match(COLON_LINE_SUFFIX_PATTERN);
  if (colonMatch) {
    const basePath = reference.slice(0, -colonMatch[0].length);
    if (basePath.includes('/')) {
      return {
        filePath: basePath,
        line: Number.parseInt(colonMatch[1], 10),
        column: colonMatch[2] ? Number.parseInt(colonMatch[2], 10) : undefined,
      };
    }
  }

  return { filePath: reference };
}

/**
 * Collapse "." and ".." path segments using POSIX semantics for workspace paths.
 */
function normalizePosixPath(inputPath: string): string {
  const isAbsolute = inputPath.startsWith('/');
  const segments = inputPath.split('/');
  const normalizedSegments: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (normalizedSegments.length > 0) {
        normalizedSegments.pop();
        continue;
      }

      if (!isAbsolute) {
        normalizedSegments.push('..');
      }
      continue;
    }

    normalizedSegments.push(segment);
  }

  const normalizedPath = normalizedSegments.join('/');
  if (isAbsolute) {
    return `/${normalizedPath}`;
  }

  return normalizedPath || '.';
}

/**
 * Guard browser-controlled links so only plain workspace file references are intercepted.
 */
function isBrowserLink(reference: string): boolean {
  if (!reference) {
    return true;
  }

  if (reference.startsWith('#') || reference.startsWith('?') || reference.startsWith('//')) {
    return true;
  }

  return URI_SCHEME_PATTERN.test(reference);
}

/**
 * Convert a candidate href into a project-relative workspace path when it stays
 * inside the currently selected project root.
 */
export function parseWorkspaceFileReference(
  href: string | undefined,
  selectedProject: Project | null | undefined,
): WorkspaceFileReference | null {
  const projectRoot = selectedProject?.fullPath || selectedProject?.path || '';
  if (!href || !projectRoot) {
    return null;
  }

  const trimmedHref = href.trim();
  if (!trimmedHref || isBrowserLink(trimmedHref)) {
    return null;
  }

  const decodedHref = (() => {
    try {
      return decodeURIComponent(trimmedHref);
    } catch {
      return trimmedHref;
    }
  })();

  const { filePath: rawFilePath, line, column } = stripLineSuffix(decodedHref);
  const normalizedProjectRoot = normalizePosixPath(projectRoot.replace(/\\/g, '/'));
  const normalizedFilePath = normalizePosixPath(rawFilePath.replace(/\\/g, '/'));

  if (!normalizedFilePath || normalizedFilePath === '.' || normalizedFilePath.startsWith('../')) {
    return null;
  }

  if (normalizedFilePath.startsWith('/')) {
    if (
      normalizedFilePath !== normalizedProjectRoot &&
      !normalizedFilePath.startsWith(`${normalizedProjectRoot}/`)
    ) {
      return null;
    }

    const relativePath = normalizedFilePath.slice(normalizedProjectRoot.length).replace(/^\/+/, '');
    if (!relativePath) {
      return null;
    }

    return { filePath: relativePath, line, column };
  }

  return { filePath: normalizedFilePath, line, column };
}
