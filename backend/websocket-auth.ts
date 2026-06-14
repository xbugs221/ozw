/**
 * PURPOSE: Resolve WebSocket authentication material from upgrade headers
 * without accepting token or API key values from URL query strings.
 */

/**
 * Resolve bearer token from HTTP Upgrade headers for WebSocket auth.
 */
export function getWebSocketAuthToken(req: { headers?: Record<string, unknown> } | null | undefined): string | null {
  const authHeader = req?.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) {
      return token;
    }
  }

  const secWebSocketProtocol = req?.headers?.['sec-websocket-protocol'];
  if (!secWebSocketProtocol) {
    return null;
  }

  const protocolHeader = Array.isArray(secWebSocketProtocol)
    ? secWebSocketProtocol.join(',')
    : String(secWebSocketProtocol);
  const token = protocolHeader
    .split(',')
    .map((entry) => String(entry || '').trim())
    .find((entry) => entry.length > 0);

  return token || null;
}
