import React, { useMemo, useState } from 'react';

interface TextContentProps {
  content: string;
  format?: 'plain' | 'json' | 'code';
  className?: string;
  maxLines?: number;
}

const LARGE_TEXT_LINE_THRESHOLD = 120;
const LARGE_TEXT_CHAR_THRESHOLD = 10_000;
const LARGE_TEXT_PREVIEW_LINES = 20;

/**
 * Renders plain text, JSON, or code content
 * Used by: Raw parameters, generic text results, JSON responses
 */
export const TextContent: React.FC<TextContentProps> = ({
  content,
  format = 'plain',
  className = '',
  maxLines
}) => {
  const [expanded, setExpanded] = useState(false);

  const lineState = useMemo(() => {
    const lines = content.split('\n');
    const effectiveMaxLines = maxLines || LARGE_TEXT_PREVIEW_LINES;
    const isLargeContent = lines.length > LARGE_TEXT_LINE_THRESHOLD || content.length > LARGE_TEXT_CHAR_THRESHOLD;
    const shouldTruncate = Boolean((maxLines && maxLines > 0 && lines.length > maxLines) || isLargeContent);
    const visible = shouldTruncate && !expanded
      ? lines.slice(0, effectiveMaxLines).join('\n')
      : content;
    return {
      lines,
      effectiveMaxLines,
      isLargeContent,
      shouldTruncate,
      visible
    };
  }, [content, expanded, maxLines]);

  if (format === 'json') {
    if (lineState.isLargeContent && !expanded) {
      return (
        <div className={className}>
          <pre
            data-testid="large-tool-output-summary"
            className="mt-1 text-xs bg-gray-900 dark:bg-gray-950 text-gray-100 p-2.5 rounded overflow-hidden font-mono whitespace-pre-wrap"
          >
            {lineState.visible}
          </pre>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="mt-1 text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
          >
            Show full output
          </button>
        </div>
      );
    }

    let formattedJson = content;
    try {
      const parsed = JSON.parse(content);
      formattedJson = JSON.stringify(parsed, null, 2);
    } catch (e) {
      // If parsing fails, use original content
    }

    return (
      <pre className={`mt-1 text-xs bg-gray-900 dark:bg-gray-950 text-gray-100 p-2.5 rounded overflow-x-auto font-mono ${className}`}>
        {formattedJson}
      </pre>
    );
  }

  if (format === 'code') {
    return (
      <div className={className}>
        <pre
          data-testid={lineState.isLargeContent && !expanded ? 'large-tool-output-summary' : undefined}
          className="mt-1 text-xs bg-gray-50 dark:bg-gray-800/50 border border-gray-200/50 dark:border-gray-700/50 p-2 rounded whitespace-pre-wrap break-words overflow-hidden text-gray-700 dark:text-gray-300 font-mono"
        >
          {lineState.visible}
        </pre>
        {lineState.shouldTruncate && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
          >
            {expanded ? 'Show less' : `Show ${lineState.lines.length - lineState.effectiveMaxLines} more lines`}
          </button>
        )}
      </div>
    );
  }

  // Plain text
  return (
    <div className={className}>
      <div
        data-testid={lineState.isLargeContent && !expanded ? 'large-tool-output-summary' : undefined}
        className="mt-1 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap"
      >
        {lineState.visible}
      </div>
      {lineState.shouldTruncate && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          {expanded ? 'Show less' : `Show ${lineState.lines.length - lineState.effectiveMaxLines} more lines`}
        </button>
      )}
    </div>
  );
};
