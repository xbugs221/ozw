/**
 * PURPOSE: Render chat markdown with code blocks and optional workspace-file
 * link interception for assistant replies inside the active project.
 */
import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTranslation } from 'react-i18next';
import { normalizeChatMarkdownFences } from '../../utils/chatFormatting';
import { copyTextToClipboard } from '../../../../utils/clipboard';
import type { Project } from '../../../../types/app';
import { isLikelyFileReferenceHref, parseWorkspaceFileReference } from '../../utils/workspaceLinks';
import { api } from '../../../../utils/api';
import { parseMarkdownFrontmatter } from '../../../../utils/markdownFrontmatter';
import type { ProjectFileNode } from '../../utils/fileMentionTree';
import { MarkdownFrontmatterBlock } from '../../../markdown/MarkdownFrontmatterBlock';
import MarkdownMermaidBlock from '../../../code-editor/view/subcomponents/markdown/MarkdownMermaidBlock';

type MarkdownProps = {
  children: React.ReactNode;
  className?: string;
  selectedProject?: Project | null;
  onFileOpen?: (filePath: string) => void;
};

type CodeBlockProps = {
  node?: any;
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
};

type OpenableFileState = {
  projectKey: string;
  files: Set<string>;
};

const UNOPENABLE_LINK_MARKER = 'ozw-unopenable-link';

const LARGE_CODE_BLOCK_LINE_THRESHOLD = 80;
const LARGE_CODE_BLOCK_CHAR_THRESHOLD = 8_000;
const LARGE_CODE_BLOCK_PREVIEW_LINES = 12;

/**
 * Flatten the project file tree into normalized file paths only.
 */
function collectOpenableFilePaths(files: ProjectFileNode[], basePath = ''): Set<string> {
  const paths = new Set<string>();

  files.forEach((file) => {
    const fullPath = basePath ? `${basePath}/${file.name}` : file.name;
    if (file.type === 'directory') {
      collectOpenableFilePaths(file.children || [], fullPath).forEach((path) => paths.add(path));
      return;
    }

    if (file.type === 'file') {
      paths.add((file.path || fullPath).replace(/\\/g, '/'));
      paths.add(fullPath.replace(/\\/g, '/'));
    }
  });

  return paths;
}

/**
 * Degrade markdown links with whitespace-only plain destinations into labels.
 */
function normalizeUnopenableMarkdownLinks(content: string): string {
  return content.replace(
    /\[([^\]\n]+)\]\(([^)\n]*\s[^)\n]*)\)/g,
    (_match, label: string) => `[${label}](${UNOPENABLE_LINK_MARKER})`,
  );
}

