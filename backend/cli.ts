#!/usr/bin/env node
// @ts-nocheck -- CLI argument parsing and startup types pending.
/**
 * ozw CLI
 *
 * Provides command-line utilities for managing ozw
 *
 * Commands:
 *   (no args)     - Start the server (default)
 *   start         - Start the server
 *   status        - Show configuration and data locations
 *   update         - Show manual update instructions
 *   help          - Show help information
 *   version       - Show version information
 */

import fs from 'fs';
import path from 'path';
import {
    inspectRuntimeUserState,
    resolveRuntimeUserPaths,
} from './runtime-user-state.js';
import { resolvePackageRoot } from './utils/package-root.js';

const PKG_ROOT = resolvePackageRoot();

// ANSI color codes for terminal output
const colorEnabled = Boolean(process.stdout.isTTY) && !('NO_COLOR' in process.env);
const terminalColor = (code) => colorEnabled ? code : '';
const colors = {
    reset: terminalColor('\x1b[0m'),
    bright: terminalColor('\x1b[1m'),
    dim: terminalColor('\x1b[2m'),

    // Foreground colors
    cyan: terminalColor('\x1b[36m'),
    green: terminalColor('\x1b[32m'),
    yellow: terminalColor('\x1b[33m'),
    blue: terminalColor('\x1b[34m'),
    magenta: terminalColor('\x1b[35m'),
    white: terminalColor('\x1b[37m'),
    gray: terminalColor('\x1b[90m'),
};

// Helper to colorize text
const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    ok: (text) => `${colors.green}${text}${colors.reset}`,
    warn: (text) => `${colors.yellow}${text}${colors.reset}`,
    error: (text) => `${colors.yellow}${text}${colors.reset}`,
    tip: (text) => `${colors.blue}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

// Load package.json for version info
const packageJsonPath = path.join(PKG_ROOT, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const RELEASES_URL = 'https://github.com/xbugs221/ozw/releases/latest';

// Get the effective database path after user-state initialization.
function getDatabasePath() {
    /**
     * PURPOSE: Keep `ozw status` aligned with server startup defaults while
     * preserving explicit DATABASE_PATH overrides.
     */
    return process.env.DATABASE_PATH || resolveRuntimeUserPaths().databasePath;
}

// Get the installation directory
function getInstallDir() {
    return PKG_ROOT;
}

// Show status command
async function showStatus() {
    /**
     * PURPOSE: Report the same initialized user configuration consumed by server startup.
     */
    const runtimeState = await inspectRuntimeUserState();
    const effectiveEnv = runtimeState.effectiveEnv;
    console.log(`\n${c.bright('ozw - Status')}\n`);
    console.log(c.dim('═'.repeat(60)));

    // Version info
    console.log(`\n${c.info('[INFO]')} Version: ${c.bright(packageJson.version)}`);

    // Installation location
    const installDir = getInstallDir();
    console.log(`\n${c.info('[INFO]')} Installation Directory:`);
    console.log(`       ${c.dim(installDir)}`);

    // Database location
    const dbPath = runtimeState.databasePath;
    const dbExists = fs.existsSync(dbPath);
    console.log(`\n${c.info('[INFO]')} Database Location:`);
    console.log(`       ${c.dim(dbPath)}`);
    console.log(`       Status: ${dbExists ? c.ok('[OK] Exists') : c.warn('[WARN] Not created yet (will be created on first run)')}`);

    if (dbExists) {
        const stats = fs.statSync(dbPath);
        console.log(`       Size: ${c.dim((stats.size / 1024).toFixed(2) + ' KB')}`);
        console.log(`       Modified: ${c.dim(stats.mtime.toLocaleString())}`);
    }

    // Environment variables
    console.log(`\n${c.info('[INFO]')} Configuration:`);
    console.log(`       HOST: ${c.bright(effectiveEnv.HOST || '127.0.0.1')} ${c.dim(effectiveEnv.HOST ? '' : '(default)')}`);
    console.log(`       PORT: ${c.bright(effectiveEnv.PORT || '3001')} ${c.dim(effectiveEnv.PORT ? '' : '(default)')}`);
    console.log(`       DATABASE_PATH: ${c.dim(runtimeState.databasePath)}`);
    console.log(`       CONTEXT_WINDOW: ${c.dim(effectiveEnv.CONTEXT_WINDOW || '160000 (default)')}`);

    // Config file location
    const envFilePath = runtimeState.envPath;
    const envExists = runtimeState.envExists;
    console.log(`\n${c.info('[INFO]')} Configuration File:`);
    console.log(`       ${c.dim(envFilePath)}`);
    console.log(`       Status: ${envExists ? c.ok('[OK] Exists') : c.warn('[WARN] Not found (using defaults)')}`);
    const tokenStatus = runtimeState.accessTokenValid
        ? c.ok('[OK] Configured')
        : runtimeState.accessTokenConfigured
            ? c.warn('[WARN] Invalid (must contain exactly 32 characters)')
            : c.warn('[WARN] Not configured (will be generated on first start)');
    console.log(`       Access token: ${tokenStatus}`);

    console.log('\n' + c.dim('═'.repeat(60)));
    console.log(`\n${c.tip('[TIP]')} Hints:`);
    console.log(`      ${c.dim('>')} Use ${c.bright('ozw --port 8080')} to run on a custom port`);
    console.log(`      ${c.dim('>')} Use ${c.bright('ozw --database-path /path/to/db')} for custom database`);
    console.log(`      ${c.dim('>')} Run ${c.bright('ozw help')} for all options`);
    const displayHost = (effectiveEnv.HOST || '127.0.0.1') === '0.0.0.0' ? '127.0.0.1' : (effectiveEnv.HOST || '127.0.0.1');
    console.log(`      ${c.dim('>')} Access the UI at http://${displayHost}:${effectiveEnv.PORT || '3001'}\n`);
}

