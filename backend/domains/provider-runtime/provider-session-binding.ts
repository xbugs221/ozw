/**
 * File purpose: centralize cN route to provider session binding reads and
 * writes for websocket and message-history code paths.
 */

import {
  bindManualSessionProvider,
  getManualSessionRouteRuntime,
} from '../../projects.js';

export type ProviderSessionBinding = {
  provider: 'codex' | 'pi' | 'claude';
  providerSessionId: string;
  projectName?: string;
  projectPath?: string;
};

/**
 * Read the provider binding stored for a cN route session.
 */
export async function readProviderSessionBinding(projectName: string, projectPath: string, routeSessionId: string): Promise<ProviderSessionBinding | null> {
  const runtime = await getManualSessionRouteRuntime(projectName, projectPath, routeSessionId);
  if (!runtime?.providerSessionId) {
    return null;
  }
  return {
    provider: runtime.provider === 'pi' ? 'pi' : runtime.provider === 'claude' ? 'claude' : 'codex',
    providerSessionId: String(runtime.providerSessionId),
    projectName,
    projectPath,
  };
}

/**
 * Write or refresh the runtime provider binding for a cN route session.
 */
export async function writeProviderSessionBinding(input: {
  projectName?: string;
  projectPath: string;
  routeSessionId: string;
  provider: 'codex' | 'pi' | 'claude';
  providerSessionId: string;
}): Promise<void> {
  await bindManualSessionProvider(input.projectName || '', input.projectPath, input.routeSessionId, input.providerSessionId);
}

/**
 * Resolve a route binding and preserve provider choice while a draft is unbound.
 */
export async function resolveProviderSessionBinding(input: {
  projectName?: string;
  projectPath: string;
  routeSessionId: string;
  provider?: 'codex' | 'pi' | 'claude' | null;
}): Promise<ProviderSessionBinding> {
  const binding = await readProviderSessionBinding(input.projectName || '', input.projectPath, input.routeSessionId);
  if (binding) {
    return binding;
  }
  return {
    provider: input.provider === 'pi' ? 'pi' : input.provider === 'claude' ? 'claude' : 'codex',
    providerSessionId: '',
    projectName: input.projectName || '',
    projectPath: input.projectPath,
  };
}

/**
 * Verify that a provider binding belongs to the requested project route.
 */
export function assertProviderSessionProject(binding: ProviderSessionBinding | null, projectPath: string): void {
  if (binding?.projectPath && binding.projectPath !== projectPath) {
    throw new Error(`Provider session project mismatch: expected ${projectPath}, received ${binding.projectPath}`);
  }
}
