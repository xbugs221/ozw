// PURPOSE: Render chat tool output in an accessible collapsible details section.
import React, { useState } from 'react';
import { flushSync } from 'react-dom';

interface CollapsibleSectionProps {
  title: string;
  toolName?: string;
  open?: boolean;
  action?: React.ReactNode;
  onTitleClick?: () => void;
  children: React.ReactNode;
  className?: string;
  wrapTitle?: boolean;
  detailsId?: string;
}

/**
 * Reusable collapsible section with consistent styling
 */
export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  toolName,
  open = false,
  action,
  onTitleClick,
  children,
  className = '',
  wrapTitle = false,
  detailsId,
}) => {
  const [isOpen, setIsOpen] = useState(open);
  const titleClassName = wrapTitle
    ? 'text-gray-600 dark:text-gray-400 flex-1 min-w-0 whitespace-normal break-words'
    : 'text-gray-600 dark:text-gray-400 truncate flex-1';
  const openButtonClassName = 'text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-mono hover:underline flex-shrink-0';

  return (
    <div className={`relative ${className}`}>
      <details
        id={detailsId}
        className="relative group/details"
        open={isOpen}
        onToggle={(event) => flushSync(() => setIsOpen(event.currentTarget.open))}
      >
        <summary className="flex items-center gap-1.5 text-xs cursor-pointer py-0.5 pr-12 select-none group-open/details:sticky group-open/details:top-0 group-open/details:z-10 group-open/details:bg-background group-open/details:-mx-1 group-open/details:px-1">
          <svg
            className="w-3 h-3 text-gray-400 dark:text-gray-500 transition-transform duration-150 group-open/details:rotate-90 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          {toolName && (
            <span className="font-medium text-gray-500 dark:text-gray-400 flex-shrink-0">{toolName}</span>
          )}
          {toolName && title && (
            <span className="text-gray-300 dark:text-gray-600 text-[10px] flex-shrink-0">/</span>
          )}
          {title ? (
            <span className={titleClassName}>
              {title}
            </span>
          ) : null}
        </summary>
        {isOpen && (
          <div className="mt-1.5 pl-[18px]" data-testid="collapsible-lazy-content">
            {children}
          </div>
        )}
      </details>
      {(onTitleClick || action) && (
        <div className="absolute right-0 top-0 z-20 flex items-center gap-1">
          {onTitleClick && (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onTitleClick();
              }}
              className={openButtonClassName}
              aria-label={`Open ${title}`}
            >
              open
            </button>
          )}
          {action && <span className="flex-shrink-0">{action}</span>}
        </div>
      )}
    </div>
  );
};
