/**
 * PURPOSE: Render file change events as a compact status summary with per-file rows.
 */
import React from 'react';
import type { FileChangesPayloadViewModel } from './toolPayloadParsers';

interface FileChangesContentProps {
  payload: FileChangesPayloadViewModel;
  onFileClick?: (filePath: string, diffInfo?: FileChangesPayloadViewModel['changes'][number]['diffInfo']) => void;
  formatPath?: (filePath: string) => string;
}

/**
 * Show changed files in a stable list so users can see exactly what moved and open targets directly.
 */
export const FileChangesContent: React.FC<FileChangesContentProps> = ({ payload, onFileClick, formatPath }) => {
  if (payload.changes.length === 0) {
    return null;
  }

  return (
    <div data-testid="tool-file-changes-content" className="space-y-2">
      <div className="space-y-1.5">
        {payload.changes.map((change, index) => {
          const displayPath = formatPath?.(change.path) || change.path;

          return (
            <div
              key={`${change.kind}-${change.path}-${index}`}
              className="flex items-center gap-2 border-l-2 border-amber-500 dark:border-amber-400 pl-3 py-0.5"
            >
              <span className="inline-flex rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-300 flex-shrink-0">
                {change.kind}
              </span>
              {onFileClick ? (
                <button
                  type="button"
                  onClick={() => onFileClick(change.path, change.diffInfo)}
                  className="min-w-0 truncate text-left text-[11px] font-mono text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  title={displayPath}
                >
                  {displayPath}
                </button>
              ) : (
                <span className="min-w-0 truncate text-[11px] font-mono text-gray-700 dark:text-gray-200" title={displayPath}>
                  {displayPath}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
