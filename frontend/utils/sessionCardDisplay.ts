/**
 * PURPOSE: Provide shared display helpers for compact manual session cards.
 */

/**
 * Read the visible session number from the same stable index used by `/cN` URLs.
 */
export function getSessionRouteNumber(session: { routeIndex?: number | null; id?: string | number }): string | null {
  /**
   * PURPOSE: Prefer backend-provided routeIndex and fall back to cN ids so cards
   * show the same number users see in project session URLs.
   */
  const routeIndex = Number(session.routeIndex);
  if (Number.isInteger(routeIndex) && routeIndex > 0) {
    return String(routeIndex);
  }

  const idMatch = String(session.id || '').match(/^c(\d+)$/);
  return idMatch ? idMatch[1] : null;
}
