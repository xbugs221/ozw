/**
 * PURPOSE: Defer Markdown, syntax highlighting, math, and Mermaid integration
 * until a transcript row actually needs rich text rendering.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import type { Project } from '../../../../types/app';

const MarkdownRenderer = lazy(() => import('./Markdown').then((module) => ({
  default: module.Markdown,
})));

type DeferredMarkdownProps = {
  children: ReactNode;
  className?: string;
  selectedProject?: Project | null;
  onFileOpen?: (filePath: string) => void;
};

export function Markdown({ children, className, selectedProject, onFileOpen }: DeferredMarkdownProps) {
  /** Preserve readable transcript text while the rich renderer downloads. */
  return (
    <Suspense fallback={<div className={`${className || ''} whitespace-pre-wrap break-words`} aria-busy="true">{children}</div>}>
      <MarkdownRenderer
        className={className}
        selectedProject={selectedProject}
        onFileOpen={onFileOpen}
      >
        {children}
      </MarkdownRenderer>
    </Suspense>
  );
}
