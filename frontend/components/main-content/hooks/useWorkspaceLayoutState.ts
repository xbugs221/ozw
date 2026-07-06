/**
 * PURPOSE: Manage workspace dock layout state with persistence and fallback.
 * Replaces the old exclusive-tab model with a dock-based layout.
 */
import { useCallback, useEffect, useState } from 'react';

export type RightDockPanel = 'files' | null;
export type LowerPanelPanel = 'terminal' | null;

export type RightDockSplit = {
  topPanel: 'files';
  bottomPanel: 'terminal';
  ratio: number;
} | null;

export type WorkspaceLayoutState = {
  rightDock: {
    activePanel: RightDockPanel;
    collapsed: boolean;
    width: number;
    fullscreen: boolean;
    split: RightDockSplit;
  };
  lowerPanel: {
    activePanel: LowerPanelPanel;
    collapsed: boolean;
    height: number;
    fullscreen: boolean;
  };
};

const STORAGE_KEY = 'ozw:workspace-layout:v1';
const OLD_TAB_KEY = 'activeTab';

const DEFAULT_STATE: WorkspaceLayoutState = {
  rightDock: {
    activePanel: 'files',
    collapsed: true,
    width: 360,
    fullscreen: false,
    split: null,
  },
  lowerPanel: {
    activePanel: 'terminal',
    collapsed: true,
    height: 260,
    fullscreen: false,
  },
};

const MIN_RIGHT_WIDTH = 200;
const MAX_RIGHT_WIDTH = 800;
const MIN_BOTTOM_HEIGHT = 120;
const MAX_BOTTOM_HEIGHT = 600;

function isValidRightDockPanel(value: unknown): value is RightDockPanel {
  return value === 'files' || value === null;
}

function isValidLowerPanelPanel(value: unknown): value is LowerPanelPanel {
  return value === 'terminal' || value === null;
}

function isValidSplit(value: unknown): value is RightDockSplit {
  if (value === null) return true;
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.topPanel === 'files'
    && v.bottomPanel === 'terminal'
    && typeof v.ratio === 'number'
    && v.ratio >= 0.2
    && v.ratio <= 0.8
  );
}

function migrateOldTabState(): Partial<WorkspaceLayoutState> | null {
  try {
    const oldTab = localStorage.getItem(OLD_TAB_KEY);
    if (!oldTab || oldTab === 'chat' || oldTab === 'workflows') return null;
    // If old tab was files/shell, migrate to dock layout.
    const migrated: Partial<WorkspaceLayoutState> = {};
    if (oldTab === 'files') {
      migrated.rightDock = { ...DEFAULT_STATE.rightDock, activePanel: 'files' };
    } else if (oldTab === 'shell') {
      migrated.lowerPanel = { ...DEFAULT_STATE.lowerPanel, activePanel: 'terminal' };
    }
    return migrated;
  } catch {
    return null;
  }
}

function readPersistedState(): WorkspaceLayoutState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as unknown;
      if (
        typeof parsed === 'object'
        && parsed !== null
        && 'rightDock' in parsed
        && 'lowerPanel' in parsed
      ) {
        const p = parsed as Record<string, unknown>;
        const rightDock = p.rightDock as Record<string, unknown>;
        const lowerPanel = p.lowerPanel as Record<string, unknown>;

        if (
          isValidRightDockPanel(rightDock?.activePanel)
          && typeof rightDock?.collapsed === 'boolean'
          && typeof rightDock?.width === 'number'
          && typeof rightDock?.fullscreen === 'boolean'
          && isValidSplit(rightDock?.split)
          && isValidLowerPanelPanel(lowerPanel?.activePanel)
          && typeof lowerPanel?.collapsed === 'boolean'
          && typeof lowerPanel?.height === 'number'
          && typeof lowerPanel?.fullscreen === 'boolean'
        ) {
          return {
            rightDock: {
              activePanel: rightDock.activePanel as RightDockPanel,
              collapsed: rightDock.collapsed as boolean,
              width: Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, rightDock.width as number)),
              fullscreen: rightDock.fullscreen as boolean,
              split: rightDock.split as RightDockSplit,
            },
            lowerPanel: {
              activePanel: lowerPanel.activePanel as LowerPanelPanel,
              collapsed: lowerPanel.collapsed as boolean,
              height: Math.max(MIN_BOTTOM_HEIGHT, Math.min(MAX_BOTTOM_HEIGHT, lowerPanel.height as number)),
              fullscreen: lowerPanel.fullscreen as boolean,
            },
          };
        }
      }
    }
  } catch {
    // Invalid or unreadable state
  }

  // Try migrating old activeTab state
  const migrated = migrateOldTabState();
  if (migrated) {
    return { ...DEFAULT_STATE, ...migrated };
  }

  return DEFAULT_STATE;
}

