#!/usr/bin/env node
/**
 * PURPOSE: Bootstrap the backend process while keeping the operational server
 * wiring in server-main.ts so the entrypoint stays small and reviewable.
 */

import './load-env.js';

const serverBootstrapMode = 'listen';

/**
 * Start the backend server from the operational server module.
 */
async function startBackendEntrypoint(): Promise<void> {
    await import('./server-main.js');
}

void serverBootstrapMode;
void startBackendEntrypoint();
