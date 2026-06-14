/**
 * PURPOSE: Own oz flow runner path and artifact discovery read-model rules.
 */
import path from 'node:path';
import { Dirent, promises as fs } from 'node:fs';

type FixedArtifactPattern = {
  regex: RegExp;
  stage: (round?: number) => string;
  type: string;
};

const FIXED_ARTIFACT_PATTERNS: FixedArtifactPattern[] = [
  { regex: /^review-(\d+)\.(?:json|md|markdown)$/i, stage: (n) => `review_${n}`, type: 'review-result' },
  { regex: /^qa-(\d+)\.json$/i, stage: (n) => `qa_${n}`, type: 'qa-result' },
  { regex: /^fix-(\d+)\.(?:json|md|markdown)$/i, stage: (n) => `fix_${n}`, type: 'fix-result' },
  { regex: /^repair-(\d+)\.(?:json|md|markdown)$/i, stage: (n) => `repair_${n}`, type: 'repair-result' },
  { regex: /^fix-(\d+)-summary\.(?:json|md|markdown)$/i, stage: (n) => `fix_${n}`, type: 'repair-summary' },
  { regex: /^repair-(\d+)-summary\.(?:json|md|markdown)$/i, stage: (n) => `repair_${n}`, type: 'repair-summary' },
  { regex: /^delivery-summary\.(?:json|md|markdown)$/i, stage: () => 'archive', type: 'delivery-summary' },
];

/**
 * Return a snake_case runner field value.
 */
function pick(object: Record<string, unknown> | null | undefined, snakeKey: string): unknown {
  return object?.[snakeKey];
}

/**
 * Convert arbitrary runner paths to project-relative slash paths.
 */
function normalizeRelativePath(projectPath: string, value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  const normalized = raw.replace(/\\/g, '/');
  if (!path.isAbsolute(raw)) {
    return normalized;
  }
  return path.relative(projectPath, raw).replace(/\\/g, '/');
}

/**
 * Decide whether a runner path is a log, artifact, or internal path.
 */
function classifyPath(key: unknown, value: unknown): Record<string, any> {
  const normalizedKey = String(key || '');
  const normalizedValue = String(value || '');
  const basename = path.posix.basename(normalizedValue.replace(/\\/g, '/'));
  if (!normalizedValue || normalizedKey === 'state' || normalizedKey === 'state_json' || /\.lock$/i.test(basename)) {
    return { kind: 'hidden' };
  }
  if (/_log$/i.test(normalizedKey) || /Log$/.test(normalizedKey)) {
    return { kind: 'log', type: 'log', label: normalizedKey.replace(/_/g, ' ') };
  }
  if (/^review_\d+$/.test(normalizedKey)) {
    return { kind: 'artifact', type: 'review-result', stage: normalizedKey, label: `Review result ${normalizedKey.split('_')[1]}` };
  }
  if (/^repair_\d+_summary$/.test(normalizedKey)) {
    const stage = normalizedKey.replace('_summary', '');
    return { kind: 'artifact', type: 'repair-summary', stage, label: `Repair summary ${stage.split('_')[1]}` };
  }
  if (normalizedKey === 'delivery_summary') {
    return { kind: 'artifact', type: 'delivery-summary', stage: 'archive', label: path.posix.basename(normalizedValue) || 'delivery-summary.md' };
  }
  if (normalizedKey === 'acceptance_summary') {
    return { kind: 'artifact', type: 'acceptance-summary', stage: 'acceptance', label: path.posix.basename(normalizedValue) || 'acceptance-summary.md' };
  }
  if (/^qa_\d+$/.test(normalizedKey)) {
    return { kind: 'artifact', type: 'qa-result', stage: normalizedKey, label: path.posix.basename(normalizedValue) || `${normalizedKey}.json` };
  }
  if (/^qa(?:_result|_report)?$/.test(normalizedKey)) {
    return { kind: 'artifact', type: normalizedKey.replace(/_/g, '-'), stage: 'qa', label: path.posix.basename(normalizedValue) || `${normalizedKey.replace(/_/g, '-')}.md` };
  }
  if (normalizedKey === 'summary') {
    return { kind: 'artifact', type: 'summary', stage: 'execution', label: path.posix.basename(normalizedValue) || 'SUMMARY.md' };
  }
  if (normalizedKey === 'workflow_output') {
    return { kind: 'artifact', type: 'directory', semanticType: 'workflow-output', stage: 'execution', label: 'workflow-output' };
  }
  return {
    kind: 'artifact',
    type: 'artifact',
    label: normalizedKey.replace(/_/g, ' ') || basename,
    warning: `Unknown runner path key: ${normalizedKey || basename || '<empty>'}`,
  };
}

