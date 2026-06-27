/**
 * PURPOSE: Keep chat provider, model, and reasoning-depth state aligned with the active session.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedFetch } from '../../../utils/api';
import { CODEX_REASONING_EFFORTS } from '../../../../shared/modelConstants';
import type { PendingPermissionRequest, PermissionMode } from '../types/types';
import type { ProjectSession, SessionProvider } from '../../../types/app';

interface UseChatProviderStateArgs {
  selectedSession: ProjectSession | null;
}

type CodexReasoningOption = {
  value: string;
  label: string;
  description?: string;
};

type CodexServiceTierOption = {
  id: string;
  label: string;
  description?: string;
};

type CodexModelOption = {
  value: string;
  label: string;
  defaultReasoningEffort: string;
  reasoningOptions: CodexReasoningOption[];
  serviceTiers: CodexServiceTierOption[];
  defaultServiceTier?: string | null;
};

type PiThinkingOption = {
  value: string;
  label: string;
  description?: string;
};

type PiModelOption = {
  value: string;
  label: string;
  defaultThinkingLevel: string;
  thinkingOptions: PiThinkingOption[];
};

const SUPPORTED_PROVIDERS: SessionProvider[] = ['codex', 'pi'];
const FALLBACK_CODEX_MODEL_OPTIONS: CodexModelOption[] = [];
const FALLBACK_PI_MODEL_OPTIONS: PiModelOption[] = [];
const DEFAULT_PI_THINKING_OPTIONS: PiThinkingOption[] = [{ value: 'off', label: 'Off' }];
const DEFAULT_CODEX_REASONING_OPTIONS: CodexReasoningOption[] = CODEX_REASONING_EFFORTS.OPTIONS.map((reasoningOption) => ({
  value: reasoningOption.value,
  label: reasoningOption.label,
  description: reasoningOption.description,
}));

function getModelValues(modelOptions: Array<{ value: string }>): Set<string> {
  return new Set(modelOptions.map((option) => option.value));
}

function getCodexModelValues(modelOptions: CodexModelOption[]): Set<string> {
  return getModelValues(modelOptions);
}

function getPiModelOption(modelOptions: PiModelOption[], model: string): PiModelOption {
  return modelOptions.find((option) => option.value === model) || modelOptions[0] || {
    value: model,
    label: model,
    defaultThinkingLevel: 'off',
    thinkingOptions: DEFAULT_PI_THINKING_OPTIONS,
  };
}

/**
 * Resolve the default Codex model from the active catalog.
 * @param {CodexModelOption[]} modelOptions - Available Codex models.
 * @returns {string} Default Codex model value.
 */
function getDefaultCodexModel(modelOptions: CodexModelOption[]): string {
  return modelOptions[0]?.value || '';
}

/**
 * Check whether a persisted value is an actual Codex model instead of a provider alias.
 * @param {CodexModelOption[]} modelOptions - Available Codex models.
 * @param {string} model - Persisted model value.
 * @returns {boolean} Whether the model can be selected by the UI.
 */
function isSelectableCodexModel(modelOptions: CodexModelOption[], model: string): boolean {
  return getCodexModelValues(modelOptions).has(model.trim());
}

function getStoredCodexReasoningEffort(): string {
  return localStorage.getItem('codex-reasoning-effort') || CODEX_REASONING_EFFORTS.DEFAULT;
}

function getStoredCodexServiceTier(): string {
  /** Restore the user's Fast-mode preference for Codex models that support it. */
  return localStorage.getItem('codex-service-tier') || '';
}

function getStoredPiModel(modelOptions: PiModelOption[]): string {
  const storedModel = localStorage.getItem('pi-model');
  if (modelOptions.length === 0) {
    return '';
  }
  if (storedModel && getModelValues(modelOptions).has(storedModel)) {
    return storedModel;
  }
  return modelOptions[0]?.value || '';
}

function getStoredPiThinkingLevel(): string {
  return localStorage.getItem('pi-thinking-level') || 'medium';
}

/**
 * Resolve the active Codex model config when the model catalog is missing or delayed.
 * @param {CodexModelOption[]} modelOptions - Available Codex models.
 * @param {string} model - Selected Codex model value.
 * @returns {CodexModelOption} Model config with usable reasoning options.
 */
function getCodexModelOption(modelOptions: CodexModelOption[], model: string): CodexModelOption {
  return modelOptions.find((option) => option.value === model) || modelOptions[0] || {
    value: model,
    label: model,
    defaultReasoningEffort: CODEX_REASONING_EFFORTS.DEFAULT,
    reasoningOptions: DEFAULT_CODEX_REASONING_OPTIONS,
    serviceTiers: [],
    defaultServiceTier: null,
  };
}

