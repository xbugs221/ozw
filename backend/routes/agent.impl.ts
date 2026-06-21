/**
 * PURPOSE: Preserve the historical agent route module path while the actual
 * route runtime lives under the backend agent domain boundary and dispatches
 * Codex work through the codex-app-server agent-session-runner.
 */

export { default, __agentRouteInternalsForTest } from '../domains/agent/agent-route-runtime.js';
