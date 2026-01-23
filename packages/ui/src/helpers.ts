import { formatDistanceToNow } from 'date-fns';

/**
 * Gets today's date as a string in "YYYY-MM-DD" format.
 */
export const getTodayDateString = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Formats a timestamp into a human-readable "time ago" string (e.g., "2 hours ago").
 */
export const formatTimeAgo = (date?: number | string | Date): string => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return formatDistanceToNow(d, { addSuffix: true });
};

/**
 * Formats a Unix timestamp (milliseconds) into a locale-aware date and time string.
 */
export const formatTimestamp = (timestamp?: number): string => {
  if (timestamp === null || timestamp === undefined || isNaN(timestamp)) {
    return '';
  }
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return 'Invalid Date';
    }
    // Using standard Intl formatting for locale-awareness
    return date.toLocaleString(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch (e) {
    console.error('Error formatting timestamp:', timestamp, e);
    return 'Invalid Date';
  }
};

/**
 * Formats an ISO 8601 date string into "YYYY-MM-DD" format.
 * Returns empty string for invalid input.
 */
export const formatIsoDateToYMD = (isoString?: string | null): string => {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return ''; // Invalid date parsed

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (e) {
    console.error('Error formatting ISO date:', isoString, e);
    return '';
  }
};

/**
 * Creates a debounced version of a function that delays invoking func
 * until after wait milliseconds have elapsed since the last time the
 * debounced function was invoked.
 */
export const debounce = <F extends (...args: any[]) => any>(
  func: F,
  waitFor: number
) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<F>): void => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), waitFor);
  };
};
