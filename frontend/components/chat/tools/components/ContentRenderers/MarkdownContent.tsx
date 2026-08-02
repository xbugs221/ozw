/**
 * PURPOSE: Render tool-result Markdown through the shared deferred rich-text boundary.
 */
import React from 'react';
import { Markdown } from '../../../view/subcomponents/DeferredMarkdown';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

/**
 * Renders markdown content with proper styling
 * Used by: exit_plan_mode, long text results, etc.
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  className = 'mt-1 prose prose-sm max-w-none dark:prose-invert'
}) => {
  /** Preserve the existing tool-card layout while delegating rich rendering. */
  return (
    <Markdown className={className}>
      {content}
    </Markdown>
  );
};
