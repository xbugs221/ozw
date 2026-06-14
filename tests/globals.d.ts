/**
 * Type declarations for ozw test globals.
 *
 * These are intentionally typed as `any` because they are test-only
 * instrumentation injected by individual test files. They are not
 * part of the production type surface and are explicitly isolated
 * here to keep tsconfig.test.json in the root build graph without
 * requiring strict typing of test fixtures.
 */
declare global {
  interface Window {
    // WebSocket test instrumentation
    __ozw_ws_sent: any[];
    __ozw_ws_last_data: any;
    __ozwTestCloseWebSocket: (() => void) | undefined;
    __trackedSocketMessages: any[];
    __trackedSockets: any[];
    __capturedWsMessages: any[];

    // Codex realtime test instrumentation
    __emitCodexRealtime: ((event: any) => void) | undefined;
    __codexRealtimeSocket: any;

    // Codex notification test instrumentation
    __emitCodexNotification: ((event: any) => void) | undefined;
    __codexNotificationSocket: any;

    // Manual session test helpers
    __lastManualSessionPromptDefault: string | undefined;
  }
}

export {};