function getCodexFastServiceTier(modelOption: CodexModelOption): string {
  /** Match the catalog-driven Fast tier id used by Codex's /fast command. */
  return modelOption.serviceTiers.find((tier) =>
    tier.id.toLowerCase() === 'fast' || tier.label.toLowerCase() === 'fast'
  )?.id || '';
}

function normalizeProvider(value: unknown): SessionProvider {
  return SUPPORTED_PROVIDERS.includes(value as SessionProvider) ? (value as SessionProvider) : 'codex';
}

function getStoredProvider(): SessionProvider {
  return normalizeProvider(localStorage.getItem('selected-provider'));
}

/**
 * Resolve Codex model from local storage while preferring the current default.
 * Legacy stored default is upgraded to keep new sessions on the latest model.
 * @param {CodexModelOption[]} modelOptions - Available Codex models.
 * @returns {string} Effective codex model.
 */
function getStoredCodexModel(modelOptions: CodexModelOption[]): string {
  const codexModelValues = getCodexModelValues(modelOptions);
  const storedModel = localStorage.getItem('codex-model');
  if (!storedModel) {
    return getDefaultCodexModel(modelOptions);
  }

  if (!codexModelValues.has(storedModel)) {
    const nextModel = getDefaultCodexModel(modelOptions);
    localStorage.setItem('codex-model', nextModel);
    return nextModel;
  }

  return storedModel;
}

