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
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const FILE_EXTENSION_PATTERN = /(?:^|[\\/])[^\\/]+\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/;

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

  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(reference)) {
    return false;
  }

  if (reference.startsWith('#') || reference.startsWith('?') || reference.startsWith('//')) {
    return true;
  }

  return URI_SCHEME_PATTERN.test(reference);
}

/**
 * Return true for POSIX or Windows absolute paths after separator normalization.
 */
function isAbsoluteWorkspacePath(pathValue: string): boolean {
  return pathValue.startsWith('/') || WINDOWS_ABSOLUTE_PATH_PATTERN.test(pathValue);
}

/**
 * Identify href values that are probably filesystem references, so unverified
 * paths do not fall through to normal browser navigation.
 */
export function isLikelyFileReferenceHref(href: string | undefined): boolean {
  const trimmedHref = String(href || '').trim();
  if (!trimmedHref) {
    return false;
  }

  const decodedHref = (() => {
    try {
      return decodeURIComponent(trimmedHref);
    } catch {
      return trimmedHref;
    }
  })();
  const { filePath } = stripLineSuffix(decodedHref);
  const normalizedFilePath = filePath.replace(/\\/g, '/');

  if (!normalizedFilePath || isBrowserLink(normalizedFilePath)) {
    return false;
  }

  return (
    isAbsoluteWorkspacePath(normalizedFilePath) ||
    normalizedFilePath.startsWith('./') ||
    normalizedFilePath.startsWith('../') ||
    normalizedFilePath.startsWith('~/') ||
    normalizedFilePath.includes('/') ||
    FILE_EXTENSION_PATTERN.test(normalizedFilePath)
  );
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
  if (isBrowserLink(decodedHref)) {
    return null;
  }

  const { filePath: rawFilePath, line, column } = stripLineSuffix(decodedHref);
  const normalizedProjectRoot = normalizePosixPath(projectRoot.replace(/\\/g, '/'));
  const normalizedFilePath = normalizePosixPath(rawFilePath.replace(/\\/g, '/'));

  if (!normalizedFilePath || normalizedFilePath === '.' || normalizedFilePath.startsWith('../')) {
    return null;
  }

  if (isAbsoluteWorkspacePath(normalizedFilePath)) {
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
