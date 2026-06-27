/**
 * PURPOSE: Render parsed Markdown frontmatter as compact metadata rows shared
 * by chat Markdown and workspace Markdown previews.
 */
import type { MarkdownFrontmatterEntry } from '../../utils/markdownFrontmatter';

type MarkdownFrontmatterBlockProps = {
  entries: MarkdownFrontmatterEntry[];
  className?: string;
};

export function MarkdownFrontmatterBlock({ entries, className = '' }: MarkdownFrontmatterBlockProps) {
  /**
   * docstring: Keep empty or unsupported frontmatter blocks invisible while
   * rendering parsed key/value metadata in a stable, wrapping layout.
   */
  if (entries.length === 0) {
    return null;
  }

  return (
    <div
      aria-label="Markdown frontmatter"
      data-testid="markdown-frontmatter"
      className={`mb-3 overflow-hidden rounded-md border border-gray-200 bg-gray-50 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-200 ${className}`}
    >
      {entries.map((entry) => (
        <div
          key={entry.key}
          className="grid grid-cols-1 gap-1 border-b border-gray-200 px-3 py-2 last:border-b-0 dark:border-gray-700 sm:grid-cols-[minmax(6rem,12rem)_1fr]"
        >
          <div className="font-medium text-gray-500 dark:text-gray-400">{entry.key}</div>
          <div className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-gray-800 dark:text-gray-100">
            {entry.value}
          </div>
        </div>
      ))}
    </div>
  );
}
