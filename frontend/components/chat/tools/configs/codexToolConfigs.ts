/**
 * PURPOSE: Expose Codex planning and context-mode tool configs as one auditable family.
 */
import { TOOL_CONFIGS } from './toolConfigRegistry';

export const CODEX_TOOL_CONFIGS = {
  update_plan: TOOL_CONFIGS.update_plan,
  exit_plan_mode: TOOL_CONFIGS.exit_plan_mode,
  ExitPlanMode: TOOL_CONFIGS.ExitPlanMode,
  ctx_batch_execute: TOOL_CONFIGS.ctx_batch_execute,
  ctx_batch_exec: TOOL_CONFIGS.ctx_batch_exec,
  'mcp__context_mode__:ctx_batch_execute': TOOL_CONFIGS['mcp__context_mode__:ctx_batch_execute'],
  'mcp__context_mode__.ctx_batch_execute': TOOL_CONFIGS['mcp__context_mode__.ctx_batch_execute'],
  ContextModeFetch: TOOL_CONFIGS.ContextModeFetch,
  ContextModeRead: TOOL_CONFIGS.ContextModeRead,
  ContextModeExecuteFile: TOOL_CONFIGS.ContextModeExecuteFile,
  ContextModeExecute: TOOL_CONFIGS.ContextModeExecute,
  ContextModeSearch: TOOL_CONFIGS.ContextModeSearch,
  ContextModeGeneric: TOOL_CONFIGS.ContextModeGeneric,
};
