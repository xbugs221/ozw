import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

const Maximize2 = ({ className: cls }: { className?: string }) => <svg className={cls || 'w-4 h-4'} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>;
const Minimize2 = ({ className: cls }: { className?: string }) => <svg className={cls || 'w-4 h-4'} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="4,14 10,14 10,20"/><polyline points="20,10 14,10 14,4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>;
const RotateCcw = ({ className: cls }: { className?: string }) => <svg className={cls || 'w-4 h-4'} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>;
const ZoomIn = ({ className: cls }: { className?: string }) => <svg className={cls || 'w-4 h-4'} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>;
const ZoomOut = ({ className: cls }: { className?: string }) => <svg className={cls || 'w-4 h-4'} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>;

type Point = {
  x: number;
  y: number;
};

type ZoomableImagePreviewLabels = {
  zoomIn: string;
  zoomOut: string;
  resetZoom: string;
  enterFullscreen: string;
  exitFullscreen: string;
};

type ZoomableImagePreviewProps = {
  src: string;
  alt: string;
  className?: string;
  imageClassName?: string;
  labels?: Partial<ZoomableImagePreviewLabels>;
};

const MIN_SCALE = 0.25;
const MAX_SCALE = 6;
const ZOOM_STEP = 1.25;

const DEFAULT_LABELS: ZoomableImagePreviewLabels = {
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetZoom: 'Reset zoom',
  enterFullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
};

function clampScale(scale: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(scale.toFixed(3))));
}

function distanceBetween(first: Point, second: Point) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export default function ZoomableImagePreview({
  src,
  alt,
  className,
  imageClassName,
  labels,
}: ZoomableImagePreviewProps) {
  const mergedLabels = useMemo(() => ({ ...DEFAULT_LABELS, ...labels }), [labels]);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const dragRef = useRef<{ pointerId: number; last: Point } | null>(null);
  const pinchRef = useRef<{ distance: number; scale: number } | null>(null);

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

  useEffect(() => {
    resetView();
  }, [resetView, src]);

  const zoomPercent = Math.round(scale * 100);
  const canZoomOut = scale > MIN_SCALE;
  const canZoomIn = scale < MAX_SCALE;

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-col overflow-hidden bg-muted/30',
        className,
        isFullscreen && 'fixed inset-0 z-[10000] h-[100dvh] w-screen bg-background',
      )}
    >
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-border/80 bg-background/90 p-1 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={!canZoomOut}
          className="flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent disabled:opacity-40"
          title={mergedLabels.zoomOut}
          aria-label={mergedLabels.zoomOut}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={resetView}
          className="flex h-9 min-w-14 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium tabular-nums text-foreground transition-colors hover:bg-accent"
          title={mergedLabels.resetZoom}
          aria-label={mergedLabels.resetZoom}
        >
          <RotateCcw className="h-4 w-4" />
          {zoomPercent}%
        </button>
        <button
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={!canZoomIn}
          className="flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent disabled:opacity-40"
          title={mergedLabels.zoomIn}
          aria-label={mergedLabels.zoomIn}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setIsFullscreen((currentValue) => !currentValue)}
          className="flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
          title={isFullscreen ? mergedLabels.exitFullscreen : mergedLabels.enterFullscreen}
          aria-label={isFullscreen ? mergedLabels.exitFullscreen : mergedLabels.enterFullscreen}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 select-none items-center justify-center overflow-hidden p-4 md:p-6',
          scale > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in',
        )}
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onDoubleClick={handleDoubleClick}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
          className={cn('max-h-full max-w-full object-contain will-change-transform', imageClassName)}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 120ms ease-out',
          }}
        />
      </div>
    </div>
  );
}
