/**
 * PURPOSE: Route opened files into text editing, markdown preview, image
 * preview, or binary placeholder modes without corrupting non-text assets.
 */
import { EditorView } from '@codemirror/view';
import { unifiedMergeView } from '@codemirror/merge';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCodeEditorDocument } from '../hooks/useCodeEditorDocument';
import { useCodeEditorSettings } from '../hooks/useCodeEditorSettings';
import { useEditorKeyboardShortcuts } from '../hooks/useEditorKeyboardShortcuts';
import type { CodeEditorFile } from '../types/types';
import { createMinimapExtension, createScrollToFirstChunkExtension, getLanguageExtensions } from '../utils/editorExtensions';
import { getEditorStyles } from '../utils/editorStyles';
import { createEditorToolbarPanelExtension } from '../utils/editorToolbarPanel';
import CodeEditorFooter from './subcomponents/CodeEditorFooter';
import CodeEditorHeader from './subcomponents/CodeEditorHeader';
import CodeEditorBinaryPlaceholder from './subcomponents/CodeEditorBinaryPlaceholder';
import CodeEditorImagePreview from './subcomponents/CodeEditorImagePreview';
import CodeEditorLoadingState from './subcomponents/CodeEditorLoadingState';
import CodeEditorSettingsPanel from './subcomponents/CodeEditorSettingsPanel';
import CodeEditorSurface from './subcomponents/CodeEditorSurface';

/**
 * PURPOSE: Keep extension typing local to avoid hard dependency on @codemirror/state types.
 */
type CodeEditorExtension = any;

type CodeEditorProps = {
  file: CodeEditorFile;
  onClose: () => void;
  projectPath?: string;
  isSidebar?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (() => void) | null;
  onPopOut?: (() => void) | null;
};

