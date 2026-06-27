/**
 * PURPOSE: Render compact provider model, reasoning-depth, and Codex speed controls in the chat composer.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

type ModelOption = {
  value: string;
  label: string;
};

type ReasoningOption = {
  value: string;
  label: string;
  description?: string;
};

type ServiceTierOption = {
  id: string;
  label: string;
  description?: string;
};

interface SessionModelControlsProps {
  provider?: 'codex' | 'pi' | string;
  codexModel: string;
  setCodexModel: (model: string) => void;
  codexModelOptions: ModelOption[];
  codexReasoningEffort: string;
  setCodexReasoningEffort: (effort: string) => void;
  codexReasoningOptions: ReasoningOption[];
  codexServiceTier?: string;
  setCodexServiceTier?: (serviceTier: string) => void;
  codexServiceTierOptions?: ServiceTierOption[];
  codexFastServiceTier?: string;
  piModel?: string;
  setPiModel?: (model: string) => void;
  piModelOptions?: ModelOption[];
  piThinkingLevel?: string;
  setPiThinkingLevel?: (level: string) => void;
  piThinkingOptions?: ReasoningOption[];
}

/**
 * Provide in-session controls for model, reasoning depth, and catalog-driven Codex Fast mode.
 */
export default function SessionModelControls({
  provider = 'codex',
  codexModel,
  setCodexModel,
  codexModelOptions,
  codexReasoningEffort,
  setCodexReasoningEffort,
  codexReasoningOptions,
  codexServiceTier = '',
  setCodexServiceTier,
  codexServiceTierOptions = [],
  codexFastServiceTier = '',
  piModel = '',
  setPiModel,
  piModelOptions = [],
  piThinkingLevel = '',
  setPiThinkingLevel,
  piThinkingOptions = [],
}: SessionModelControlsProps) {
  const controlsRef = useRef<HTMLDivElement>(null);
  const [openPicker, setOpenPicker] = useState<'model' | 'depth' | null>(null);

  const activeModel = provider === 'pi' ? piModel : codexModel;
  const activeModelOptions = provider === 'pi' ? piModelOptions : codexModelOptions;
  const activeDepth = provider === 'pi' ? piThinkingLevel : codexReasoningEffort;
  const activeDepthOptions = provider === 'pi' ? piThinkingOptions : codexReasoningOptions;
  const setActiveModel = provider === 'pi' ? setPiModel : setCodexModel;
  const setActiveDepth = provider === 'pi' ? setPiThinkingLevel : setCodexReasoningEffort;

  const currentModelLabel = useMemo(() => {
    return activeModelOptions.find((option) => option.value === activeModel)?.label || activeModel;
  }, [activeModel, activeModelOptions]);

  const currentDepthLabel = useMemo(() => {
    return activeDepthOptions.find((option) => option.value === activeDepth)?.label || activeDepth;
  }, [activeDepth, activeDepthOptions]);
  const fastServiceTier = useMemo(() => {
    return codexFastServiceTier || codexServiceTierOptions.find((option) =>
      option.id.toLowerCase() === 'fast' || option.label.toLowerCase() === 'fast'
    )?.id || '';
  }, [codexFastServiceTier, codexServiceTierOptions]);
  const showFastToggle = provider === 'codex' && Boolean(fastServiceTier) && Boolean(setCodexServiceTier);
  const fastEnabled = showFastToggle && codexServiceTier === fastServiceTier;

  useEffect(() => {
    /**
     * Close the lightweight pickers when the user clicks elsewhere or presses Escape.
     */
    const handlePointerDown = (event: PointerEvent) => {
      if (!controlsRef.current?.contains(event.target as Node)) {
        setOpenPicker(null);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenPicker(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const pickerButtonClassName = 'flex h-8 min-w-0 items-center gap-1 rounded-lg border border-border/60 bg-background/90 px-2.5 text-xs text-foreground transition-colors hover:bg-accent/60 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50';
  const optionButtonClassName = 'flex w-full min-w-0 items-center rounded-md px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent/60';

  return (
    <div ref={controlsRef} className="flex min-w-0 items-center gap-1.5">
      <select
        data-testid="session-model-select"
        value={activeModel}
        onChange={(event) => setActiveModel?.(event.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      >
        {activeModelOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <select
        data-testid="session-depth-select"
        value={activeDepth}
        onChange={(event) => setActiveDepth?.(event.target.value)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      >
        {activeDepthOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <div className="relative min-w-0">
        <button
          type="button"
          data-testid="session-model-trigger"
          className={`${pickerButtonClassName} max-w-36`}
          onClick={() => setOpenPicker((current) => (current === 'model' ? null : 'model'))}
          disabled={!setActiveModel || activeModelOptions.length === 0}
          aria-expanded={openPicker === 'model'}
          aria-haspopup="listbox"
          title={currentModelLabel}
        >
          <span className="min-w-0 truncate">{currentModelLabel}</span>
        </button>

        {openPicker === 'model' && (
          <div
            role="listbox"
            className="absolute bottom-full right-0 z-50 mb-2 max-h-72 w-48 overflow-y-auto rounded-lg border border-border/60 bg-card p-1 shadow-lg"
          >
            {activeModelOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === activeModel}
                className={`${optionButtonClassName} ${option.value === activeModel ? 'bg-accent/70 font-medium' : ''}`}
                onClick={() => {
                  setActiveModel?.(option.value);
                  setOpenPicker(null);
                }}
              >
                <span className="min-w-0 truncate">{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative min-w-0">
        <button
          type="button"
          data-testid="session-depth-trigger"
          className={`${pickerButtonClassName} max-w-28`}
          onClick={() => setOpenPicker((current) => (current === 'depth' ? null : 'depth'))}
          disabled={!setActiveDepth || activeDepthOptions.length === 0}
          aria-expanded={openPicker === 'depth'}
          aria-haspopup="listbox"
          title={currentDepthLabel}
        >
          <span className="min-w-0 truncate">{currentDepthLabel}</span>
        </button>

        {openPicker === 'depth' && (
          <div
            role="listbox"
            className="absolute bottom-full right-0 z-50 mb-2 max-h-72 w-40 overflow-y-auto rounded-lg border border-border/60 bg-card p-1 shadow-lg"
          >
            {activeDepthOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === activeDepth}
                className={`${optionButtonClassName} ${option.value === activeDepth ? 'bg-accent/70 font-medium' : ''}`}
                onClick={() => {
                  setActiveDepth?.(option.value);
                  setOpenPicker(null);
                }}
              >
                <span className="min-w-0 truncate">{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {showFastToggle && (
        <button
          type="button"
          data-testid="session-fast-toggle"
          aria-pressed={fastEnabled}
          className={`flex h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 ${
            fastEnabled
              ? 'border-emerald-500/70 bg-emerald-500 text-white shadow-[0_0_0_3px_rgba(16,185,129,0.16)]'
              : 'border-border/60 bg-background/90 text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          }`}
          onClick={() => setCodexServiceTier?.(fastEnabled ? '' : fastServiceTier)}
          title={fastEnabled ? 'Fast mode on' : 'Fast mode off'}
        >
          Fast
        </button>
      )}
    </div>
  );
}
