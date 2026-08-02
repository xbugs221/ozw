// @ts-nocheck -- Complex cross-module type dependencies; needs dedicated pass.
/**
 * PURPOSE: Resolve and diagnose the external oz CLI used by the optional ozw
 * workflow control plane without making server startup depend on it.
 */
import { resolveExecutablePath } from './executable-resolver.js';
import {
  createSuccessfulAsyncProbeCache,
  runAsyncCommandProbe,
} from './utils/async-command-probe.js';

const RUNNER_COMMAND_NAME = 'oz';
const RUNNER_ARGS_PREFIX = ['flow'];
const RUNNER_CONTRACT_COMMAND = [...RUNNER_ARGS_PREFIX, 'contract', '--json'];
const REQUIRED_RUNNER_CAPABILITIES = ['list-changes', 'run', 'resume', 'status', 'abort'];
const GRAPH_CAPABILITY = 'graph';
const RUNTIME_DIAGNOSTIC_CACHE_TTL_MS = 5 * 60 * 1000;
const runtimeDiagnosticCache = createSuccessfulAsyncProbeCache({
  ttlMs: RUNTIME_DIAGNOSTIC_CACHE_TTL_MS,
  isSuccess: (value) => Boolean(value?.ok),
});

/**
 * Build one actionable runtime dependency failure summary.
 */
function formatCommandFailure(commandName, args, detail = '', env = process.env) {
  /**
   * PURPOSE: Keep CLI failures actionable by including the exact service PATH
   * used for command discovery.
   */
  const subcommand = [commandName, ...args].join(' ');
  return [
    `${subcommand} failed`,
    detail ? `detail: ${detail}` : '',
    `PATH=${env.PATH || ''}`,
  ].filter(Boolean).join('; ');
}

/**
 * Execute a lightweight version command without throwing raw child-process
 * errors into startup logs.
 */
async function readCommandVersion(commandName, commandPath, env = process.env, timeoutMs = 3000) {
  /**
   * PURPOSE: Execute a CLI version probe using the same environment that was
   * used to resolve the command path.
   */
  const result = await runAsyncCommandProbe(commandPath || commandName, ['--version'], { env, timeoutMs });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  const detail = result.error ? result.error.message : output || `exit ${result.status}`;
  return {
    ok: result.status === 0,
    output,
    error: result.status === 0 ? '' : formatCommandFailure(commandName, ['--version'], detail, env),
  };
}

/**
 * Check that the Go runner exposes the non-interactive commands required by
 * the web adapter.
 */
async function checkRunnerContract(commandPath, env = process.env, timeoutMs = 3000) {
  /**
   * PURPOSE: Validate the oz workflow contract without depending on ambient
   * process.env during tests or diagnostics.
   */
  const result = await runAsyncCommandProbe(commandPath || RUNNER_COMMAND_NAME, RUNNER_CONTRACT_COMMAND, { env, timeoutMs });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  const contractText = `${RUNNER_COMMAND_NAME} ${RUNNER_CONTRACT_COMMAND.join(' ')}`;
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      required: [contractText],
      missing: [contractText],
      error: formatCommandFailure(RUNNER_COMMAND_NAME, RUNNER_CONTRACT_COMMAND, result.error ? result.error.message : output || `exit ${result.status}`, env),
    };
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch (error) {
    return {
      ok: false,
      required: [contractText],
      missing: ['valid JSON contract output'],
      error: formatCommandFailure(RUNNER_COMMAND_NAME, RUNNER_CONTRACT_COMMAND, `invalid JSON: ${error.message}`, env),
    };
  }
  const capabilities = Array.isArray(payload.capabilities)
    ? payload.capabilities.map((item) => String(item))
    : [];
  const missing = REQUIRED_RUNNER_CAPABILITIES.filter((capability) => !capabilities.includes(capability));
  if (payload.json !== true) {
    missing.push('json=true');
  }
  return {
    ok: missing.length === 0,
    required: [contractText],
    missing,
    capabilities,
    version: payload.version || '',
    error: missing.length === 0 ? '' : formatCommandFailure(RUNNER_COMMAND_NAME, RUNNER_CONTRACT_COMMAND, `missing ${missing.join(', ')}`, env),
  };
}

/**
 * Probe oz flow graph capability using a two-step strategy:
 * 1. If oz flow contract declares 'graph' in capabilities, it is available.
 * 2. Otherwise run a lightweight `oz flow graph --help` and check for --format/json support.
 */
