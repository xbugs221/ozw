/**
 * PURPOSE: Format filesystem paths for UI display without changing the real
 * paths used for file operations.
 */

/**
 * Normalize path separators so frontend comparisons work for POSIX and Windows
 * paths carried in provider payloads.
 */
function normalizeDisplayPath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/');
}

/**
 * Remove trailing slashes while preserving filesystem roots such as `/` and
 * `C:/`.
 */
function stripTrailingSlash(pathValue: string): string {
  const normalized = normalizeDisplayPath(pathValue).trim();
  if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/+$/g, '');
}

/**
 * Return true when a path string is absolute on POSIX or Windows.
 */
function isAbsolutePath(pathValue: string): boolean {
  return pathValue.startsWith('/') || /^[A-Za-z]:\//.test(pathValue);
}

/**
 * Display repository-contained absolute paths as repository-relative paths.
 * Paths outside the repository remain absolute so users can see the boundary.
 */
export function formatPathRelativeToProject(pathValue: string, projectRoot?: string | null): string {
  const normalizedPath = normalizeDisplayPath(String(pathValue || '').trim());
  if (!normalizedPath) {
    return '';
  }

  const normalizedRoot = stripTrailingSlash(String(projectRoot || ''));
  if (!normalizedRoot || !isAbsolutePath(normalizedPath)) {
    return normalizedPath;
  }

  const comparablePath = normalizedPath.toLowerCase();
  const comparableRoot = normalizedRoot.toLowerCase();
  if (comparablePath === comparableRoot) {
    return '.';
  }

  const rootPrefix = comparableRoot.endsWith('/') ? comparableRoot : `${comparableRoot}/`;
  if (!comparablePath.startsWith(rootPrefix)) {
    return normalizedPath;
  }

  const relativePath = normalizedPath.slice(rootPrefix.length);
  return relativePath || '.';
}

/**
 * Replace repository-rooted absolute path fragments inside labels such as
 * `in /repo/src` while leaving unrelated text untouched.
 */
export function formatPathTextRelativeToProject(text: string, projectRoot?: string | null): string {
  const normalizedRoot = stripTrailingSlash(String(projectRoot || ''));
  if (!text || !normalizedRoot) {
    return text;
  }

  const normalizedText = normalizeDisplayPath(text);
  const pathOnlyDisplay = formatPathRelativeToProject(normalizedText, normalizedRoot);
  if (pathOnlyDisplay !== normalizedText) {
    return pathOnlyDisplay;
  }

  const escapedRoot = normalizedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pathFragmentPattern = new RegExp(`${escapedRoot}(?:/[^\\s"'<>),;\\]}]*)?`, 'gi');

  return normalizedText.replace(pathFragmentPattern, (match) => {
    return formatPathRelativeToProject(match, normalizedRoot);
  });
}
