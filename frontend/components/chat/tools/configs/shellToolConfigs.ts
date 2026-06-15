/**
 * PURPOSE: Expose shell and terminal tool display configs as one auditable family.
 */
import { TOOL_CONFIGS } from './toolConfigRegistry';

export const SHELL_TOOL_CONFIGS = {
  Bash: TOOL_CONFIGS.Bash,
  exec_command: TOOL_CONFIGS.exec_command,
  'functions.exec_command': TOOL_CONFIGS['functions.exec_command'],
  write_stdin: TOOL_CONFIGS.write_stdin,
  'functions.write_stdin': TOOL_CONFIGS['functions.write_stdin'],
};
