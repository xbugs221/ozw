/**
 * PURPOSE: Build Git authentication environment without placing tokens in
 * command-line arguments or clone URLs.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

export type GitCredentialEnvironment = {
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
};

function shellSingleQuote(value: string): string {
  /**
   * PURPOSE: Quote a secret for a POSIX shell script without allowing command
   * substitution or argument injection.
   */
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function createGitCredentialEnvironment(githubToken?: string | null): Promise<GitCredentialEnvironment> {
  /**
   * PURPOSE: Return git spawn env that disables terminal prompts and, when a
   * token exists, supplies credentials through GIT_ASKPASS instead of argv.
   */
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };

  if (!githubToken) {
    return {
      env: baseEnv,
      cleanup: async () => {},
    };
  }

  const askPassDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-git-askpass-'));
  const askPassPath = path.join(askPassDir, 'askpass.sh');
  const quotedToken = shellSingleQuote(githubToken);
  const script = [
    '#!/bin/sh',
    'case "$1" in',
    "  *Username*) printf '%s\\n' 'x-access-token' ;;",
    `  *Password*) printf '%s\\n' ${quotedToken} ;;`,
    `  *) printf '%s\\n' ${quotedToken} ;;`,
    'esac',
    '',
  ].join('\n');

  await fs.writeFile(askPassPath, script, { mode: 0o700 });
  await fs.chmod(askPassPath, 0o700);

  return {
    env: {
      ...baseEnv,
      GIT_ASKPASS: askPassPath,
    },
    cleanup: async () => {
      await fs.rm(askPassDir, { recursive: true, force: true });
    },
  };
}
