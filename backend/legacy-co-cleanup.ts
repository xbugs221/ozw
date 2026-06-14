/**
 * PURPOSE: Idempotently remove legacy ozw-owned co protocol state.
 * Does not touch provider-native directories like ~/.codex or ~/.pi.
 */

import { rm, stat } from 'node:fs/promises';
import path from 'node:path';

export async function removeLegacyCoState(options: { stateHome: string }): Promise<{ removed: boolean; path: string }> {
  const coRoot = path.join(options.stateHome, 'ozw', 'co');
  try {
    await stat(coRoot);
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return { removed: false, path: coRoot };
    }
    throw error;
  }
  await rm(coRoot, { recursive: true, force: true });
  return { removed: true, path: coRoot };
}
