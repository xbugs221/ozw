// @ts-nocheck -- Runtime diagnostics aggregate legacy JS-shaped objects.
/**
 * PURPOSE: Build one user-facing capability report for optional oz workflow
 * and agent CLIs, so the UI exposes only sessions users can start.
 */
import { spawnSync } from 'child_process';
import { resolveExecutablePath } from './executable-resolver.js';
import { getRuntimeDependencyDiagnostics } from './runtime-dependencies.js';

/** Providers that ozw can create and run as new browser conversations. */
const AGENT_COMMANDS = ['codex', 'pi', 'claude'];

/**
 * Probe one non-oz CLI using PATH resolution and a lightweight --version call.
 */
export function checkCliAvailability(commandName, options = {}) {
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

  const result = spawnSync(commandPath, ['--version'], {
    encoding: 'utf8',
    env,
    timeout: 3000,
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
  const ozDiagnostics = getRuntimeDependencyDiagnostics({ env });
  const commands = {
    oz: buildOzReadiness(ozDiagnostics.commands.oz),
  };
  for (const commandName of AGENT_COMMANDS) {
    commands[commandName] = checkCliAvailability(commandName, { env });
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
