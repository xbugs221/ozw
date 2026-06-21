// PURPOSE: Normalize provider session activity timestamp field selection for project cards.

type SessionActivitySource = {
  lastActivity?: unknown;
  last_activity?: unknown;
  activityAt?: unknown;
  activity_at?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
  time_updated?: unknown;
  timeUpdated?: unknown;
  modified_at?: unknown;
  modifiedAt?: unknown;
  timestamp?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  time_created?: unknown;
  timeCreated?: unknown;
};

/**
 * Convert a provider timestamp value into the string shape expected by card formatters.
 */
function timestampValueToString(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  return '';
}

/**
 * Read the timestamp that represents visible session activity.
 */
export function getSessionActivityTime(session: SessionActivitySource): string {
  for (const value of [
    session.lastActivity,
    session.last_activity,
    session.activityAt,
    session.activity_at,
    session.updated_at,
    session.updatedAt,
    session.time_updated,
    session.timeUpdated,
    session.modified_at,
    session.modifiedAt,
    session.timestamp,
    session.createdAt,
    session.created_at,
    session.time_created,
    session.timeCreated,
  ]) {
    const timestamp = timestampValueToString(value);
    if (timestamp) {
      return timestamp;
    }
  }
  return '';
}
