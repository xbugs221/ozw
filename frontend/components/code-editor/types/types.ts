/**
 * PURPOSE: Shared editor types for document loading, mode selection, and diff state.
 */
export type CodeEditorDiffInfo = {
  old_string?: string;
  new_string?: string;
  [key: string]: unknown;
};

export type CodeEditorFileType = 'text' | 'markdown' | 'image' | 'binary';

export type CodeEditorFile = {
  name: string;
  path: string;
  projectName?: string;
  projectPath?: string;
  fileType?: CodeEditorFileType;
  mimeType?: string;
  editable?: boolean;
  diffInfo?: CodeEditorDiffInfo | null;
  [key: string]: unknown;
};

export type CodeEditorSettingsState = {
  isDarkMode: boolean;
  wordWrap: boolean;
  minimapEnabled: boolean;
  showLineNumbers: boolean;
  fontSize: string;
};