export function useChatProviderState({ selectedSession }: UseChatProviderStateArgs) {
  const [provider, setProviderState] = useState<SessionProvider>(() => getStoredProvider());
  const permissionMode: PermissionMode = 'bypassPermissions';
  const [pendingPermissionRequests, setPendingPermissionRequests] = useState<PendingPermissionRequest[]>([]);
  const [codexModelOptions, setCodexModelOptions] = useState<CodexModelOption[]>(FALLBACK_CODEX_MODEL_OPTIONS);
  const [codexModel, setCodexModelState] = useState<string>(() => {
    return getStoredCodexModel(FALLBACK_CODEX_MODEL_OPTIONS);
  });
  const [codexReasoningEffort, setCodexReasoningEffortState] = useState<string>(() => {
    return getStoredCodexReasoningEffort();
  });
  const [codexServiceTier, setCodexServiceTierState] = useState<string>(() => {
    return getStoredCodexServiceTier();
  });
  const [piModelOptions, setPiModelOptions] = useState<PiModelOption[]>(FALLBACK_PI_MODEL_OPTIONS);
  const [piModel, setPiModelState] = useState<string>(() => getStoredPiModel(FALLBACK_PI_MODEL_OPTIONS));
  const [piThinkingLevel, setPiThinkingLevelState] = useState<string>(() => getStoredPiThinkingLevel());
  const [piModelCatalogLoaded, setPiModelCatalogLoaded] = useState(false);

  const lastProviderRef = useRef(provider);
  const codexReasoningEffortRef = useRef(codexReasoningEffort);
  const piThinkingLevelRef = useRef(piThinkingLevel);

  useEffect(() => {
    codexReasoningEffortRef.current = codexReasoningEffort;
  }, [codexReasoningEffort]);

  useEffect(() => {
    piThinkingLevelRef.current = piThinkingLevel;
  }, [piThinkingLevel]);

  const setCodexModel = useCallback((nextModel: string) => {
    setCodexModelState(nextModel);
    localStorage.setItem('codex-model', nextModel);
  }, []);

  const setCodexReasoningEffort = useCallback((nextEffort: string) => {
    setCodexReasoningEffortState(nextEffort);
    localStorage.setItem('codex-reasoning-effort', nextEffort);
  }, []);

  const setCodexServiceTier = useCallback((nextServiceTier: string) => {
    setCodexServiceTierState(nextServiceTier);
    if (nextServiceTier) {
      localStorage.setItem('codex-service-tier', nextServiceTier);
      return;
    }
    localStorage.removeItem('codex-service-tier');
  }, []);

  const setPiModel = useCallback((nextModel: string) => {
    setPiModelState(nextModel);
    localStorage.setItem('pi-model', nextModel);
  }, []);

  const setPiThinkingLevel = useCallback((nextLevel: string) => {
    setPiThinkingLevelState(nextLevel);
    localStorage.setItem('pi-thinking-level', nextLevel);
  }, []);

  const setProvider = useCallback((nextProvider: SessionProvider) => {
    const normalizedProvider = normalizeProvider(nextProvider);
    setProviderState(normalizedProvider);
    localStorage.setItem('selected-provider', normalizedProvider);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadPiModelCatalog() {
      try {
        const response = await authenticatedFetch('/api/pi/models');
        if (!response.ok) {
          if (!isCancelled) {
            setPiModelOptions([]);
            setPiModelState('');
            setPiModelCatalogLoaded(true);
          }
          return;
        }

        const data = await response.json();
        if (!data?.success || !Array.isArray(data?.models)) {
          if (!isCancelled) {
            setPiModelOptions([]);
            setPiModelState('');
            setPiModelCatalogLoaded(true);
          }
          return;
        }

        const normalizedModelOptions = data.models.map((model: PiModelOption) => ({
          value: model.value,
          label: model.label,
          defaultThinkingLevel: model.defaultThinkingLevel || 'off',
          thinkingOptions: Array.isArray(model.thinkingOptions) && model.thinkingOptions.length > 0
            ? model.thinkingOptions
            : DEFAULT_PI_THINKING_OPTIONS,
        }));

        if (!isCancelled) {
          setPiModelOptions(normalizedModelOptions);
          setPiModelCatalogLoaded(true);
        }
      } catch (error) {
        console.error('Failed to load Pi model catalog:', error);
        if (!isCancelled) {
          setPiModelOptions([]);
          setPiModelState('');
          setPiModelCatalogLoaded(true);
        }
      }
    }

    void loadPiModelCatalog();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    async function loadCodexModelCatalog() {
      try {
        const response = await authenticatedFetch('/api/codex/models');
        if (!response.ok) {
          return;
        }

        const data = await response.json();
        if (!data?.success || !Array.isArray(data?.models) || data.models.length === 0) {
          return;
        }

        const normalizedModelOptions = data.models.map((model: CodexModelOption) => ({
          value: model.value,
          label: model.label,
          defaultReasoningEffort: model.defaultReasoningEffort || CODEX_REASONING_EFFORTS.DEFAULT,
          reasoningOptions: Array.isArray(model.reasoningOptions) && model.reasoningOptions.length > 0
            ? model.reasoningOptions
            : CODEX_REASONING_EFFORTS.OPTIONS,
          serviceTiers: Array.isArray(model.serviceTiers) ? model.serviceTiers : [],
          defaultServiceTier: typeof model.defaultServiceTier === 'string' ? model.defaultServiceTier : null,
        }));

        if (!isCancelled) {
          setCodexModelOptions(normalizedModelOptions);
        }
      } catch (error) {
        console.error('Failed to load Codex model catalog:', error);
      }
    }

    void loadCodexModelCatalog();
    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    const sessionModel = typeof selectedSession?.model === 'string' ? selectedSession.model.trim() : '';
    if (
      selectedSession?.__provider === 'codex'
      && sessionModel
      && isSelectableCodexModel(codexModelOptions, sessionModel)
    ) {
      return;
    }

    if (selectedSession?.__provider === 'codex' && sessionModel) {
      const defaultModel = getDefaultCodexModel(codexModelOptions);
      if (codexModel !== defaultModel) {
        setCodexModelState(defaultModel);
      }
      return;
    }

    const modelValues = getCodexModelValues(codexModelOptions);
    if (modelValues.size === 0) {
      if (codexModel) {
        setCodexModel('');
      }
      return;
    }

    if (modelValues.has(codexModel)) {
      return;
    }

    const nextModel = getStoredCodexModel(codexModelOptions);
    setCodexModel(nextModel);
    localStorage.setItem('codex-model', nextModel);
  }, [codexModel, codexModelOptions, selectedSession?.__provider, selectedSession?.model]);

  useEffect(() => {
    const activeModel = getCodexModelOption(codexModelOptions, codexModel);
    const reasoningValues = new Set(activeModel.reasoningOptions.map((option) => option.value));
    if (reasoningValues.has(codexReasoningEffort)) {
      return;
    }

    const nextEffort = activeModel.defaultReasoningEffort || CODEX_REASONING_EFFORTS.DEFAULT;
    setCodexReasoningEffort(nextEffort);
  }, [codexModel, codexModelOptions, codexReasoningEffort, setCodexReasoningEffort]);

  const codexReasoningOptions = getCodexModelOption(codexModelOptions, codexModel).reasoningOptions;
  const codexModelOption = getCodexModelOption(codexModelOptions, codexModel);
  const codexServiceTierOptions = codexModelOption.serviceTiers;
  const codexFastServiceTier = getCodexFastServiceTier(codexModelOption);

  useEffect(() => {
    const activeModel = getCodexModelOption(codexModelOptions, codexModel);
    const fastTier = getCodexFastServiceTier(activeModel);
    if (!codexServiceTier) {
      return;
    }
    if (codexServiceTier === fastTier) {
      return;
    }
    setCodexServiceTier('');
  }, [codexModel, codexModelOptions, codexServiceTier, setCodexServiceTier]);

  const piThinkingOptions = getPiModelOption(piModelOptions, piModel).thinkingOptions;

  useEffect(() => {
    const values = getModelValues(piModelOptions);
    if (values.size === 0) {
      if (piModel) {
        setPiModel('');
      }
      return;
    }
    if (values.has(piModel)) {
      return;
    }
    setPiModel(getStoredPiModel(piModelOptions));
  }, [piModel, piModelOptions, setPiModel]);

  useEffect(() => {
    // Guard: catalog not loaded yet — don't override the stored thinking level,
    // which may be 'medium' (the default from getStoredPiThinkingLevel) while
    // the fallback piThinkingOptions only has 'off', causing a hard reset to 'off'.
    if (piModelOptions.length === 0) {
      return;
    }
    const thinkingValues = new Set(piThinkingOptions.map((option) => option.value));
    if (thinkingValues.has(piThinkingLevel)) {
      return;
    }
    setPiThinkingLevel(getPiModelOption(piModelOptions, piModel).defaultThinkingLevel || 'off');
  }, [piModel, piModelOptions, piThinkingLevel, piThinkingOptions, setPiThinkingLevel]);

  useEffect(() => {
    if (!selectedSession?.__provider || selectedSession.__provider === provider) {
      return;
    }

    const normalizedProvider = normalizeProvider(selectedSession.__provider);
    if (normalizedProvider !== provider) {
      setProviderState(normalizedProvider);
      localStorage.setItem('selected-provider', normalizedProvider);
    }
  }, [provider, selectedSession?.__provider]);

  useEffect(() => {
    const sessionModel = typeof selectedSession?.model === 'string' ? selectedSession.model.trim() : '';
    if (!sessionModel) {
      return;
    }

    if (
      selectedSession?.__provider === 'codex'
      && !isSelectableCodexModel(codexModelOptions, sessionModel)
    ) {
      const defaultModel = getDefaultCodexModel(codexModelOptions);
      if (defaultModel !== codexModel) {
        setCodexModelState(defaultModel);
      }
      return;
    }

    if (selectedSession?.__provider === 'codex' && sessionModel !== codexModel) {
      setCodexModelState(sessionModel);
      return;
    }

    if (selectedSession?.__provider === 'pi' && getModelValues(piModelOptions).has(sessionModel) && sessionModel !== piModel) {
      setPiModel(sessionModel);
    }
  }, [codexModel, codexModelOptions, piModel, piModelOptions, selectedSession?.__provider, selectedSession?.id, selectedSession?.model, setPiModel]);

  useEffect(() => {
    const sessionReasoningEffort = typeof selectedSession?.reasoningEffort === 'string'
      ? selectedSession.reasoningEffort.trim()
      : '';
    if (
      selectedSession?.__provider !== 'codex'
      || !sessionReasoningEffort
      || sessionReasoningEffort === codexReasoningEffortRef.current
    ) {
      return;
    }

    setCodexReasoningEffort(sessionReasoningEffort);
  }, [
    selectedSession?.__provider,
    selectedSession?.id,
    selectedSession?.reasoningEffort,
    setCodexReasoningEffort,
  ]);

  useEffect(() => {
    const sessionThinkingLevel = typeof selectedSession?.thinkingLevel === 'string'
      ? selectedSession.thinkingLevel.trim()
      : '';
    if (
      selectedSession?.__provider !== 'pi'
      || !sessionThinkingLevel
      || sessionThinkingLevel === piThinkingLevelRef.current
    ) {
      return;
    }

    setPiThinkingLevel(sessionThinkingLevel);
  }, [
    selectedSession?.__provider,
    selectedSession?.id,
    selectedSession?.thinkingLevel,
    setPiThinkingLevel,
  ]);

  useEffect(() => {
    if (lastProviderRef.current === provider) {
      return;
    }
    setPendingPermissionRequests([]);
    lastProviderRef.current = provider;
  }, [provider]);

  useEffect(() => {
    setPendingPermissionRequests((previous) =>
      previous.filter((request) => !request.sessionId || request.sessionId === selectedSession?.id),
    );
  }, [selectedSession?.id]);

  return {
    provider,
    setProvider,
    codexModel,
    setCodexModel,
    codexModelOptions,
    codexReasoningEffort,
    setCodexReasoningEffort,
    codexReasoningOptions,
    codexServiceTier,
    setCodexServiceTier,
    codexServiceTierOptions,
    codexFastServiceTier,
    piModel,
    setPiModel,
    piModelOptions,
    piModelCatalogLoaded,
    piThinkingLevel,
    setPiThinkingLevel,
    piThinkingOptions,
    permissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
  };
}