export function useWorkspaceLayoutState(isMobile: boolean) {
  const [layout, setLayout] = useState<WorkspaceLayoutState>(() => {
    // Mobile always starts with default (no dock panels visible)
    if (isMobile) {
      return {
        ...DEFAULT_STATE,
        rightDock: { ...DEFAULT_STATE.rightDock, collapsed: true },
        lowerPanel: { ...DEFAULT_STATE.lowerPanel, collapsed: true },
      };
    }
    return readPersistedState();
  });

  useEffect(() => {
    if (isMobile) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      // Silently ignore storage errors
    }
  }, [layout, isMobile]);

  const setRightDock = useCallback((updates: Partial<WorkspaceLayoutState['rightDock']>) => {
    setLayout((prev) => ({
      ...prev,
      rightDock: { ...prev.rightDock, ...updates },
    }));
  }, []);

  const setLowerPanel = useCallback((updates: Partial<WorkspaceLayoutState['lowerPanel']>) => {
    setLayout((prev) => ({
      ...prev,
      lowerPanel: { ...prev.lowerPanel, ...updates },
    }));
  }, []);

  const toggleRightDockCollapse = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      rightDock: { ...prev.rightDock, collapsed: !prev.rightDock.collapsed },
    }));
  }, []);

  const toggleLowerPanelCollapse = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      lowerPanel: { ...prev.lowerPanel, collapsed: !prev.lowerPanel.collapsed },
    }));
  }, []);

  const setRightDockWidth = useCallback((width: number) => {
    setLayout((prev) => ({
      ...prev,
      rightDock: {
        ...prev.rightDock,
        width: Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, width)),
      },
    }));
  }, []);

  const setLowerPanelHeight = useCallback((height: number) => {
    setLayout((prev) => ({
      ...prev,
      lowerPanel: {
        ...prev.lowerPanel,
        height: Math.max(MIN_BOTTOM_HEIGHT, Math.min(MAX_BOTTOM_HEIGHT, height)),
      },
    }));
  }, []);

  const toggleRightDockFullscreen = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      rightDock: { ...prev.rightDock, fullscreen: !prev.rightDock.fullscreen },
    }));
  }, []);

  const toggleLowerPanelFullscreen = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      lowerPanel: { ...prev.lowerPanel, fullscreen: !prev.lowerPanel.fullscreen },
    }));
  }, []);

  const moveTerminalToRightSplit = useCallback(() => {
    setLayout((prev) => {
      if (!prev.rightDock.activePanel) {
        return prev;
      }
      return {
        ...prev,
        lowerPanel: { ...prev.lowerPanel, activePanel: null, collapsed: false },
        rightDock: {
          ...prev.rightDock,
          split: {
            topPanel: prev.rightDock.activePanel,
            bottomPanel: 'terminal',
            ratio: 0.6,
          },
        },
      };
    });
  }, []);

  const moveTerminalToLower = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      lowerPanel: { ...prev.lowerPanel, activePanel: 'terminal', collapsed: false },
      rightDock: { ...prev.rightDock, split: null },
    }));
  }, []);

  const setRightDockSplitRatio = useCallback((ratio: number) => {
    setLayout((prev) => {
      if (!prev.rightDock.split) return prev;
      return {
        ...prev,
        rightDock: {
          ...prev.rightDock,
          split: {
            ...prev.rightDock.split,
            ratio: Math.max(0.2, Math.min(0.8, ratio)),
          },
        },
      };
    });
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(DEFAULT_STATE);
  }, []);

  return {
    layout,
    setRightDock,
    setLowerPanel,
    toggleRightDockCollapse,
    toggleLowerPanelCollapse,
    setRightDockWidth,
    setLowerPanelHeight,
    toggleRightDockFullscreen,
    toggleLowerPanelFullscreen,
    moveTerminalToRightSplit,
    moveTerminalToLower,
    setRightDockSplitRatio,
    resetLayout,
  };
}
