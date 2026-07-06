/**
 * PURPOSE: Workspace dock layout shell.
 * Renders center chat area with scroll-safe docks and top-aligned pane controls.
 */
import React from 'react';
const Maximize2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>;
const Minimize2 = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="4,14 10,14 10,20"/><polyline points="20,10 14,10 14,4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>;
const Move = ({ className: cls, strokeWidth: sw }: { className?: string; strokeWidth?: number }) => <svg className={cls || "w-4 h-4"} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="5,9 2,12 5,15"/><polyline points="9,5 12,2 15,5"/><polyline points="15,19 12,22 9,19"/><polyline points="19,9 22,12 19,15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>;
import type { WorkspaceLayoutState } from '../../hooks/useWorkspaceLayoutState';

export type WorkspaceDockLayoutProps = {
  layout: WorkspaceLayoutState;
  isMobile: boolean;
  centerContent: React.ReactNode;
  rightDockContent: React.ReactNode;
  lowerPanelContent: React.ReactNode;
  onRightDockWidthChange: (width: number) => void;
  onLowerPanelHeightChange: (height: number) => void;
  onRightDockCollapseToggle: () => void;
  onLowerPanelCollapseToggle: () => void;
  onRightDockFullscreenToggle: () => void;
  onLowerPanelFullscreenToggle: () => void;
  onMoveTerminalToRightSplit?: () => void;
  onMoveTerminalToLower?: () => void;
  onRightDockSplitRatioChange?: (ratio: number) => void;
  rightDockTitleActions?: React.ReactNode;
  lowerPanelActions?: React.ReactNode;
};

export default function WorkspaceDockLayout({
  layout,
  isMobile,
  centerContent,
  rightDockContent,
  lowerPanelContent,
  onRightDockWidthChange,
  onLowerPanelHeightChange,
  onRightDockCollapseToggle,
  onLowerPanelCollapseToggle,
  onRightDockFullscreenToggle,
  onLowerPanelFullscreenToggle,
  onMoveTerminalToRightSplit,
  onMoveTerminalToLower,
  onRightDockSplitRatioChange,
  rightDockTitleActions,
  lowerPanelActions,
}: WorkspaceDockLayoutProps) {
  const { rightDock, lowerPanel } = layout;

  // Mobile layout: no docks, just center
  if (isMobile) {
    return <div className="flex flex-col h-full">{centerContent}</div>;
  }

  const rightDockFullscreen = Boolean(rightDock.fullscreen && rightDock.activePanel);
  const lowerPanelFullscreen = Boolean(lowerPanel.fullscreen && lowerPanel.activePanel);
  const anyFullscreen = rightDockFullscreen || lowerPanelFullscreen;
  const showRightDock = Boolean(rightDock.activePanel && (!rightDock.collapsed || rightDockFullscreen));
  const showLowerPanel = Boolean(lowerPanel.activePanel && (!lowerPanel.collapsed || lowerPanelFullscreen));
  const showRightSplit = rightDock.split !== null;
  // When terminal is in right split, lower panel is not shown
  const effectiveShowLowerPanel = showLowerPanel && !showRightSplit;

  return (
    <div className="relative flex h-full w-full min-w-0 flex-1 overflow-hidden" data-testid="workspace-dock-layout">
      {/* Center area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className={`flex min-h-0 flex-1 overflow-hidden ${anyFullscreen ? 'invisible pointer-events-none' : ''}`}>
          {centerContent}
        </div>

        {/* Bottom dock */}
        {effectiveShowLowerPanel && (
          <>
            {!lowerPanelFullscreen && (
              <DockResizeHandle
                direction="horizontal"
                onResize={(delta) => onLowerPanelHeightChange(layout.lowerPanel.height + delta)}
              />
            )}
            <DockPanelFrame
              direction="bottom"
              size={layout.lowerPanel.height}
              title="终端"
              onFullscreenToggle={onLowerPanelFullscreenToggle}
              onMoveTerminal={lowerPanelFullscreen ? undefined : onMoveTerminalToRightSplit}
              isFullscreen={lowerPanelFullscreen}
              actions={lowerPanelActions}
            >
              {lowerPanelContent}
            </DockPanelFrame>
          </>
        )}
      </div>

      {/* Right dock */}
      {showRightDock && (
        <>
          {!rightDockFullscreen && (
            <DockResizeHandle
              direction="vertical"
              onResize={(delta) => onRightDockWidthChange(layout.rightDock.width - delta)}
            />
          )}
          <DockPanelFrame
            direction="right"
            size={layout.rightDock.width}
            title={showRightSplit ? '文件 / 终端' : '文件'}
            onFullscreenToggle={onRightDockFullscreenToggle}
            onMoveTerminal={rightDockFullscreen ? undefined : onMoveTerminalToLower}
            isFullscreen={rightDockFullscreen}
            titleActions={rightDockTitleActions}
            actions={showRightSplit ? lowerPanelActions : undefined}
          >
            {showRightSplit ? (
              <RightSplitPanel
                split={rightDock.split!}
                topContent={rightDockContent}
                bottomContent={lowerPanelContent}
                onRatioChange={onRightDockSplitRatioChange}
              />
            ) : (
              rightDockContent
            )}
          </DockPanelFrame>
        </>
      )}
    </div>
  );
}

