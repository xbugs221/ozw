/**
 * PURPOSE: Keep the historical tool config import path as a compatibility
 * facade while family modules and the registry own the implementation.
 */
export {
  getExecResultContent,
  getToolConfig,
  shouldHideToolResult,
  TOOL_CONFIGS,
} from './toolConfigRegistry';
export type { ToolDisplayConfig } from './toolConfigRegistry';
