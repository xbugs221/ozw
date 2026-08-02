// @ts-nocheck -- Runtime diagnostics aggregate legacy JS-shaped objects.
/**
 * PURPOSE: Build one user-facing capability report for optional oz workflow
 * and agent CLIs, so the UI exposes only sessions users can start.
 */
import { resolveExecutablePath } from './executable-resolver.js';
import { getRuntimeDependencyDiagnostics } from './runtime-dependencies.js';
import {
  createSuccessfulAsyncProbeCache,
  runAsyncCommandProbe,
} from './utils/async-command-probe.js';

/** Providers that ozw can create and run as new browser conversations. */
const AGENT_COMMANDS = ['codex', 'pi', 'claude'];
const CLI_AVAILABILITY_CACHE_TTL_MS = 5 * 60 * 1000;

export type CliAvailability = {
  name: string;
  available: boolean;
  commandPath: string;
  version: string;
  authenticated: 'unknown';
  requiredAction: string;
  error: string;
};

const cliAvailabilityCache = createSuccessfulAsyncProbeCache<CliAvailability>({
  ttlMs: CLI_AVAILABILITY_CACHE_TTL_MS,
  isSuccess: (value) => Boolean(value?.available),
});

/**
 * Probe one non-oz CLI using PATH resolution and a lightweight --version call.
 */
export async function checkCliAvailability(commandName, options = {}): Promise<CliAvailability> {
  /**
   * PURPOSE: Report whether the service process can execute one agent CLI
   * without attempting auth flows or reading private credentials.
   */
  const env = options.env || process.env;
  const commandPath = resolveExecutablePath(commandName, { env });
  if (!commandPath) {
    return {
      name: commandName,
      available: false,
      commandPath: '',
      version: '',
      authenticated: 'unknown',
      requiredAction: `Install ${commandName} CLI and ensure the service PATH can find it. Then run ${commandName} login.`,
      error: `${commandName} not found in PATH: ${env.PATH || ''}`,
    };
  }

  const cacheKey = `${commandName}\0${commandPath}\0${env.PATH || ''}`;
  return cliAvailabilityCache.run(cacheKey, async () => {
    /** Cache only an executable that completed its version command successfully. */
    const result = await runAsyncCommandProbe(commandPath, ['--version'], {
      env,
      timeoutMs: options.timeoutMs,
    });
    const version = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    const detail = result.error ? result.error.message : version || `exit ${result.status}`;
    const available = result.status === 0;
    return {
      name: commandName,
      available,
      commandPath,
      version,
      authenticated: 'unknown',
      requiredAction: buildRequiredAction(commandName, { available, authenticated: 'unknown' }),
      error: available ? '' : `${commandName} --version failed; detail: ${detail}; PATH=${env.PATH || ''}`,
    };
  });
}

/**
 * Convert command state into the next action a user can execute.
 */
export function buildRequiredAction(commandName, state) {
  /**
   * PURPOSE: Keep readiness output actionable even when provider auth status
   * cannot be determined through a stable non-interactive command.
   */
  if (!state.available) {
    return `Install ${commandName} CLI and ensure the service PATH can find it. Then run ${commandName} login.`;
  }
  if (state.authenticated === 'unknown') {
    return `If workflows need ${commandName}, run ${commandName} login before starting.`;
  }
  if (state.authenticated === false) {
    return `Run ${commandName} login before starting.`;
  }
  return '';
}

/**
 * Adapt the legacy oz diagnostics into the unified command readiness shape.
 */
function buildOzReadiness(ozDiagnostics) {
  /**
   * PURPOSE: Preserve the oz flow contract as the source of workflow readiness
   * while exposing fields shared with Codex and Pi.
   */
  const available = Boolean(ozDiagnostics.command_path) && Boolean(ozDiagnostics.version?.ok);
  const contractOk = Boolean(ozDiagnostics.contract?.ok);
  const error = [
    ozDiagnostics.version?.error || '',
    ozDiagnostics.contract?.error || '',
  ].filter(Boolean).join(' ');
  return {
    name: 'oz',
    available,
    commandPath: ozDiagnostics.command_path || '',
    version: ozDiagnostics.version?.output || '',
    authenticated: null,
    requiredAction: available && contractOk
      ? ''
      : 'Install a compatible oz CLI and ensure oz flow contract --json exposes list-changes, run, resume, status, and abort.',
    error,
    canStartWorkflow: available && contractOk,
  };
}

/**
 * Build the complete runtime readiness read model.
 */
export async function buildRuntimeReadinessReport(options = {}) {
  /**
   * PURPOSE: Provide a stable single report for settings, startup diagnostics,
   * and tests that need oz, Codex, and Pi readiness in one payload.
   */
  const env = options.env || process.env;
  const [ozDiagnostics, ...agentDiagnostics] = await Promise.all([
    getRuntimeDependencyDiagnostics({ env, timeoutMs: options.timeoutMs }),
    ...AGENT_COMMANDS.map((commandName) => checkCliAvailability(commandName, { env, timeoutMs: options.timeoutMs })),
  ]);
  const commands = {
    oz: buildOzReadiness(ozDiagnostics.commands.oz),
  };
  for (const [index, commandName] of AGENT_COMMANDS.entries()) {
    commands[commandName] = agentDiagnostics[index];
  }

  const manualSessions = AGENT_COMMANDS.filter((commandName) => commands[commandName].available);
  const workflows = commands.oz.canStartWorkflow;
  return {
    /** A usable installation has at least one independently startable capability. */
    ready: manualSessions.length > 0 || workflows,
    commands,
    capabilities: {
      manualSessions,
      workflows,
    },
    path: env.PATH || '',
  };
}

/** Clear agent CLI probe state for deterministic cache and retry tests. */
export function clearCliAvailabilityCacheForTest() {
  /** Tests may replace a failing executable at the same path before retrying. */
  cliAvailabilityCache.clear();
}
