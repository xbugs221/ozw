/**
 * PURPOSE: Decide whether an unmatched GET route should load the React shell.
 */
import path from 'path';

/**
 * Return true when a request is a browser navigation that should receive
 * index.html, including workflow routes whose run ids contain dots.
 */
export function shouldServeSpaIndex(req: { path?: string; headers?: { accept?: string } }) {
  const requestPath = String(req?.path || '');
  const acceptHeader = String(req?.headers?.accept || '');
  const acceptsHtml = acceptHeader.includes('text/html');
  const hasExtension = Boolean(path.extname(requestPath));

  if (!hasExtension) {
    return true;
  }

  if (acceptsHtml) {
    return true;
  }

  return false;
}
