/**
 * PURPOSE: Render compact tool rows, including terminal commands that need to
 * preserve their original multiline formatting.
 */

import React, { useState } from 'react';
import { copyTextToClipboard } from '../../../../utils/clipboard';

type ActionType = 'copy' | 'open-file' | 'jump-to-results' | 'none';

interface OneLineDisplayProps {
  toolName: string;
  icon?: string;
  label?: string;
  value: string;
  displayValue?: string;
  secondary?: string;
  action?: ActionType;
  onAction?: () => void;
  style?: string;
  wrapText?: boolean;
  colorScheme?: {
    primary?: string;
    secondary?: string;
    background?: string;
    border?: string;
    icon?: string;
  };
  resultId?: string;
  toolResult?: any;
  toolId?: string;
}

/**
 * Unified one-line display for simple tool inputs and results
 * Used by: Bash, Read, Grep/Glob (minimized), TodoRead, etc.
 */
export const OneLineDisplay: React.FC<OneLineDisplayProps> = ({
  toolName,
  icon,
  label,
  value,
  displayValue,
  secondary,
  action = 'none',
  onAction,
  style,
  wrapText = false,
  colorScheme = {
    primary: 'text-gray-700 dark:text-gray-300',
    secondary: 'text-gray-500 dark:text-gray-400',
    background: '',
    border: 'border-gray-300 dark:border-gray-600',
    icon: 'text-gray-500 dark:text-gray-400'
  },
  toolResult,
  toolId
}) => {
  const [copied, setCopied] = useState(false);
  const isTerminal = style === 'terminal';
  const resultAnchorId = toolId ? `tool-result-${String(toolId).replace(/[^A-Za-z0-9_-]/g, '-')}` : undefined;
  const visibleValue = displayValue || value;

  const handleAction = async () => {
    if (action === 'copy' && value) {
      const didCopy = await copyTextToClipboard(value);
      if (!didCopy) {
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else if (onAction) {
      onAction();
    }
  };

  const renderCopyButton = () => (
    <button
      onClick={handleAction}
      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all ml-1 flex-shrink-0"
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
    >
      {copied ? (
        <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );

  // Terminal style: dark pill only around the command
  if (isTerminal) {
    return (
      <div className="group my-1">
        <div className="flex items-start gap-2">
          <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
            <svg className="w-3 h-3 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0 flex items-start gap-2">
            <div className="bg-gray-900 dark:bg-black rounded px-2.5 py-1 flex-1 min-w-0">
              <code className={`text-xs text-green-400 font-mono ${wrapText ? 'whitespace-pre-wrap break-all' : 'block truncate'}`}>
                <span className="text-green-600 dark:text-green-500 select-none">$ </span>
                <span className="text-green-400 dark:text-green-300">{visibleValue}</span>
              </code>
            </div>
            {action === 'copy' && renderCopyButton()}
          </div>
        </div>
        {secondary && (
          <div id={resultAnchorId} className="ml-7 mt-1">
            <span className="text-[11px] text-gray-400 dark:text-gray-500 italic">
              {secondary}
            </span>
          </div>
        )}
      </div>
    );
  }

  // File open style - show full file path (not just basename) so Read/Edit/etc
  // cards display the complete path users need to verify.
  // Only show the label prefix when explicitly configured (e.g. Read cards
  // no longer display the tool group name as a prefix).
  if (action === 'open-file') {
    const hasLabel = typeof label === 'string' && label.length > 0;
    return (
      <div className={`group flex items-center gap-1.5 border-l-2 ${colorScheme.border} pl-3 py-0.5 my-0.5`}>
        {hasLabel && (
          <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{label}</span>
        )}
        {hasLabel && (
          <span className="text-gray-300 dark:text-gray-600 text-[10px]">/</span>
        )}
        <button
          onClick={handleAction}
          className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-mono hover:underline transition-colors truncate"
          title={visibleValue}
        >
          {visibleValue}
        </button>
      </div>
    );
  }

  // Search / jump-to-results style
  if (action === 'jump-to-results') {
    return (
      <div className={`group flex items-center gap-1.5 border-l-2 ${colorScheme.border} pl-3 py-0.5 my-0.5`}>
        <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{label || toolName}</span>
        <span className="text-gray-300 dark:text-gray-600 text-[10px]">/</span>
        <span className={`text-xs font-mono truncate flex-1 min-w-0 ${colorScheme.primary}`}>
          {visibleValue}
        </span>
        {secondary && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500 italic flex-shrink-0">
            {secondary}
          </span>
        )}
        {toolResult && toolId && (
          <a
            href={`#tool-result-${toolId}`}
            className="flex-shrink-0 text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors flex items-center gap-0.5"
            onClick={(event) => {
              event.preventDefault();
              const targetEl = document.getElementById(`tool-result-${toolId}`);
              if (targetEl) {
                // Expand the closest <details> so the anchor-jump makes output visible.
                const details =
                  targetEl.closest('details') ||
                  (targetEl.tagName === 'DETAILS' ? (targetEl as HTMLDetailsElement) : null);
                if (details && !(details as HTMLDetailsElement).open) {
                  const summary = details.querySelector('summary');
                  if (summary) (summary as HTMLElement).click();
                }
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </a>
        )}
      </div>
    );
  }

  // Default one-line style
  return (
    <div className={`group flex items-center gap-1.5 ${colorScheme.background || ''} border-l-2 ${colorScheme.border} pl-3 py-0.5 my-0.5`}>
      {icon && icon !== 'terminal' && (
        <span className={`${colorScheme.icon} flex-shrink-0 text-xs`}>{icon}</span>
      )}
      {!icon && (label || toolName) && (
        <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">{label || toolName}</span>
      )}
      {(icon || label || toolName) && (
        <span className="text-gray-300 dark:text-gray-600 text-[10px]">/</span>
      )}
      <span className={`text-xs font-mono ${wrapText ? 'whitespace-pre-wrap break-all' : 'truncate'} flex-1 min-w-0 ${colorScheme.primary}`}>
        {visibleValue}
      </span>
      {secondary && (
        <span className={`text-[11px] ${colorScheme.secondary} italic flex-shrink-0`}>
          {secondary}
        </span>
      )}
      {action === 'copy' && renderCopyButton()}
    </div>
  );
};
