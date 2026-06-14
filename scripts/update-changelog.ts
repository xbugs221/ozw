/**
 * PURPOSE: Build release context from Git and ask an agent to write a structured
 * CHANGELOG entry before a tag is created.
 *
 * Business logic: release notes should describe meaningful product and
 * engineering changes between tags instead of mechanically merging commit
 * messages. The script prepares bounded evidence and delegates the summary to a
 * configurable local agent command.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const CHANGELOG_PATH = 'CHANGELOG.md';
const DEFAULT_AGENT_COMMAND =
  'codex -a never exec --ephemeral --sandbox read-only -';
const CHANGELOG_HEADER = '# Changelog\n\n';
const MAX_SECTION_LENGTH = 12000;

type ReleaseArgs = {
  version: string;
  dryRun: boolean;
};

type ReleaseContext = {
  version: string;
  previousTag: string | null;
  rangeLabel: string;
  commitSummary: string;
  fileSummary: string;
  diffStat: string;
  specSummary: string;
  packageSummary: string;
};

/**
 * Parse CLI flags accepted by this script.
 */
function parseArgs(argv: string[]): ReleaseArgs {
  let version = '';
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--version' || arg === '-v') {
      version = argv[index + 1] ?? '';
      index += 1;
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  if (!version) {
    throw new Error('Usage: pnpm run changelog:update -- --version v1.0');
  }

  return {
    version: version.startsWith('v') ? version : `v${version}`,
    dryRun,
  };
}

/**
 * Run a Git command and return trimmed stdout.
 */
async function git(args: string[]): Promise<string> {
  return run('git', args);
}

/**
 * Run one command without a shell and return trimmed stdout.
 */
function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed: ${stderr.trim()}`));
      }
    });
  });
}

/**
 * Collect bounded release evidence from Git and repo metadata.
 */
async function buildReleaseContext(version: string): Promise<ReleaseContext> {
  const headExists = await hasHead();
  if (!headExists) {
    return {
      version,
      previousTag: null,
      rangeLabel: 'initial release',
      commitSummary: '(initial commit pending)',
      fileSummary: await limitedGit(['diff', '--cached', '--name-status']),
      diffStat: await limitedGit(['diff', '--cached', '--stat']),
      specSummary: await summarizeTrackedSpecs(),
      packageSummary: await readPackageSummary(),
    };
  }

  const previousTag = await getPreviousTag();
  const rangeArgs = previousTag ? [`${previousTag}..HEAD`] : ['HEAD'];
  const rangeLabel = previousTag ? `${previousTag}..HEAD` : 'initial release';

  return {
    version,
    previousTag,
    rangeLabel,
    commitSummary: await limitedGit(['log', '--oneline', '--decorate=short', ...rangeArgs]),
    fileSummary: await limitedGit(['diff', '--name-status', ...rangeArgs]),
    diffStat: await limitedGit(['diff', '--stat', ...rangeArgs]),
    specSummary: await summarizeTrackedSpecs(),
    packageSummary: await readPackageSummary(),
  };
}

/**
 * Return whether the repository already has a commit.
 */
async function hasHead(): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return the newest existing tag, or null for the first release.
 */
async function getPreviousTag(): Promise<string | null> {
  const tags = await git(['tag', '--list', '--sort=-creatordate']);
  const [latest] = tags.split('\n').filter(Boolean);
  return latest ?? null;
}

/**
 * Run a Git command and truncate very large sections for agent input.
 */
async function limitedGit(args: string[]): Promise<string> {
  const output = await git(args);
  return limitSection(output || '(none)');
}

/**
 * Read package metadata relevant to release-note wording.
 */
async function readPackageSummary(): Promise<string> {
  const raw = await readFile('package.json', 'utf8');
  const pkg = JSON.parse(raw) as {
    name?: string;
    version?: string;
    description?: string;
    bin?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  return JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      bin: pkg.bin,
      importantScripts: pickScripts(pkg.scripts ?? {}),
    },
    null,
    2,
  );
}

/**
 * Keep only scripts that explain build, test, and release surfaces.
 */
function pickScripts(scripts: Record<string, string>): Record<string, string> {
  const prefixes = ['build', 'test', 'typecheck', 'release', 'changelog'];
  return Object.fromEntries(
    Object.entries(scripts).filter(([name]) =>
      prefixes.some((prefix) => name === prefix || name.startsWith(`${prefix}:`)),
    ),
  );
}

/**
 * Summarize durable specs and spec tests that replaced archived proposals.
 */
async function summarizeTrackedSpecs(): Promise<string> {
  const specs = await git(['ls-files', 'docs/specs', 'tests/specs']);
  return specs || '(none)';
}

/**
 * Build the prompt sent to the release-note agent.
 */
function buildPrompt(context: ReleaseContext): string {
  return `
