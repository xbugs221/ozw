/**
 * PURPOSE: Expose subagent task tool display configs as one auditable family.
 */
import { TOOL_CONFIGS } from './toolConfigRegistry';

export const SUBAGENT_TOOL_CONFIGS = {
  Agent: TOOL_CONFIGS.Agent,
  Task: TOOL_CONFIGS.Task,
};