async function checkGraphCapability(commandPath, contractCapabilities, env = process.env, timeoutMs = 3000) {
  /**
   * PURPOSE: Check optional graph support using the same PATH context as the
   * required workflow contract probe.
   */
  const contractDeclared = Array.isArray(contractCapabilities) && contractCapabilities.includes(GRAPH_CAPABILITY);
  if (contractDeclared) {
    return {
      ok: true,
      available: true,
      contract_declared: true,
      error: '',
      detail: 'graph capability declared in oz flow contract',
    };
  }

  const graphHelpArgs = [...RUNNER_ARGS_PREFIX, 'graph', '--help'];
  const result = await runAsyncCommandProbe(commandPath || RUNNER_COMMAND_NAME, graphHelpArgs, { env, timeoutMs });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase().trim();

  // Many CLIs return non-zero for --help while still printing valid usage.
  // Parse the output regardless of exit code; only abort on spawn error.
  if (result.error && result.status === null) {
    return {
      ok: false,
      available: false,
      contract_declared: false,
      error: formatCommandFailure(RUNNER_COMMAND_NAME, graphHelpArgs, result.error.message, env),
      detail: 'oz flow graph --help failed to spawn',
    };
  }

  const hasFormat = output.includes('--format') || output.includes('format');
  const hasJson = output.includes('json');
  if (hasFormat && hasJson) {
    return {
      ok: true,
      available: true,
      contract_declared: false,
      error: '',
      detail: `graph capability detected via oz flow graph --help output (exit ${result.status || 0}) but not declared in contract`,
    };
  }

  return {
    ok: true,
    available: false,
    contract_declared: false,
    error: '',
    detail: `oz flow graph --help did not advertise --format json support (exit ${result.status || 0})`,
  };
}

/**
 * Return workflow diagnostics for legacy callers without blocking startup.
 */
export function checkRequiredRuntimeDependencies(options = {}) {
  /**
   * PURPOSE: Preserve the old export for integrations while treating every
   * dependency as optional capability discovery instead of a startup gate.
   */
  return getRuntimeDependencyDiagnostics(options);
}

/**
 * Build diagnostics for settings and startup logs without exposing path
 * override controls.
 */
export function getRuntimeDependencyDiagnostics(options = {}) {
  /**
   * PURPOSE: Build the legacy oz-focused diagnostics object while allowing
   * tests and higher-level read models to supply an explicit environment.
   */
  const env = options.env || process.env;
  const commandPath = resolveExecutablePath(RUNNER_COMMAND_NAME, { env });
  const cacheKey = `${commandPath}\0${env.PATH || ''}`;
  return runtimeDiagnosticCache.run(cacheKey, async () => {
    /** Run independent version and contract probes together on the diagnostics request path. */
    const missingVersion = { ok: false, output: '', error: `${RUNNER_COMMAND_NAME} not found in PATH: ${env.PATH || ''}` };
    const missingContract = { ok: false, required: [`${RUNNER_COMMAND_NAME} ${RUNNER_CONTRACT_COMMAND.join(' ')}`], missing: ['oz'], error: `oz not found in PATH: ${env.PATH || ''}` };
    const [version, contract] = commandPath
      ? await Promise.all([
          readCommandVersion(RUNNER_COMMAND_NAME, commandPath, env, options.timeoutMs),
          checkRunnerContract(commandPath, env, options.timeoutMs),
        ])
      : [missingVersion, missingContract];
    const graph = commandPath && contract.ok
      ? await checkGraphCapability(commandPath, contract.capabilities, env, options.timeoutMs)
      : { ok: false, available: false, contract_declared: false, error: 'oz not available for graph capability check', detail: '' };
    const commands = {
      oz: {
        name: RUNNER_COMMAND_NAME,
        command_path: commandPath,
        path: commandPath,
        version,
        contract,
        graph,
      },
    };
    return {
      ok: Boolean(commandPath) && version.ok && contract.ok,
      commands,
      path: env.PATH || '',
    };
  });
}

/** Clear runtime probe state for deterministic cache and retry tests. */
export function clearRuntimeDependencyDiagnosticsCacheForTest() {
  /** Tests may change executable contents while keeping a stable temporary PATH. */
  runtimeDiagnosticCache.clear();
}