You are writing release notes for a formal project release.

Return only markdown for one CHANGELOG entry. Do not wrap it in a code fence.

Required shape:
## ${context.version} - ${new Date().toISOString().slice(0, 10)}

### Highlights
- 2 to 5 bullets describing user-visible or operator-visible outcomes.

### Changes
- Structured bullets grouped by product area when useful.

### Quality
- Mention meaningful specification, test, or release-process coverage.

Rules:
- Summarize the difference between tags from evidence; do not mechanically list commit messages.
- Do not invent external facts.
- Keep it concise and useful for maintainers.
- If this is the first release, describe the current released capability as the baseline.

Release range: ${context.rangeLabel}
Previous tag: ${context.previousTag ?? '(none)'}

Package:
${context.packageSummary}

Commits:
${context.commitSummary}

Changed files:
${context.fileSummary}

Diff stat:
${context.diffStat}

Tracked durable specs and spec tests:
${context.specSummary}
`.trim();
}

/**
 * Ask the configured local agent to write the changelog entry.
 */
function runAgent(prompt: string): Promise<string> {
  const command = process.env.CHANGELOG_AGENT_CMD ?? DEFAULT_AGENT_COMMAND;

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: process.cwd(),
      env: process.env,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`CHANGELOG_AGENT_CMD failed with ${code}: ${stderr.trim()}`));
      }
    });
    child.stdin.end(prompt);
  });
}

/**
 * Add or replace the current version entry in CHANGELOG.md.
 */
async function upsertChangelogEntry(version: string, entry: string): Promise<void> {
  const existing = existsSync(CHANGELOG_PATH)
    ? await readFile(CHANGELOG_PATH, 'utf8')
    : CHANGELOG_HEADER;
  const body = existing.startsWith(CHANGELOG_HEADER)
    ? existing.slice(CHANGELOG_HEADER.length)
    : existing.replace(/^# Changelog\s*/i, '').trimStart();

  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entryPattern = new RegExp(`^## ${escapedVersion} - [\\s\\S]*?(?=^## |$)`, 'm');
  const cleanEntry = `${entry.trim()}\n\n`;
  const nextBody = entryPattern.test(body)
    ? body.replace(entryPattern, cleanEntry.trimEnd())
    : `${cleanEntry}${body.trimStart()}`;

  await writeFile(CHANGELOG_PATH, `${CHANGELOG_HEADER}${nextBody.trimEnd()}\n`, 'utf8');
}

/**
 * Keep agent context bounded.
 */
function limitSection(value: string): string {
  if (value.length <= MAX_SECTION_LENGTH) return value;
  return `${value.slice(0, MAX_SECTION_LENGTH)}\n...(truncated)`;
}

/**
 * Execute the changelog generation workflow.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const context = await buildReleaseContext(args.version);
  const prompt = buildPrompt(context);

  if (args.dryRun) {
    console.log(prompt);
    return;
  }

  const entry = await runAgent(prompt);
  await upsertChangelogEntry(args.version, entry);
  console.log(`Updated ${CHANGELOG_PATH} for ${args.version}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
