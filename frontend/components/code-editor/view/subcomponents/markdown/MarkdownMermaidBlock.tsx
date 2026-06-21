/**
 * PURPOSE: Render Mermaid fenced code blocks inside the workspace markdown
 * preview while isolating parse failures to the current block.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

type MarkdownMermaidBlockProps = {
  source: string;
  isDarkMode: boolean;
};

const FALLBACK_MESSAGE = 'Unable to render Mermaid diagram.';
const MIN_SCALE = 0.25;
const MAX_SCALE = 6;
const ZOOM_STEP = 1.25;

const Maximize2 = ({ className: cls }: { className?: string }) => <svg className={cls || 'h-4 w-4'} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>;
const Minimize2 = ({ className: cls }: { className?: string }) => <svg className={cls || 'h-4 w-4'} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="4,14 10,14 10,20"/><polyline points="20,10 14,10 14,4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>;
const RotateCcw = ({ className: cls }: { className?: string }) => <svg className={cls || 'h-4 w-4'} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>;
const ZoomIn = ({ className: cls }: { className?: string }) => <svg className={cls || 'h-4 w-4'} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>;
const ZoomOut = ({ className: cls }: { className?: string }) => <svg className={cls || 'h-4 w-4'} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>;

type Point = {
  x: number;
  y: number;
};

let initializedTheme: 'default' | 'dark' | null = null;
let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(scale.toFixed(3))));
}

function distanceBetween(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

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
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const renderedDiagramRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const dragRef = useRef<{ pointerId: number; last: Point } | null>(null);
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);
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

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const applyScale = useCallback((nextScale: number) => {
    const clampedScale = clampScale(nextScale);
    setScale(clampedScale);
    if (clampedScale <= 1) {
      setOffset({ x: 0, y: 0 });
    }
  }, []);

  const zoomBy = useCallback((factor: number) => {
    applyScale(scale * factor);
  }, [applyScale, scale]);

  const releasePointer = useCallback((pointerId: number) => {
    pointersRef.current.delete(pointerId);
    if (dragRef.current?.pointerId === pointerId) {
      dragRef.current = null;
      setIsDragging(false);
    }
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 1) {
      dragRef.current = {
        pointerId: event.pointerId,
        last: { x: event.clientX, y: event.clientY },
      };
      setIsDragging(scale > 1);
    }

    if (pointersRef.current.size === 2) {
      const points = Array.from(pointersRef.current.values());
      pinchRef.current = {
        distance: distanceBetween(points[0], points[1]),
        scale,
      };
      dragRef.current = null;
      setIsDragging(false);
    }
  }, [scale]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) {
      return;
    }

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2 && pinchRef.current) {
      const points = Array.from(pointers.values());
      const nextDistance = distanceBetween(points[0], points[1]);
      if (nextDistance > 0 && pinchRef.current.distance > 0) {
        applyScale(pinchRef.current.scale * (nextDistance / pinchRef.current.distance));
      }
      return;
    }

    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId || scale <= 1) {
      return;
    }

    const nextPoint = { x: event.clientX, y: event.clientY };
    const delta = {
      x: nextPoint.x - dragRef.current.last.x,
      y: nextPoint.y - dragRef.current.last.y,
    };
    dragRef.current = { ...dragRef.current, last: nextPoint };
    setOffset((currentOffset) => ({
      x: currentOffset.x + delta.x,
      y: currentOffset.y + delta.y,
    }));
  }, [applyScale, scale]);

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    releasePointer(event.pointerId);
  }, [releasePointer]);

  const handleDoubleClick = useCallback(() => {
    if (scale === 1) {
      applyScale(2);
      return;
    }
    resetView();
  }, [applyScale, resetView, scale]);

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

  useEffect(() => {
    resetView();
  }, [normalizedSource, resetView]);

  useEffect(() => {
    if (!isFullscreen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

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

  const zoomPercent = Math.round(scale * 100);
  const canZoomOut = scale > MIN_SCALE;
  const canZoomIn = scale < MAX_SCALE;

  return (
    <div className={`relative my-4 not-prose overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950 ${isFullscreen ? 'fixed inset-0 z-[10000] m-0 h-[100dvh] w-screen rounded-none border-0' : 'min-h-40'}`}>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-gray-200/80 bg-white/90 p-1 shadow-sm backdrop-blur dark:border-gray-700/80 dark:bg-gray-950/90">
        <button
          type="button"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={!canZoomOut}
          className="flex h-9 w-9 items-center justify-center rounded-md text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-gray-800"
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={resetView}
          className="flex h-9 min-w-14 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium tabular-nums text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          title="Reset zoom"
          aria-label="Reset zoom"
        >
          <RotateCcw className="h-4 w-4" />
          {zoomPercent}%
        </button>
        <button
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={!canZoomIn}
          className="flex h-9 w-9 items-center justify-center rounded-md text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-40 dark:text-gray-200 dark:hover:bg-gray-800"
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setIsFullscreen((currentValue) => !currentValue)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>
      <div
        className={`flex min-h-40 select-none items-center justify-center overflow-hidden p-4 pt-16 md:p-6 md:pt-16 ${isFullscreen ? 'h-full' : 'max-h-[70vh]'} ${scale > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'}`}
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onDoubleClick={handleDoubleClick}
      >
        <div
          ref={renderedDiagramRef}
          className="markdown-mermaid-diagram flex min-h-24 items-center justify-center will-change-transform"
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 120ms ease-out',
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
}
