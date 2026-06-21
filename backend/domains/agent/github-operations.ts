/**
 * PURPOSE: Keep GitHub clone and credential boundaries separate from the route.
 */

import { spawn } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';
import { createGitCredentialEnvironment } from '../../git-credential-env.js';

export async function createSafeGitHubCredentialEnvironment(githubToken: string | null | undefined) {
  /** Build a GIT_ASKPASS credential environment so tokens stay out of URLs and process args. */
  return createGitCredentialEnvironment(githubToken || null);
}

export function assertGitHubRemoteUrl(githubUrl: string): void {
  /** Validate that a Git remote is a GitHub URL before clone or branch operations. */
  if (!githubUrl || !githubUrl.includes('github.com')) {
    throw new Error('GitHub URL must point to github.com');
  }
}

export async function cloneGitHubRepo(githubUrl: string, githubToken: string | null | undefined, projectPath: string): Promise<string> {
  /** Clone a GitHub repository without putting the token in the URL or process arguments. */
  assertGitHubRemoteUrl(githubUrl);
  const cloneDir = path.resolve(projectPath);

  try {
    await fs.access(cloneDir);
    throw new Error(`Directory ${cloneDir} already exists`);
  } catch (accessError) {
    if ((accessError as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw accessError;
    }
  }

  await fs.mkdir(path.dirname(cloneDir), { recursive: true });
  const gitCredentials = await createSafeGitHubCredentialEnvironment(githubToken);

  return new Promise((resolve, reject) => {
    const gitProcess = spawn('git', ['clone', '--depth', '1', githubUrl, cloneDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: gitCredentials.env,
    });

    let stderr = '';
    gitProcess.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
      console.log('Git stderr:', data.toString());
    });

    gitProcess.on('close', async (code) => {
      await gitCredentials.cleanup();
      if (code === 0) {
        resolve(cloneDir);
        return;
      }
      reject(new Error(`Git clone failed: ${stderr}`));
    });

    gitProcess.on('error', async (error) => {
      await gitCredentials.cleanup();
      reject(new Error(`Failed to execute git: ${error.message}`));
    });
  });
}
