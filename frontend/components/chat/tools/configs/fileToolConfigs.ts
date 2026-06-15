/**
 * PURPOSE: Expose file operation tool display configs as one auditable family.
 */
import { TOOL_CONFIGS } from './toolConfigRegistry';

export const FILE_TOOL_CONFIGS = {
  Read: TOOL_CONFIGS.Read,
  view_image: TOOL_CONFIGS.view_image,
  'functions.view_image': TOOL_CONFIGS['functions.view_image'],
  Edit: TOOL_CONFIGS.Edit,
  'Edit file': TOOL_CONFIGS['Edit file'],
  Write: TOOL_CONFIGS.Write,
  ApplyPatch: TOOL_CONFIGS.ApplyPatch,
  FileChanges: TOOL_CONFIGS.FileChanges,
};
