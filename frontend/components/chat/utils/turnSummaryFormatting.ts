/**
 * PURPOSE: Format manual-session turn summary values without coupling tests to
 * browser-only chat component dependencies.
 */

/**
 * Render only meaningful Chinese time units while keeping lower units padded.
 */
export function formatProcessedDuration(durationMs: number): string {
  const elapsedSeconds = Math.max(0, Math.floor(durationMs / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}秒`;
  }
  const elapsedHours = Math.floor(elapsedSeconds / 3600);
  const elapsedMinutes = Math.floor((elapsedSeconds % 3600) / 60);
  const remainingSeconds = elapsedSeconds % 60;
  if (elapsedHours === 0) {
    return `${String(elapsedMinutes).padStart(2, '0')}分钟${String(remainingSeconds).padStart(2, '0')}秒`;
  }
  return `${String(elapsedHours).padStart(2, '0')}时${String(elapsedMinutes).padStart(2, '0')}分${String(remainingSeconds).padStart(2, '0')}秒`;
}
