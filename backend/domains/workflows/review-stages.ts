/**
 * PURPOSE: Keep workflow review state transitions separate from the
 * persistence-heavy workflow store.
 */

/**
 * Build the substage key used for one numbered workflow review pass.
 *
 * @param {number} passIndex - One-based review pass number.
 * @returns {string} Stable review substage key.
 */
export function buildReviewPassSubstageKey(passIndex: number): string {
  return `review_${passIndex}`;
}

/**
 * Build the workflow stage key used for one numbered review pass.
 *
 * @param {number} passIndex - One-based review pass number.
 * @returns {string} Stable review stage key.
 */
export function buildReviewPassStageKey(passIndex: number): string {
  return buildReviewPassSubstageKey(passIndex);
}

/**
 * Parse a review substage key into its one-based pass number.
 *
 * @param {string} substageKey - Candidate review substage key.
 * @returns {number | null} Parsed pass number, or null for non-review keys.
 */
export function getReviewPassIndexForSubstage(substageKey = ''): number | null {
  const matched = String(substageKey || '').match(/^review(?:_pass)?_(\d+)$/);
  if (!matched) {
    return null;
  }
  return Number.parseInt(matched[1], 10);
}

/**
 * Select child sessions that belong to one workflow review pass.
 *
 * @param {Array<{ stageKey?: string }>} childSessions
 * @param {string} substageKey - Review-pass substage key.
 * @returns {Array<object>} Matching child sessions for the pass.
 */
export function getReviewPassSessions(childSessions: Array<{ stageKey?: string }> = [], substageKey = ''): Array<{ stageKey?: string }> {
  const passIndex = getReviewPassIndexForSubstage(substageKey);
  if (!Number.isInteger(passIndex)) {
    return [];
  }
  const stageKey = buildReviewPassStageKey(passIndex as number);
  return childSessions.filter((session) => session.stageKey === stageKey);
}
