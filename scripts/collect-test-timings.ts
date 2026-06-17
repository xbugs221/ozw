/**
 * 文件目的：采集关键测试质量门的真实运行耗时，输出可复查的 JSON 基线。
 * 业务场景：开发者需要知道 fast/smoke/full 质量门的耗时趋势，并确认失败命令不会被记录成成功。
 *
 * PURPOSE: Run configured test commands and persist their duration and exit code
 * so future test performance work has measurable baseline evidence.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_PROFILE = 'default';
// Default evidence path: test-results/test-performance/latest.json
const PROFILE_OUTPUT_DIR = 'test-results/test-performance';
const DEFAULT_COMMANDS: TimingCommand[] = [
  {
    id: 'typecheck',
    command: 'pnpm',
    args: ['run', 'typecheck'],
  },
  {
    id: 'vitest',
    command: 'pnpm',
    args: ['run', 'test:vitest'],
  },
  {
    id: 'server-smoke',
    command: 'pnpm',
    args: ['run', 'test:server:smoke'],
  },
];
const PROFILE_COMMANDS: Record<string, TimingCommand[]> = {
  fast: [
    {
      id: 'test-fast',
      command: 'pnpm',
      args: ['run', 'test:fast'],
    },
  ],
  smoke: [
    {
      id: 'test-smoke',
      command: 'pnpm',
      args: ['run', 'test:smoke'],
    },
  ],
  full: [
    {
      id: 'test-full',
      command: 'pnpm',
      args: ['run', 'test:full'],
    },
  ],
};

type TimingCommand = {
  id: string;
  command: string;
  args: string[];
};

type TimingResult = {
  id: string;
  command: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  startedAt: string;
  finishedAt: string;
};

type TimingReport = {
  generatedAt: string;
  profile: string;
  outputPath: string;
  results: TimingResult[];
};

/**
 * Run all configured commands and write the timing baseline to disk.
 */
async function main(): Promise<void> {
  const profile = readTimingProfile();
  const outputPath = process.env.CBW_TEST_TIMING_OUTPUT ?? getProfileOutputPath(profile);
  const commands = readConfiguredCommands(profile);
  const results: TimingResult[] = [];

  for (const command of commands) {
    results.push(await runTimedCommand(command));
  }

  const report: TimingReport = {
    generatedAt: new Date().toISOString(),
    profile,
    outputPath,
    results,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const failed = results.filter((result) => result.exitCode !== 0);
  if (failed.length > 0) {
    process.exitCode = failed[0].exitCode ?? 1;
  }
}

/**
 * Parse optional command configuration from the environment.
 *
 * CBW_TEST_TIMING_COMMANDS is JSON with objects shaped like:
 * [{"id":"fast","command":"pnpm","args":["run","test:fast"]}]
 */
function readConfiguredCommands(profile: string): TimingCommand[] {
  const raw = process.env.CBW_TEST_TIMING_COMMANDS;
  if (!raw) return PROFILE_COMMANDS[profile] ?? DEFAULT_COMMANDS;

  const parsed = JSON.parse(raw) as TimingCommand[];
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('CBW_TEST_TIMING_COMMANDS must be a non-empty JSON array');
  }

  for (const command of parsed) {
    if (!command.id || !command.command || !Array.isArray(command.args)) {
      throw new Error('Each timing command needs id, command, and args fields');
    }
  }
  return parsed;
}

/**
 * Read the built-in timing profile requested by the caller.
 */
function readTimingProfile(): string {
  const profile = process.env.CBW_TEST_TIMING_PROFILE?.trim() || DEFAULT_PROFILE;
  if (profile !== DEFAULT_PROFILE && !PROFILE_COMMANDS[profile]) {
    throw new Error(`CBW_TEST_TIMING_PROFILE must be one of: ${Object.keys(PROFILE_COMMANDS).join(', ')}`);
  }
  return profile;
}

/**
 * Build the default report path for one profile.
 *
 * Profile runs write to test-results/test-performance/<profile>.json.
 */
function getProfileOutputPath(profile: string): string {
  return path.join(PROFILE_OUTPUT_DIR, `${profile === DEFAULT_PROFILE ? 'latest' : profile}.json`);
}

/**
 * Execute one command, stream its output, and record duration and exit status.
 */
function runTimedCommand(command: TimingCommand): Promise<TimingResult> {
  const startedAt = new Date();
  const startedNs = process.hrtime.bigint();
  const commandText = [command.command, ...command.args].join(' ');

  console.log(`[timing] start ${command.id}: ${commandText}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });

    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      const finishedAt = new Date();
      const durationMs = Number((process.hrtime.bigint() - startedNs) / 1_000_000n);
      console.log(`[timing] finish ${command.id}: exit=${exitCode ?? 'signal'} durationMs=${durationMs}`);
      resolve({
        id: command.id,
        command: commandText,
        durationMs,
        exitCode,
        signal,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
      });
    });
  });
}

await main();