const CodeBlock = ({ node, inline, className, children, ...props }: CodeBlockProps) => {
  const { t } = useTranslation('chat');
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const raw = Array.isArray(children) ? children.join('') : String(children ?? '');
  const looksMultiline = /[\r\n]/.test(raw);
  const inlineDetected = inline || (node && node.type === 'inlineCode');
  const shouldInline = inlineDetected || !looksMultiline;

  if (shouldInline) {
    return (
      <code
        className={`font-mono text-[0.9em] px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-900 border border-gray-200 dark:bg-gray-800/60 dark:text-gray-100 dark:border-gray-700 whitespace-pre-wrap break-words ${className || ''
          }`}
        {...props}
      >
        {children}
      </code>
    );
  }

  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1].toLowerCase() : 'text';
  const lines = raw.split(/\r?\n/);
  const isLargeCodeBlock = lines.length > LARGE_CODE_BLOCK_LINE_THRESHOLD || raw.length > LARGE_CODE_BLOCK_CHAR_THRESHOLD;

  if (language === 'mermaid') {
    return <MarkdownMermaidBlock source={raw} isDarkMode={false} />;
  }

  if (isLargeCodeBlock && !expanded) {
    const preview = lines.slice(0, LARGE_CODE_BLOCK_PREVIEW_LINES).join('\n');
    return (
      <div className="my-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
          <span className="font-mono uppercase">{language}</span>
          <span>{lines.length} lines</span>
        </div>
        <pre
          data-testid="large-code-block-summary"
          className="max-h-56 overflow-hidden p-3 text-xs font-mono whitespace-pre-wrap break-words text-gray-700 dark:text-gray-200"
        >
          {preview}
        </pre>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="border-t border-gray-200 dark:border-gray-700 px-3 py-2 text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          Show full code
        </button>
      </div>
    );
  }

  return (
    <div className="relative group my-2">
      {language && language !== 'text' && (
        <div className="absolute top-2 left-3 z-10 text-xs text-gray-400 font-medium uppercase">{language}</div>
      )}

      <button
        type="button"
        onClick={() =>
          copyTextToClipboard(raw).then((success) => {
            if (success) {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          })
        }
        className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 focus:opacity-100 active:opacity-100 transition-opacity text-xs px-2 py-1 rounded-md bg-gray-700/80 hover:bg-gray-700 text-white border border-gray-600"
        title={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
        aria-label={copied ? t('codeBlock.copied') : t('codeBlock.copyCode')}
      >
        {copied ? (
          <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {t('codeBlock.copied')}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
            </svg>
            {t('codeBlock.copy')}
          </span>
        )}
      </button>

      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          padding: language && language !== 'text' ? '2rem 1rem 1rem 1rem' : '1rem',
        }}
        codeTagProps={{
          style: {
            fontFamily:
              'ui-monospace, "GitLab Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          },
        }}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
};

/**
 * Build markdown component overrides around the current workspace routing context.
 */
function createMarkdownComponents(
  selectedProject: Project | null | undefined,
  onFileOpen?: (filePath: string) => void,
  openableFiles?: Set<string>,
) {
  return {
    code: CodeBlock,
    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400 my-2">
        {children}
      </blockquote>
    ),
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      if (href === UNOPENABLE_LINK_MARKER) {
        return <span>{children}</span>;
      }

      /**
       * Reuse the editor sidebar open flow for recognized workspace file links.
       */
      const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
        const workspaceLink = parseWorkspaceFileReference(href, selectedProject);
        if (!workspaceLink || !onFileOpen || !openableFiles?.has(workspaceLink.filePath)) {
          return;
        }

        event.preventDefault();
        onFileOpen(workspaceLink.filePath);
      };

      const workspaceLink = parseWorkspaceFileReference(href, selectedProject);
      const isKnownOpenableFile = Boolean(workspaceLink && openableFiles?.has(workspaceLink.filePath));
      const shouldIntercept = Boolean(isKnownOpenableFile && onFileOpen);

      if (workspaceLink && !isKnownOpenableFile) {
        return <span>{children}</span>;
      }

      if (!workspaceLink && isLikelyFileReferenceHref(href)) {
        return <span>{children}</span>;
      }

      return (
        <a
          href={href}
          className="text-blue-600 dark:text-blue-400 hover:underline"
          target={shouldIntercept ? undefined : '_blank'}
          rel={shouldIntercept ? undefined : 'noopener noreferrer'}
          onClick={handleClick}
        >
          {children}
        </a>
      );
    },
    p: ({ children }: { children?: React.ReactNode }) => <div className="mb-2 last:mb-0">{children}</div>,
    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="overflow-x-auto my-2">
        <table className="min-w-full border-collapse border border-gray-200 dark:border-gray-700">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => <thead className="bg-gray-50 dark:bg-gray-800">{children}</thead>,
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="px-3 py-2 text-left text-sm font-semibold border border-gray-200 dark:border-gray-700">{children}</th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="px-3 py-2 align-top text-sm border border-gray-200 dark:border-gray-700">{children}</td>
    ),
  };
}

export function Markdown({ children, className, selectedProject, onFileOpen }: MarkdownProps) {
  const parsedFrontmatter = useMemo(() => parseMarkdownFrontmatter(String(children ?? '')), [children]);
  const content = normalizeUnopenableMarkdownLinks(normalizeChatMarkdownFences(parsedFrontmatter.content));
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);
  const projectKey = `${selectedProject?.name || ''}:${selectedProject?.fullPath || selectedProject?.path || ''}`;
  const [openableFileState, setOpenableFileState] = useState<OpenableFileState>({
    projectKey: '',
    files: new Set(),
  });

  useEffect(() => {
    if (!selectedProject?.name || !onFileOpen) {
      setOpenableFileState({ projectKey: '', files: new Set() });
      return;
    }

    const abortController = new AbortController();
    const projectPath = selectedProject.fullPath || selectedProject.path || '';

    const loadOpenableFiles = async () => {
      try {
        const response = await api.getFiles(selectedProject.name, {
          projectPath,
          showHidden: false,
          signal: abortController.signal,
        });
        if (!response.ok) {
          setOpenableFileState({ projectKey, files: new Set() });
          return;
        }

        const files = (await response.json()) as ProjectFileNode[];
        setOpenableFileState({ projectKey, files: collectOpenableFilePaths(files) });
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') {
          return;
        }
        setOpenableFileState({ projectKey, files: new Set() });
      }
    };

    void loadOpenableFiles();
    return () => abortController.abort();
  }, [onFileOpen, projectKey, selectedProject?.name, selectedProject?.path, selectedProject?.fullPath]);

  const markdownComponents = useMemo(
    () => createMarkdownComponents(
      selectedProject,
      onFileOpen,
      openableFileState.projectKey === projectKey ? openableFileState.files : new Set(),
    ),
    [onFileOpen, openableFileState, projectKey, selectedProject],
  );

  return (
    <div className={className}>
      <MarkdownFrontmatterBlock entries={parsedFrontmatter.entries} />
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={markdownComponents as any}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