/**
 * PURPOSE: Header for dock panels with collapse and fullscreen controls.
 */
function DockPanelHeader({
  title,
  onFullscreenToggle,
  onMoveTerminal,
  isFullscreen,
  titleActions,
  actions,
}: {
  title: string;
  onFullscreenToggle: () => void;
  onMoveTerminal?: () => void;
  isFullscreen: boolean;
  titleActions?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-shrink-0 items-center justify-between px-3 py-2 border-b border-border/60 bg-background" data-testid="dock-panel-header">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm font-medium text-foreground">{title}</span>
        {titleActions}
      </div>
      <div className="flex items-center gap-1">
        {actions}
        {onMoveTerminal && (
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            onClick={onMoveTerminal}
            aria-label="移动终端"
            title="移动终端"
          >
            <Move className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-1 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          onClick={onFullscreenToggle}
          aria-label={isFullscreen ? '退出全屏' : '全屏'}
          title={isFullscreen ? '退出全屏' : '全屏'}
        >
          {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

/**
 * PURPOSE: Resize handle for dock panels.
 */
function DockResizeHandle({
  direction,
  onResize,
}: {
  direction: 'vertical' | 'horizontal';
  onResize: (delta: number) => void;
}) {
  const [isResizing, setIsResizing] = React.useState(false);
  const startRef = React.useRef(0);

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsResizing(true);
      startRef.current = direction === 'vertical' ? event.clientX : event.clientY;
    },
    [direction],
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent) => {
      if (!isResizing) return;
      const current = direction === 'vertical' ? event.clientX : event.clientY;
      const delta = direction === 'vertical' ? current - startRef.current : startRef.current - current;
      startRef.current = current;
      onResize(delta);
    },
    [isResizing, direction, onResize],
  );

  const handlePointerUp = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  return (
    <div
      className={`flex-shrink-0 z-10 ${
        direction === 'vertical'
          ? 'w-[3px] cursor-col-resize hover:bg-primary/30 active:bg-primary/50'
          : 'h-[3px] cursor-row-resize hover:bg-primary/30 active:bg-primary/50'
      } ${isResizing ? 'bg-primary/50' : 'bg-transparent'}`}
      style={{ touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="separator"
      aria-orientation={direction === 'vertical' ? 'vertical' : 'horizontal'}
      data-testid={`resize-handle-${direction}`}
    />
  );
}

/**
 * PURPOSE: Frame wrapper for dock panels.
 */
function DockPanelFrame({
  direction,
  size,
  title,
  children,
  onFullscreenToggle,
  onMoveTerminal,
  isFullscreen = false,
  titleActions,
  actions,
}: {
  direction: 'right' | 'bottom';
  size: number;
  title: string;
  children: React.ReactNode;
  onFullscreenToggle: () => void;
  onMoveTerminal?: () => void;
  isFullscreen?: boolean;
  titleActions?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div
      className={`flex-shrink-0 flex flex-col overflow-hidden bg-background border-border/40 ${
        isFullscreen ? 'absolute inset-0 z-30 h-full w-full border' : direction === 'right' ? 'border-l' : 'border-t'
      }`}
      style={isFullscreen ? undefined : direction === 'right' ? { width: size } : { height: size }}
      data-testid={`dock-panel-${direction}`}
    >
      <DockPanelHeader
        title={title}
        onFullscreenToggle={onFullscreenToggle}
        onMoveTerminal={onMoveTerminal}
        isFullscreen={isFullscreen}
        titleActions={titleActions}
        actions={actions}
      />
      <div className="flex-1 min-h-0 min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * PURPOSE: Split panel for right dock with terminal in bottom section.
 */
function RightSplitPanel({
  split,
  topContent,
  bottomContent,
  onRatioChange,
}: {
  split: NonNullable<WorkspaceLayoutState['rightDock']['split']>;
  topContent: React.ReactNode;
  bottomContent: React.ReactNode;
  onRatioChange?: (ratio: number) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = React.useState(false);

  const handlePointerDown = React.useCallback((event: React.PointerEvent) => {
    if (!onRatioChange || !containerRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  }, [onRatioChange]);

  const handlePointerMove = React.useCallback((event: React.PointerEvent) => {
    if (!isResizing || !onRatioChange || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const relativeY = event.clientY - rect.top;
    const newRatio = Math.max(0.2, Math.min(0.8, relativeY / rect.height));
    onRatioChange(newRatio);
  }, [isResizing, onRatioChange]);

  const handlePointerUp = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  const topHeight = `${Math.round(split.ratio * 100)}%`;

  return (
    <div ref={containerRef} className="flex flex-col h-full w-full">
      <div className="overflow-hidden" style={{ height: topHeight }}>{topContent}</div>
      <div
        className={`h-[3px] cursor-row-resize hover:bg-primary/30 active:bg-primary/50 ${isResizing ? 'bg-primary/50' : 'bg-transparent'}`}
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="separator"
        aria-orientation="horizontal"
        data-testid="resize-handle-split"
      />
      <div className="flex-1 min-h-0 overflow-hidden">{bottomContent}</div>
    </div>
  );
}
