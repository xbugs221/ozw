/**
 * PURPOSE: Keep all oz CLI access behind one JSON contract adapter.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Execute oz with JSON output and parse the response payload.
 */
async function runOzJson(args: string[], projectPath: string): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync('oz', args, {
    cwd: projectPath,
    timeout: 10000,
    maxBuffer: 1024 * 1024 * 4,
  });
  return JSON.parse(stdout || '{}');
}

/**
 * List active oz changes through the CLI source of truth.
 */
export async function listOpenSpecChanges(projectPath: string): Promise<string[]> {
  const payload = await runOzJson(['list', '--json'], projectPath);
  return Array.isArray(payload?.changes)
    ? payload.changes.map((change) => String(change?.name || change?.id || change || '').trim()).filter(Boolean)
    : [];
}

/**
 * Read one change status through oz.
 */
export async function getOpenSpecStatus(projectPath: string, changeName: string): Promise<Record<string, unknown>> {
  return runOzJson(['status', changeName, '--json'], projectPath);
}

/**
 * Validate oz artifacts through oz.
 */
export async function validateOpenSpec(projectPath: string, itemName = ''): Promise<Record<string, unknown>> {
  const args = itemName ? ['validate', itemName, '--json'] : ['validate', '--json'];
  return runOzJson(args, projectPath);
}

/**
 * Archive one completed oz change through oz.
 */
export async function archiveOpenSpecChange(projectPath: string, changeName: string): Promise<Record<string, unknown>> {
  return runOzJson(['archive', changeName, '--yes', '--json'], projectPath);
}
