#!/usr/bin/env node
/**
 * PURPOSE: Typed backend bootstrap boundary that loads the legacy operational
 * server body while route and websocket responsibilities are being extracted.
 */

/**
 * Start the backend server by importing the legacy operational module.
 */
export async function startBackendServer(): Promise<void> {
  const legacyServer = await import('./server-main-legacy.js');
  await legacyServer.startBackendServer();
}

void startBackendServer();