// Show help
function showHelp() {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              ozw - Command Line Tool               ║
╚═══════════════════════════════════════════════════════════════╝

Usage:
  ozw [command] [options]

Commands:
  start          Start the ozw server (default)
  status         Show configuration and data locations
  update         Show manual update instructions
  help           Show this help information
  version        Show version information

Options:
  -p, --port <port>           Set server port (default: 3001)
  --database-path <path>      Set custom database location
  -h, --help                  Show this help information
  -v, --version               Show version information

Examples:
  $ ozw                        # Start with defaults
  $ ozw --port 8080            # Start on port 8080
  $ ozw -p 3000                # Short form for port
  $ ozw start --port 4000      # Explicit start command
  $ ozw status                 # Show configuration

Environment Variables:
  HOST                Bind address (default: 127.0.0.1)
  PORT                Set server port (default: 3001)
  DATABASE_PATH       Set custom database location
  OZW_HOME            Set the user state directory (default: ~/.ozw)
  OZW_ACCESS_TOKEN    Set an exact 32-character browser access token
  CONTEXT_WINDOW      Set context window size (default: 160000)

Documentation:
  ${packageJson.homepage || 'https://github.com/xbugs221/ozw'}

Report Issues:
  ${packageJson.bugs?.url || 'https://github.com/xbugs221/ozw/issues'}
`);
}

// Show version
function showVersion() {
    console.log(`${packageJson.version}`);
}

// Show update guidance without performing network or installation work.
function showUpdateInstructions() {
    /**
     * PURPOSE: Keep update behavior explicit and distribution-neutral. The
     * public npm package is unavailable, so the CLI must not query or mutate it.
     */
    console.log(`${c.info('[INFO]')} Automatic CLI updates are not supported.`);
    console.log(`${c.info('[INFO]')} Current version: ${c.bright(packageJson.version)}`);
    console.log(`${c.tip('[TIP]')} Download the latest release from:`);
    console.log(`      ${RELEASES_URL}`);
}

// Start the server
async function startServer() {
    /**
     * PURPOSE: Start exclusively from local files so offline launches never
     * wait for an update service or package registry.
     */
    await import('./index.js');
}

// Parse CLI arguments
function parseArgs(args) {
    /**
     * PURPOSE: Reject malformed CLI input before configuration or database side effects occur.
     */
    if (args.includes('--help') || args.includes('-h')) return { command: 'help', options: {} };
    if (args.includes('--version') || args.includes('-v')) return { command: 'version', options: {} };

    const parsed = { command: 'start', options: {} };
    const commands = new Set(['start', 'status', 'info', 'help', 'version', 'update']);
    let positionalCommandSeen = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--port' || arg === '-p') {
            const value = args[++i];
            if (!value || value.startsWith('-')) throw new Error('--port requires a value');
            parsed.options.port = value;
        } else if (arg.startsWith('--port=')) {
            parsed.options.port = arg.slice('--port='.length);
        } else if (arg === '--database-path') {
            const value = args[++i];
            if (!value || value.startsWith('-')) throw new Error('--database-path requires a value');
            parsed.options.databasePath = value;
        } else if (arg.startsWith('--database-path=')) {
            parsed.options.databasePath = arg.slice('--database-path='.length);
        } else if (arg.startsWith('-')) {
            throw new Error(`Unknown option: ${arg}`);
        } else if (!arg.startsWith('-')) {
            if (positionalCommandSeen) throw new Error(`Unexpected argument: ${arg}`);
            if (!commands.has(arg)) throw new Error(`Unknown command: ${arg}`);
            parsed.command = arg;
            positionalCommandSeen = true;
        }
    }

    if (parsed.options.port !== undefined) {
        const port = Number(parsed.options.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error('Port must be an integer between 1 and 65535');
        }
    }
    if (parsed.options.databasePath !== undefined && !parsed.options.databasePath.trim()) {
        throw new Error('--database-path requires a value');
    }

    return parsed;
}

// Main CLI handler
async function main() {
    const args = process.argv.slice(2);
    let parsed;
    try {
        parsed = parseArgs(args);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        console.error('Run "ozw help" for usage information.');
        process.exitCode = 2;
        return;
    }
    const { command, options } = parsed;

    // Apply CLI options to environment variables
    if (options.port) {
        process.env.PORT = options.port;
    }
    if (options.databasePath) {
        process.env.DATABASE_PATH = options.databasePath;
    }

    switch (command) {
        case 'start':
            await startServer();
            break;
        case 'status':
        case 'info':
            await showStatus();
            break;
        case 'help':
        case '-h':
        case '--help':
            showHelp();
            break;
        case 'version':
        case '-v':
        case '--version':
            showVersion();
            break;
        case 'update':
            showUpdateInstructions();
            break;
        default:
            console.error(`\n❌ Unknown command: ${command}`);
            console.log('   Run "ozw help" for usage information.\n');
            process.exit(1);
    }
}

// Run the CLI
main().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
});
