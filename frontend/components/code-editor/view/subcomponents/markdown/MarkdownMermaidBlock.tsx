/**
 * PURPOSE: Render Mermaid fenced code blocks inside the workspace markdown
 * preview while isolating parse failures to the current block.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';

type MarkdownMermaidBlockProps = {
  source: string;
  isDarkMode: boolean;
};

const FALLBACK_MESSAGE = 'Unable to render Mermaid diagram.';

let initializedTheme: 'default' | 'dark' | null = null;
let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;

/**
 * PURPOSE: Load Mermaid only when a markdown preview actually needs diagram
 * rendering so the main application bundle stays smaller.
 */
async function loadMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid');
  }

  return (await mermaidModulePromise).default;
}

/**
 * PURPOSE: Keep Mermaid global initialization aligned with the current theme.
 */
async function ensureMermaidInitialized(isDarkMode: boolean) {
  const nextTheme = isDarkMode ? 'dark' : 'default';
  const mermaid = await loadMermaid();

  if (initializedTheme === nextTheme) {
    return mermaid;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: nextTheme,
  });
  initializedTheme = nextTheme;
  return mermaid;
}

export default function MarkdownMermaidBlock({
  source,
  isDarkMode,
}: MarkdownMermaidBlockProps) {
  const [svg, setSvg] = useState('');
  const [error, setError] = useState<string | null>(null);
  const renderedDiagramRef = useRef<HTMLDivElement | null>(null);
  const instanceId = useId();
  const diagramId = useMemo(
    () => `ozw-mermaid-${instanceId.replace(/[:]/g, '-')}`,
    [instanceId],
  );
  const normalizedSource = useMemo(() => source.trimEnd(), [source]);
  const fallbackSource = useMemo(
    () => normalizedSource.split('\n').map((line) => line.trimStart()).join('\n'),
    [normalizedSource],
  );
  const fallbackSourceLines = useMemo(
    () => fallbackSource.split('\n'),
    [fallbackSource],
  );

  useEffect(() => {
    let active = true;

    /**
     * PURPOSE: Render the current Mermaid source to SVG without breaking the
     * surrounding markdown preview when parsing fails.
     */
    async function renderDiagram() {
      try {
        const mermaid = await ensureMermaidInitialized(isDarkMode);
        const { svg: nextSvg, bindFunctions } = await mermaid.render(diagramId, normalizedSource);

        if (!active) {
          return;
        }

        setSvg(nextSvg);
        setError(null);

        if (renderedDiagramRef.current && typeof bindFunctions === 'function') {
          bindFunctions(renderedDiagramRef.current);
        }
      } catch (renderError) {
        if (!active) {
          return;
        }

        console.error('Failed to render Mermaid markdown block.', renderError);
        setSvg('');
        setError(FALLBACK_MESSAGE);
      }
    }

    void renderDiagram();

    return () => {
      active = false;
    };
  }, [diagramId, isDarkMode, normalizedSource]);

  if (error) {
    return (
      <div className="my-4 not-prose rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-950/30">
        <p className="m-0 text-sm font-medium text-red-700 dark:text-red-300">{error}</p>
        <pre className="mt-3 overflow-x-auto rounded-md bg-gray-900 p-4 text-sm text-white">
          <code>
            {fallbackSourceLines.map((line, index) => (
              <span key={`${diagramId}-fallback-${index}`} className="block">
                {line || ' '}
              </span>
            ))}
          </code>
        </pre>
      </div>
    );
  }

  return (
    <div className="my-4 not-prose overflow-x-auto rounded-md border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-950">
      <div
        ref={renderedDiagramRef}
        className="markdown-mermaid-diagram flex min-h-24 items-center justify-center"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
