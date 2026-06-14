/**
 * PURPOSE: Render local CodeMirror display preferences from the editor header
 * without depending on the global application settings modal.
 */

type CodeEditorSettingsPanelProps = {
  isDarkMode: boolean;
  wordWrap: boolean;
  minimapEnabled: boolean;
  showLineNumbers: boolean;
  fontSize: number;
  onDarkModeChange: (value: boolean) => void;
  onWordWrapChange: (value: boolean) => void;
  onMinimapEnabledChange: (value: boolean) => void;
  onShowLineNumbersChange: (value: boolean) => void;
  onFontSizeChange: (value: number) => void;
  onClose: () => void;
  labels: {
    title: string;
    theme: string;
    darkTheme: string;
    lightTheme: string;
    wordWrap: string;
    minimap: string;
    lineNumbers: string;
    fontSize: string;
    close: string;
  };
};

type ToggleRowProps = {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
};

function ToggleRow({ label, checked, onChange }: ToggleRowProps) {
  /**
   * Render a compact switch row for editor-only boolean preferences.
   */
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-gray-800 dark:text-gray-100">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4"
      />
    </label>
  );
}

export default function CodeEditorSettingsPanel({
  isDarkMode,
  wordWrap,
  minimapEnabled,
  showLineNumbers,
  fontSize,
  onDarkModeChange,
  onWordWrapChange,
  onMinimapEnabledChange,
  onShowLineNumbersChange,
  onFontSizeChange,
  onClose,
  labels,
}: CodeEditorSettingsPanelProps) {
  /**
   * Keep editor display controls close to the file being edited so users can
   * change wrapping and gutters without leaving the editor.
   */
  return (
    <div className="absolute right-3 top-12 z-20 w-64 rounded-md border border-border bg-background p-3 shadow-lg">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium text-foreground">{labels.title}</h4>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {labels.close}
        </button>
      </div>

      <div className="space-y-3">
        <label className="flex items-center justify-between gap-3 text-sm text-gray-800 dark:text-gray-100">
          <span>{labels.theme}</span>
          <select
            value={isDarkMode ? 'dark' : 'light'}
            onChange={(event) => onDarkModeChange(event.target.value === 'dark')}
            className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            <option value="dark">{labels.darkTheme}</option>
            <option value="light">{labels.lightTheme}</option>
          </select>
        </label>

        <ToggleRow label={labels.wordWrap} checked={wordWrap} onChange={onWordWrapChange} />
        <ToggleRow label={labels.minimap} checked={minimapEnabled} onChange={onMinimapEnabledChange} />
        <ToggleRow label={labels.lineNumbers} checked={showLineNumbers} onChange={onShowLineNumbersChange} />

        <label className="flex items-center justify-between gap-3 text-sm text-gray-800 dark:text-gray-100">
          <span>{labels.fontSize}</span>
          <select
            value={fontSize}
            onChange={(event) => onFontSizeChange(Number(event.target.value))}
            className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
          >
            {[10, 11, 12, 13, 14, 15, 16, 18, 20].map((size) => (
              <option key={size} value={size}>{size}px</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
