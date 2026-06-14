// PURPOSE: Normalize and format business timestamps for provider sessions and project cards.
import { TFunction } from 'i18next';

/**
 * Normalize timestamps from provider read models into a Date object.
 */
export const normalizeBusinessTimestamp = (dateInput: string | number | Date | null | undefined): Date | null => {
  if (dateInput instanceof Date) {
    return Number.isNaN(dateInput.getTime()) ? null : dateInput;
  }

  if (typeof dateInput === 'number') {
    const timestamp = dateInput < 1_000_000_000_000 ? dateInput * 1000 : dateInput;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const value = String(dateInput ?? '').trim();
  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value)) {
    const timestamp = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(timestamp)) {
      return null;
    }
    const normalizedTimestamp = value.length <= 10 ? timestamp * 1000 : timestamp;
    const date = new Date(normalizedTimestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Format a timestamp using the host timezone reported by the backend.
 */
export const formatTimestamp = (
  dateInput: string | number | Date,
  options: { timeZone?: string | null; includeTime?: boolean } = {},
) => {
  const date = normalizeBusinessTimestamp(dateInput);
  if (!date) {
    return '';
  }

  const formatter = new Intl.DateTimeFormat('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(options.includeTime ? {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    } : {}),
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  });

  return formatter.format(date).replace(',', '');
};

export const formatTimeAgo = (
  dateString: string,
  currentTime: Date,
  t: TFunction,
  hostTimeZone?: string | null,
) => {
  const date = normalizeBusinessTimestamp(dateString);
  const now = currentTime;

  // Check if date is valid
  if (!date) {
    return t ? t('status.unknown') : 'Unknown';
  }

  const diffInMs = now.getTime() - date.getTime();
  if (diffInMs < 0) {
    return formatTimestamp(date, { timeZone: hostTimeZone, includeTime: false });
  }

  const diffInSeconds = Math.floor(diffInMs / 1000);
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInSeconds < 60) return t ? t('time.justNow') : 'Just now';
  if (diffInMinutes === 1) return t ? t('time.oneMinuteAgo') : '1 min ago';
  if (diffInMinutes < 60) return t ? t('time.minutesAgo', { count: diffInMinutes }) : `${diffInMinutes} mins ago`;
  if (diffInHours === 1) return t ? t('time.oneHourAgo') : '1 hour ago';
  if (diffInHours < 24) return t ? t('time.hoursAgo', { count: diffInHours }) : `${diffInHours} hours ago`;
  if (diffInDays === 1) return t ? t('time.oneDayAgo') : '1 day ago';
  if (diffInDays < 7) return t ? t('time.daysAgo', { count: diffInDays }) : `${diffInDays} days ago`;
  return formatTimestamp(date, { timeZone: hostTimeZone, includeTime: false });
};
