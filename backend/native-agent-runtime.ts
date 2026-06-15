/**
 * Native Agent Runtime
 * ====================
 *
 * Compatibility entrypoint for provider runtime coordination. The concrete
 * Codex app-server and Pi SDK routing lives under domains/provider-runtime.
 */

export {
  PROVIDER_CAPABILITIES,
  abortNativeSession,
  createNativeAgentRuntimeForTest,
  getActiveNativeSessions,
  getNativeSessionStatus,
  seedRunningCodexSessionForTest,
  seedRunningPiSessionForTest,
  sendNativeMessage,
  sendNativeMessage as sendProviderRuntimeMessage,
  __nativeAgentRuntimeInternalsForTest,
} from './domains/provider-runtime/runtime-router.js';

export {
  clearProviderLiveTranscriptSnapshot as clearPiSessionSnapshot,
  getProviderCompletedTranscriptSnapshot as getPiSessionCompletedSnapshot,
  getProviderLiveTranscriptSnapshot as getNativeSessionLiveTranscript,
} from './domains/provider-runtime/live-transcript-store.js';

export type {
  Provider,
  RunningBehavior,
  RuntimeEvent,
  RuntimeHarness,
  RuntimeWriter,
} from './domains/provider-runtime/runtime-router.js';
