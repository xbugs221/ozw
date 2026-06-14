// @ts-nocheck -- Complex cross-module type dependencies; needs dedicated pass.
/**
 * PURPOSE: Resolve and validate external oz CLI commands required by the ozw
 * workflow control plane before the web server starts.
 */
import { execFileSync, spawnSync } from 'child_process';
import { resolveExecutablePath } from './executable-resolver.js';

const REQUIRED_COMMANDS = ['oz'];
const RUNNER_COMMAND_NAME = 'oz';
const RUNNER_ARGS_PREFIX = ['flow'];
const RUNNER_CONTRACT_COMMAND = [...RUNNER_ARGS_PREFIX, 'contract', '--json'];
const REQUIRED_RUNNER_CAPABILITIES = ['list-changes', 'run', 'resume', 'status', 'abort'];
const GRAPH_CAPABILITY = 'graph';

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
function readCommandVersion(commandName, commandPath, env = process.env) {
  /**
   * PURPOSE: Execute a CLI version probe using the same environment that was
   * used to resolve the command path.
   */
  const result = spawnSync(commandPath || commandName, ['--version'], { encoding: 'utf8', env });
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
function checkRunnerContract(commandPath, env = process.env) {
  /**
   * PURPOSE: Validate the oz workflow contract without depending on ambient
   * process.env during tests or diagnostics.
   */
  const result = spawnSync(commandPath || RUNNER_COMMAND_NAME, RUNNER_CONTRACT_COMMAND, { encoding: 'utf8', env });
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
function checkGraphCapability(commandPath, contractCapabilities, env = process.env) {
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
  const result = spawnSync(commandPath || RUNNER_COMMAND_NAME, graphHelpArgs, { encoding: 'utf8', env });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase().trim();

  // Many CLIs return non-zero for --help while still printing valid usage.
  // Parse the output regardless of exit code; only abort on spawn error.
  if (result.error) {
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
 * Resolve all required workflow binaries and fail fast with actionable context.
 */
export function checkRequiredRuntimeDependencies() {
  const diagnostics = getRuntimeDependencyDiagnostics();
  const missing = Object.entries(diagnostics.commands)
    .filter(([, command]) => !command.command_path)
    .map(([name]) => name);
  const incompatible = [];
  if (diagnostics.commands.oz.command_path && !diagnostics.commands.oz.version.ok) {
    incompatible.push('oz --version');
  }
  if (diagnostics.commands.oz.command_path && !diagnostics.commands.oz.contract.ok) {
    incompatible.push(`oz flow contract: ${diagnostics.commands.oz.contract.missing.join(', ')}`);
  }
  if (missing.length > 0 || incompatible.length > 0) {
    throw new Error([
      'Missing or incompatible required workflow binaries.',
      missing.length > 0 ? `Missing from PATH: ${missing.join(', ')}` : '',
      incompatible.length > 0 ? `Incompatible: ${incompatible.join('; ')}` : '',
      'Install oz manually, then ensure the service process PATH can see it.',
      `PATH=${process.env.PATH || ''}`,
    ].filter(Boolean).join(' '));
  }
  return diagnostics;
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
  const commands = {};
  for (const commandName of REQUIRED_COMMANDS) {
    const commandPath = resolveExecutablePath(commandName, { env });
    commands[commandName] = {
      name: commandName,
      command_path: commandPath,
      path: commandPath,
      version: commandPath ? readCommandVersion(commandName, commandPath, env) : { ok: false, output: '', error: `${commandName} not found in PATH: ${env.PATH || ''}` },
    };
  }
  commands.oz.contract = commands.oz.command_path
    ? checkRunnerContract(commands.oz.command_path, env)
    : { ok: false, required: [`${RUNNER_COMMAND_NAME} ${RUNNER_CONTRACT_COMMAND.join(' ')}`], missing: ['oz'], error: `oz not found in PATH: ${env.PATH || ''}` };
  commands.oz.graph = commands.oz.command_path && commands.oz.contract.ok
    ? checkGraphCapability(commands.oz.command_path, commands.oz.contract.capabilities, env)
    : { ok: false, available: false, contract_declared: false, error: 'oz not available for graph capability check', detail: '' };
  return {
    ok: REQUIRED_COMMANDS.every((commandName) => Boolean(commands[commandName].command_path))
      && commands.oz.version.ok
      && commands.oz.contract.ok,
    commands,
    path: env.PATH || '',
  };
}

/**
 * Run a required binary and parse its JSON stdout contract.
 */
export function runJsonCommand(commandName, args, options = {}) {
  const stdout = execFileSync(commandName, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: options.maxBuffer || 1024 * 1024 * 4,
  });
  return JSON.parse(stdout || '{}');
}