export default function CodeEditor({
  file,
  onClose,
  projectPath,
  isSidebar = false,
  isExpanded = false,
  onToggleExpand = null,
  onPopOut = null,
}: CodeEditorProps) {
  const { t } = useTranslation('codeEditor');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showDiff, setShowDiff] = useState(Boolean(file.diffInfo));
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);

  const {
    isDarkMode,
    setIsDarkMode,
    wordWrap,
    setWordWrap,
    minimapEnabled,
    setMinimapEnabled,
    showLineNumbers,
    setShowLineNumbers,
    fontSize,
    setFontSize,
  } = useCodeEditorSettings();

  const {
    content,
    setContent,
    loading,
    saving,
    saveSuccess,
    saveError,
    fileType,
    editable,
    handleSave,
    handleDownload,
  } = useCodeEditorDocument({
    file,
    projectPath,
  });

  const isMarkdownFile = fileType === 'markdown';
  const isImageFile = fileType === 'image';
  const isBinaryFile = fileType === 'binary';
  const showDownload = true;
  const showSave = editable && !isBinaryFile && !isImageFile;

  const minimapExtension = useMemo(
    () => (
      createMinimapExtension({
        file,
        showDiff,
        minimapEnabled,
        isDarkMode,
      })
    ),
    [file, isDarkMode, minimapEnabled, showDiff],
  );

  const scrollToFirstChunkExtension = useMemo(
    () => createScrollToFirstChunkExtension({ file, showDiff }),
    [file, showDiff],
  );

  const toolbarPanelExtension = useMemo(
    () => (
      createEditorToolbarPanelExtension({
        file,
        showDiff,
        isSidebar,
        isExpanded,
        onToggleDiff: () => setShowDiff((previous) => !previous),
        onPopOut,
        onToggleExpand,
        labels: {
          changes: t('toolbar.changes'),
          previousChange: t('toolbar.previousChange'),
          nextChange: t('toolbar.nextChange'),
          hideDiff: t('toolbar.hideDiff'),
          showDiff: t('toolbar.showDiff'),
          collapse: t('toolbar.collapse'),
          expand: t('toolbar.expand'),
        },
      })
    ),
    [file, isExpanded, isSidebar, onPopOut, onToggleExpand, showDiff, t],
  );

  const extensions = useMemo(() => {
    const allExtensions: CodeEditorExtension[] = [
      ...getLanguageExtensions(file.name),
      ...toolbarPanelExtension,
    ];

    if (file.diffInfo && showDiff && file.diffInfo.old_string !== undefined) {
      allExtensions.push(
        unifiedMergeView({
          original: file.diffInfo.old_string,
          mergeControls: false,
          highlightChanges: true,
          syntaxHighlightDeletions: false,
          gutter: true,
        }),
      );
      allExtensions.push(...minimapExtension);
      allExtensions.push(...scrollToFirstChunkExtension);
    }

    if (wordWrap) {
      allExtensions.push(EditorView.lineWrapping);
    }

    return allExtensions;
  }, [
    file.diffInfo,
    file.name,
    minimapExtension,
    scrollToFirstChunkExtension,
    showDiff,
    toolbarPanelExtension,
    wordWrap,
  ]);

  useEditorKeyboardShortcuts({
    onSave: () => {
      if (editable) {
        void handleSave();
      }
    },
    onClose,
    dependency: content,
  });

  if (loading) {
    return (
      <CodeEditorLoadingState
        isDarkMode={isDarkMode}
        isSidebar={isSidebar}
        loadingText={t('loading', { fileName: file.name })}
      />
    );
  }

  const outerContainerClassName = isSidebar
    ? 'w-full h-full flex flex-col'
    : `fixed inset-0 z-[9999] md:bg-black/50 md:flex md:items-center md:justify-center md:p-4 ${isFullscreen ? 'md:p-0' : ''}`;

  const innerContainerClassName = isSidebar
    ? 'relative bg-background flex flex-col w-full h-full'
    : `relative bg-background shadow-2xl flex flex-col w-full h-full md:rounded-lg md:shadow-2xl${
      isFullscreen ? ' md:w-full md:h-full md:rounded-none' : ' md:w-full md:max-w-6xl md:h-[80vh] md:max-h-[80vh]'
    }`;

  return (
    <>
      <style>{getEditorStyles(isDarkMode)}</style>
      <div className={outerContainerClassName}>
        <div className={innerContainerClassName}>
          <CodeEditorHeader
            file={file}
            isSidebar={isSidebar}
            isFullscreen={isFullscreen}
            isMarkdownFile={isMarkdownFile}
            showDownload={showDownload}
            showSave={showSave}
            markdownPreview={markdownPreview}
            saving={saving}
            saveSuccess={saveSuccess}
            onToggleMarkdownPreview={() => setMarkdownPreview((previous) => !previous)}
            onOpenSettings={() => setShowSettingsPanel((previous) => !previous)}
            onDownload={handleDownload}
            onSave={handleSave}
            onToggleFullscreen={() => setIsFullscreen((previous) => !previous)}
            onClose={onClose}
            labels={{
              showingChanges: t('header.showingChanges'),
              editMarkdown: t('actions.editMarkdown'),
              previewMarkdown: t('actions.previewMarkdown'),
              settings: t('toolbar.settings'),
              download: t('actions.download'),
              save: t('actions.save'),
              saving: t('actions.saving'),
              saved: t('actions.saved'),
              fullscreen: t('actions.fullscreen'),
              exitFullscreen: t('actions.exitFullscreen'),
              close: t('actions.close'),
            }}
          />

          {showSettingsPanel && (
            <CodeEditorSettingsPanel
              isDarkMode={isDarkMode}
              wordWrap={wordWrap}
              minimapEnabled={minimapEnabled}
              showLineNumbers={showLineNumbers}
              fontSize={fontSize}
              onDarkModeChange={setIsDarkMode}
              onWordWrapChange={setWordWrap}
              onMinimapEnabledChange={setMinimapEnabled}
              onShowLineNumbersChange={setShowLineNumbers}
              onFontSizeChange={setFontSize}
              onClose={() => setShowSettingsPanel(false)}
              labels={{
                title: t('settingsPanel.title'),
                theme: t('settingsPanel.theme'),
                darkTheme: t('settingsPanel.darkTheme'),
                lightTheme: t('settingsPanel.lightTheme'),
                wordWrap: t('settingsPanel.wordWrap'),
                minimap: t('settingsPanel.minimap'),
                lineNumbers: t('settingsPanel.lineNumbers'),
                fontSize: t('settingsPanel.fontSize'),
                close: t('settingsPanel.close'),
              }}
            />
          )}

          {saveError && (
            <div className="px-3 py-1.5 text-xs text-red-700 bg-red-50 border-b border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-900/40">
              {saveError}
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {isBinaryFile ? (
              <CodeEditorBinaryPlaceholder
                filePath={file.path}
                projectPath={file.projectPath}
                message={t('binary.message')}
                detail={t('binary.detail')}
              />
            ) : isImageFile && file.projectName ? (
              <CodeEditorImagePreview
                projectName={file.projectName}
                fileName={file.name}
                filePath={file.path}
                projectPath={file.projectPath}
                loadingLabel={t('image.loading')}
                errorLabel={t('image.error')}
              />
            ) : (
              <CodeEditorSurface
                content={content}
                onChange={setContent}
                markdownPreview={markdownPreview}
                isMarkdownFile={isMarkdownFile}
                isDarkMode={isDarkMode}
                fontSize={fontSize}
                showLineNumbers={showLineNumbers}
                extensions={extensions}
              />
            )}
          </div>

          {!isBinaryFile && !isImageFile && (
            <CodeEditorFooter
              content={content}
              linesLabel={t('footer.lines')}
              charactersLabel={t('footer.characters')}
              shortcutsLabel={t('footer.shortcuts')}
            />
          )}
        </div>
      </div>
    </>
  );
}
