/**
 * PURPOSE: Expose subagent task tool display configs as one auditable family.
 */
import { TOOL_CONFIGS } from './toolConfigRegistry';

export const SUBAGENT_TOOL_CONFIGS = {
  Agent: TOOL_CONFIGS.Agent,
  Subagent: TOOL_CONFIGS.Subagent,
  Task: TOOL_CONFIGS.Task,
  sub_agent: TOOL_CONFIGS.Subagent,
  subagent: TOOL_CONFIGS.Subagent,
};
