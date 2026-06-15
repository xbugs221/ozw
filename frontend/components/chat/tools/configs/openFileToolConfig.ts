/**
 * PURPOSE: Build shared tool card configs for tools whose primary action is
 * opening a workspace file path from the compact transcript card.
 */
import type { ToolDisplayConfig } from './toolConfigs';

/**
 * Resolve file paths from both Codex-style and Pi-style tool payloads.
 */
export function getOpenFileToolPath(input: any): string {
  return String(input?.file_path || input?.path || '');
}

/**
 * Create a compact one-line file-opening card.
 */
export function createOpenFileToolConfig(options: {
  label?: string;
  getPath?: (input: any) => string;
} = {}): ToolDisplayConfig {
  const getPath = options.getPath || getOpenFileToolPath;
  return {
    input: {
      type: 'one-line',
      label: options.label || 'Open',
      getValue: (input) => getPath(input) || 'unknown',
      action: 'open-file',
      wrapText: true,
    },
    result: {
      hidden: true,
    },
  };
}

/**
 * Create the shared open-file card for image viewing tools.
 */
export const createImageOpenFileToolConfig = (): ToolDisplayConfig => createOpenFileToolConfig({ label: 'View' });