/**
 * Return whether a project-relative path currently exists.
 */
async function pathExists(projectPath: string, relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(projectPath, relativePath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the oz change document directory for a given change name.
 */
async function resolveOzChangeDocDir(projectPath: string, changeName: string): Promise<{ dirName: string; fullPath: string } | null> {
  if (!projectPath || !changeName) {
    return null;
  }

  const activeDir = path.join(projectPath, 'docs', 'changes', changeName);
  try {
    await fs.access(activeDir);
    return { dirName: changeName, fullPath: activeDir };
  } catch {
    // not active; try archive
  }

  const archiveRoot = path.join(projectPath, 'docs', 'changes', 'archive');
  const candidates: Array<{ dirName: string; fullPath: string; mtime: number }> = [];
  try {
    const entries = await fs.readdir(archiveRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (entry.name === changeName || entry.name.endsWith(`-${changeName}`)) {
        const fullPath = path.join(archiveRoot, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          candidates.push({ dirName: entry.name, fullPath, mtime: stat.mtimeMs });
        } catch {
          // skip unreadable candidates
        }
      }
    }
  } catch {
    // archive directory is optional
  }

  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return { dirName: candidates[0].dirName, fullPath: candidates[0].fullPath };
}

/**
 * Scan a run directory for fixed artifact files such as review-N.json, fix-N.md, and repair-N.json.
 */
export async function scanRunDirFixedArtifacts(
  runDir: string,
  runId: string,
  warnings: string[],
): Promise<Array<Record<string, unknown>>> {
  const artifacts: Array<Record<string, unknown>> = [];
  let entries: Dirent<string>[] = [];
  try {
    entries = await fs.readdir(runDir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      warnings.push(`Cannot read run directory for fixed artifacts: ${(error as Error).message}`);
    }
    return artifacts;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const name = entry.name;
    for (const pattern of FIXED_ARTIFACT_PATTERNS) {
      const match = name.match(pattern.regex);
      if (match) {
        const round = Number(match[1]) || undefined;
        const stage = pattern.stage(round);
        const absolutePath = path.join(runDir, name);
        artifacts.push({
          id: `fixed:${runId}:${name}`,
          label: name,
          type: pattern.type,
          semanticType: pattern.type,
          stage,
          relativePath: absolutePath,
          path: absolutePath,
          exists: true,
          round,
          source: 'run-dir-scan',
        });
        break;
      }
    }
  }

  return artifacts;
}

/**
 * Build path-based artifact read models from oz flow state paths.
 */
export async function buildPathReadModel(
  projectPath: string,
  state: Record<string, unknown>,
  warnings: string[],
): Promise<{ artifacts: unknown[]; logsByKey: Map<string, string> }> {
  const artifacts: unknown[] = [];
  const logsByKey = new Map<string, string>();
  const paths = pick(state, 'paths') || {};
  for (const [key, value] of Object.entries(paths && typeof paths === 'object' ? paths : {})) {
    const relativePath = normalizeRelativePath(projectPath, value);
    const classification = classifyPath(key, relativePath);
    if (classification.kind === 'hidden') {
      continue;
    }
    const exists = await pathExists(projectPath, relativePath);
    if (!exists) {
      warnings.push(`Referenced path does not exist: ${relativePath}`);
    }
    if (classification.kind === 'log') {
      logsByKey.set(key, relativePath);
      continue;
    }
    if (classification.warning) {
      warnings.push(classification.warning);
    }
    artifacts.push({
      id: `${key}:${relativePath}`,
      label: classification.label,
      type: classification.type,
      semanticType: classification.semanticType,
      stage: classification.stage,
      relativePath,
      path: relativePath,
      exists,
    });
  }
  return { artifacts, logsByKey };
}

/**
 * Collect planning test artifact entries from the change document directory.
 */
export async function collectPlanningTestFileEntries(docDir: string): Promise<unknown[]> {
  const testsDir = path.join(docDir, 'tests');
  const entries: Array<{ name: string; isDirectory: boolean; exists: boolean }> = [];

  async function walk(currentDir: string, relativePrefix = 'tests'): Promise<void> {
    const children = await fs.readdir(currentDir, { withFileTypes: true });
    for (const child of children) {
      const childRelativePath = path.posix.join(relativePrefix, child.name);
      const childFullPath = path.join(currentDir, child.name);
      if (child.isDirectory()) {
        await walk(childFullPath, childRelativePath);
        continue;
      }
      if (child.isFile()) {
        entries.push({ name: childRelativePath, isDirectory: false, exists: true });
      }
    }
  }

  try {
    await walk(testsDir);
  } catch {
    return [];
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build planning artifact read models from oz change documents.
 */
export async function buildPlanningArtifacts(projectPath: string, changeName: string): Promise<unknown[]> {
  if (!projectPath || !changeName) {
    return [];
  }

  const docDir = await resolveOzChangeDocDir(projectPath, changeName);
  const relativeDir = docDir
    ? path.relative(projectPath, docDir.fullPath).replace(/\\/g, '/')
    : path.posix.join('docs', 'changes', changeName);
  const priorityNames = ['brief.md', 'proposal.md', 'design.md', 'spec.md', 'task.md', 'acceptance.json'];
  const priorityIndexByName = new Map(priorityNames.map((name, index) => [name, index]));
  let entries: Array<{ name: string; isDirectory: boolean; exists: boolean }> = priorityNames.map((name) => ({ name, isDirectory: false, exists: false }));

  if (docDir) {
    try {
      const discoveredEntries = await fs.readdir(docDir.fullPath, { withFileTypes: true });
      const topLevelEntries = discoveredEntries
        .filter((entry) => entry.isFile() || entry.isDirectory())
        .filter((entry) => entry.name !== 'tests')
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory(), exists: true }));
      const testEntries = await collectPlanningTestFileEntries(docDir.fullPath) as Array<{ name: string; isDirectory: boolean; exists: boolean }>;
      entries = [...topLevelEntries, ...testEntries].sort((a, b) => {
        const leftPriority = priorityIndexByName.has(a.name) ? priorityIndexByName.get(a.name) : Number.MAX_SAFE_INTEGER;
        const rightPriority = priorityIndexByName.has(b.name) ? priorityIndexByName.get(b.name) : Number.MAX_SAFE_INTEGER;
        if (leftPriority !== rightPriority) {
          return Number(leftPriority) - Number(rightPriority);
        }
        const leftIsTest = a.name.startsWith('tests/');
        const rightIsTest = b.name.startsWith('tests/');
        if (leftIsTest !== rightIsTest) {
          return leftIsTest ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    } catch {
      entries = priorityNames.map((name) => ({ name, isDirectory: false, exists: false }));
    }
  }

  const artifacts: unknown[] = [];
  for (const entry of entries) {
    const artifactName = entry.name;
    const relativePath = path.posix.join(relativeDir, artifactName);
    const artifactType = entry.isDirectory ? 'directory' : 'file';
    artifacts.push({
      id: `oz-planning:${changeName}:${artifactName}`,
      label: artifactType === 'directory' ? `${artifactName}/` : artifactName,
      type: artifactType === 'directory' ? 'directory' : 'oz-change-doc',
      semanticType: 'oz-change-doc',
      stage: 'planning',
      substageKey: 'planning',
      relativePath,
      path: relativePath,
      exists: entry.exists,
    });
  }

  return artifacts;
}
