/**
 * PURPOSE: Own oz flow workflow stage naming, ordering, and status taxonomy.
 */

export const STAGE_LABELS: Record<string, string> = {
  planning: '规划提案',
  acceptance: '验收计划',
  execution: '执行',
  verification: '审核',
  ready_for_acceptance: '待验收',
  review_1: '初审',
  repair_1: '初修',
  review_2: '再审',
  repair_2: '再修',
  review_3: '三审',
  repair_3: '三修',
  qa: 'QA 验收',
  archive: '归档',
};

export const LEGACY_STAGE_ORDER: Record<string, number> = {
  planning: -20,
  verification: Number.MAX_SAFE_INTEGER - 4,
  ready_for_acceptance: Number.MAX_SAFE_INTEGER - 3,
};

/**
 * Map runner stage status words to UI stage status words.
 */
export function mapStageStatus(status: unknown): 'completed' | 'active' | 'blocked' | 'pending' {
  const normalized = String(status || '').toLowerCase();
  if (['completed', 'done', 'success', 'succeeded', 'archived'].includes(normalized)) {
    return 'completed';
  }
  if (['running', 'active', 'in_progress'].includes(normalized)) {
    return 'active';
  }
  if (['failed', 'error', 'aborted', 'blocked'].includes(normalized)) {
    return 'blocked';
  }
  return 'pending';
}

/**
 * Infer a default runner role for a stage when oz flow only reports stage state.
 */
export function inferRole(stage: unknown): string {
  const normalized = String(stage || '').trim();
  if (normalized.startsWith('review')) {
    return 'reviewer';
  }
  if (normalized === 'archive') {
    return 'archiver';
  }
  if (normalized === 'acceptance' || normalized === 'qa') {
    return normalized;
  }
  return 'executor';
}

/**
 * Parse both historical repair_N keys and the current oz flow fix_N keys.
 */
export function parseFixStage(stage: unknown): number | null {
  const match = String(stage || '').trim().match(/^(?:repair|fix)_(\d+)$/);
  if (!match) {
    return null;
  }
  const iteration = Number(match[1]);
  return Number.isInteger(iteration) && iteration > 0 ? iteration : null;
}

/**
 * Build a human-facing stage label.
 */
export function stageLabel(stage: unknown): string {
  const normalized = String(stage || '').trim();
  const reviewMatch = normalized.match(/^review_(\d+)$/);
  if (reviewMatch) {
    return Number(reviewMatch[1]) === 1 ? '初审' : `${Number(reviewMatch[1])}审`;
  }
  const qaMatchIter = normalized.match(/^qa_(\d+)$/);
  if (qaMatchIter) {
    return Number(qaMatchIter[1]) === 1 ? 'QA 验收' : `QA${Number(qaMatchIter[1])} 验收`;
  }
  const fixIteration = parseFixStage(normalized);
  if (fixIteration) {
    return fixIteration === 1 ? '初修' : `${fixIteration}修`;
  }
  return STAGE_LABELS[normalized] || normalized;
}

/**
 * Convert oz flow internal stage keys into the exact user-visible checklist text.
 */
export function stageDisplayText(stage: unknown): string {
  const normalized = String(stage || '').trim();
  if (normalized === 'execution') {
    return 'start';
  }
  if (normalized === 'acceptance' || normalized === 'qa') {
    return normalized;
  }
  if (normalized === 'review_1') {
    return 'review';
  }
  if (normalized === 'archive') {
    return 'archive';
  }
  if (/^qa_\d+$/.test(normalized)) {
    return 'qa';
  }
  const fixIteration = parseFixStage(normalized);
  if (fixIteration) {
    return `${fixIteration} fix`;
  }
  const reviewMatch = normalized.match(/^review_(\d+)$/);
  if (reviewMatch) {
    return `${Number(reviewMatch[1]) - 1} fix review`;
  }
  return normalized;
}
