import React, { useMemo, useState } from 'react';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
  filePath: string;
  displayFilePath?: string;
  createDiff: (oldStr: string, newStr: string) => DiffLine[];
  onFileClick?: () => void;
  badge?: string;
  badgeColor?: 'gray' | 'green';
}

const LARGE_DIFF_CHAR_THRESHOLD = 12_000;
const LARGE_DIFF_LINE_THRESHOLD = 180;
const LARGE_DIFF_PREVIEW_LINES = 24;

/**
 * Compact diff viewer — VS Code-style
 */
export const DiffViewer: React.FC<DiffViewerProps> = ({
  oldContent = '',
  newContent = '',
  filePath,
  displayFilePath,
  createDiff,
  onFileClick,
  badge = 'Diff',
  badgeColor = 'gray'
}) => {
  const [expanded, setExpanded] = useState(false);
  const badgeClasses = badgeColor === 'green'
    ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400';
  const visibleFilePath = displayFilePath || filePath;

  const oldLineCount = oldContent.split(/\r?\n/).length;
  const newLineCount = newContent.split(/\r?\n/).length;
  const isLargeDiff = oldContent.length + newContent.length > LARGE_DIFF_CHAR_THRESHOLD ||
    oldLineCount + newLineCount > LARGE_DIFF_LINE_THRESHOLD;

  const diffLines = useMemo(() => {
    /**
     * Large diffs stay summarized until the user expands so createDiff does not
     * run during collapsed transcript rendering.
     */
    if (isLargeDiff && !expanded) {
      return [];
    }
    return createDiff(oldContent, newContent);
  }, [createDiff, expanded, isLargeDiff, oldContent, newContent]);

  const previewLines = useMemo(() => {
    if (!isLargeDiff || expanded) {
      return [];
    }
    return newContent.split(/\r?\n/).slice(0, LARGE_DIFF_PREVIEW_LINES);
  }, [expanded, isLargeDiff, newContent]);

  return (
    <div className="border border-gray-200/60 dark:border-gray-700/50 rounded overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1 bg-gray-50/80 dark:bg-gray-800/40 border-b border-gray-200/60 dark:border-gray-700/50">
        {onFileClick ? (
          <button
            onClick={onFileClick}
            className="text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 truncate cursor-pointer transition-colors"
          >
            {visibleFilePath}
          </button>
        ) : (
          <span className="text-[11px] font-mono text-gray-600 dark:text-gray-400 truncate">
            {visibleFilePath}
          </span>
        )}
        <span className={`text-[10px] font-medium px-1.5 py-px rounded ${badgeClasses} flex-shrink-0 ml-2`}>
          {badge}
        </span>
      </div>

      {/* Diff lines */}
      <div className="text-[11px] font-mono leading-[18px]">
        {isLargeDiff && !expanded ? (
          <div data-testid="large-diff-summary" className="bg-gray-50/70 dark:bg-gray-900/30">
            <div className="px-2 py-1 text-gray-500 dark:text-gray-400">
              Large diff: {oldLineCount} {'->'} {newLineCount} lines
            </div>
            {previewLines.map((line, i) => (
              <div key={i} className="px-2 whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                {line}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="px-2 py-1 text-blue-600 dark:text-blue-400 hover:underline"
            >
              Show full diff
            </button>
          </div>
        ) : diffLines.map((diffLine, i) => (
          <div key={i} className="flex">
            <span
              className={`w-6 text-center select-none flex-shrink-0 ${
                diffLine.type === 'removed'
                  ? 'bg-red-50 dark:bg-red-950/30 text-red-400 dark:text-red-500'
                  : 'bg-green-50 dark:bg-green-950/30 text-green-400 dark:text-green-500'
              }`}
            >
              {diffLine.type === 'removed' ? '-' : '+'}
            </span>
            <span
              className={`px-2 flex-1 whitespace-pre-wrap ${
                diffLine.type === 'removed'
                  ? 'bg-red-50/50 dark:bg-red-950/20 text-red-800 dark:text-red-200'
                  : 'bg-green-50/50 dark:bg-green-950/20 text-green-800 dark:text-green-200'
              }`}
            >
              {diffLine.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
