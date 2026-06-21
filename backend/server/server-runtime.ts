#!/usr/bin/env node
/**
 * PURPOSE: Keep the backend server entrypoint small while the legacy runtime lives in a lifecycle module.
 */
export { startBackendServer } from './server-runtime.impl.js';
