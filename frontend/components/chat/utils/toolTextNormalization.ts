/**
 * PURPOSE: Share tool-output text normalization across chat render paths.
 * Tool cards must drop transport-only blank padding without changing command or code indentation.
 */

/**
 * Trim leading and trailing blank lines while preserving whitespace on nonblank lines.
 */
export function trimOuterBlankLines(text: string): string {
  const lines = text.split('\n');
  let start = 0;
  while (start < lines.length && lines[start].trim() === '') start++;
  let end = lines.length - 1;
  while (end > start && lines[end].trim() === '') end--;
  return lines.slice(start, end + 1).join('\n');
}
