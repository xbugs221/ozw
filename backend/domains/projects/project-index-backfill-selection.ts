/**
 * PURPOSE: Select startup provider transcript files fairly so Codex and Pi can
 * both repair their SQLite read-model rows under one global processing limit.
 */

export type ProviderBackfillFile = {
  provider: 'codex' | 'pi';
  filePath: string;
};

/**
 * Interleave newest Codex and Pi files, then let either side consume unused capacity.
 */
export function selectProviderBackfillFiles(
  codexFiles: string[],
  piFiles: string[],
  limit: number,
): ProviderBackfillFile[] {
  /**
   * PURPOSE: A provider with more files than the cap must not starve the other
   * provider, while the total startup work remains bounded by the same limit.
   */
  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const queues: ProviderBackfillFile[][] = [
    [...codexFiles].reverse().map((filePath) => ({ provider: 'codex', filePath })),
    [...piFiles].reverse().map((filePath) => ({ provider: 'pi', filePath })),
  ];
  const selected: ProviderBackfillFile[] = [];

  while (selected.length < boundedLimit && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const nextFile = queue.shift();
      if (nextFile) {
        selected.push(nextFile);
      }
      if (selected.length >= boundedLimit) {
        break;
      }
    }
  }

  return selected;
}
