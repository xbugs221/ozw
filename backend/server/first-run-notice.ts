/**
 * PURPOSE: Format the one-time browser credential notice only after the HTTP
 * service is reachable, so failed binds never leak or consume its display.
 */

export type FirstRunNoticeState = {
  accessTokenGenerated: boolean;
  accessToken: string;
  envPath: string;
};

export type FirstRunNoticeOptions = {
  displayHost: string;
  port: number;
  isTTY?: boolean;
};

/**
 * Return user-facing first-run lines without emitting a token in non-TTY logs.
 */
export function formatFirstRunNotice(
  state: FirstRunNoticeState,
  { displayHost, port, isTTY = Boolean(process.stdout.isTTY) }: FirstRunNoticeOptions,
): string[] {
  /** Only a newly published token earns this one-time startup notice. */
  if (!state.accessTokenGenerated) return [];

  const lines = [
    '',
    '[OK] First-run setup completed.',
    `[INFO] Login URL: http://${displayHost}:${port}`,
    `[INFO] Configuration: ${state.envPath}`,
  ];
  if (isTTY) {
    lines.push(
      `[INFO] Access token: ${state.accessToken}`,
      '[WARN] The access token is shown only when newly generated.',
      '',
    );
  } else {
    lines.push(
      '[INFO] Access token written to the private configuration file; not printed in non-interactive logs.',
      '',
    );
  }
  return lines;
}

/**
 * Print the first-run credential notice after the HTTP listener reports ready.
 */
export function printFirstRunNotice(
  state: FirstRunNoticeState,
  options: FirstRunNoticeOptions,
  write: (line: string) => void = console.log,
): void {
  /** Preserve console formatting while keeping output easy to unit-test. */
  for (const line of formatFirstRunNotice(state, options)) {
    write(line);
  }
}

/**
 * Return a safe recovery hint when startup fails after creating the token file.
 */
export function formatFirstRunFailureHint(state: FirstRunNoticeState): string | null {
  /** The stored private file is the recovery path; never repeat its token in an error. */
  if (!state.accessTokenGenerated) return null;
  return `[INFO] First-run access token remains in ${state.envPath}; fix the startup error and run ozw again.`;
}
