/**
 * PURPOSE: Persist and control user-resizable panel widths for navigation panes.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

type ResizableWidthOptions = {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
};

type ResizeStart = {
  pointerId: number;
  startX: number;
  startWidth: number;
};

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  /**
   * PURPOSE: Keep the navigation panel large enough to use and small enough
   * to leave room for the main workspace.
   */
  return Math.min(Math.max(width, minWidth), maxWidth);
}

function readStoredWidth({ storageKey, defaultWidth, minWidth, maxWidth }: ResizableWidthOptions): number {
  /**
   * PURPOSE: Restore the user's last chosen panel width when it is valid.
   */
  if (typeof window === 'undefined') {
    return defaultWidth;
  }

  const rawValue = window.localStorage.getItem(storageKey);
  const parsedWidth = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;

  if (!Number.isFinite(parsedWidth)) {
    return defaultWidth;
  }

  return clampWidth(parsedWidth, minWidth, maxWidth);
}

export function useResizableWidth(options: ResizableWidthOptions) {
  /**
   * PURPOSE: Track pointer dragging and persist the resulting sidebar width.
   */
  const { storageKey, defaultWidth, minWidth, maxWidth } = options;
  const [width, setWidth] = useState(() => readStoredWidth(options));
  const [resizeStart, setResizeStart] = useState<ResizeStart | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  useEffect(() => {
    if (!resizeStart || typeof window === 'undefined') {
      return undefined;
    }

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const nextWidth = resizeStart.startWidth + event.clientX - resizeStart.startX;
      setWidth(clampWidth(nextWidth, minWidth, maxWidth));
    };

    const handlePointerUp = () => {
      setResizeStart(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [maxWidth, minWidth, resizeStart]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizeStart({
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    });
  }, [width]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 32 : 16;
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;

    if (direction !== 0) {
      event.preventDefault();
      setWidth((currentWidth) => clampWidth(currentWidth + direction * step, minWidth, maxWidth));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setWidth(minWidth);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setWidth(maxWidth);
    }
  }, [maxWidth, minWidth]);

  return useMemo(() => ({
    width,
    isResizing: resizeStart !== null,
    resizeHandleProps: {
      'aria-orientation': 'vertical' as const,
      'aria-valuemin': minWidth,
      'aria-valuemax': maxWidth,
      'aria-valuenow': width,
      onKeyDown: handleKeyDown,
      onPointerDown: handlePointerDown,
      role: 'separator',
      tabIndex: 0,
    },
  }), [handleKeyDown, handlePointerDown, maxWidth, minWidth, resizeStart, width]);
}
