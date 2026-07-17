/**
 * PURPOSE: Format project labels for the responsive sidebar without changing
 * the full desktop project name.
 */

export const MOBILE_PROJECT_LABEL_MAX_CHARACTERS = 15;

/**
 * Return the mobile project label capped by visible Unicode characters.
 */
export function getMobileProjectLabel(projectLabel: string): string {
  return Array.from(projectLabel).slice(0, MOBILE_PROJECT_LABEL_MAX_CHARACTERS).join('');
}
