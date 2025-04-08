// src/helpers.ts
import { cn } from './utils';
// Import the mappings and defaults from constants
import { BADGE_COLOR_MAP, defaultSessionClasses, defaultTherapyClasses } from './constants';

// getTodayDateString and formatTimestamp functions remain the same...

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
      return date.toLocaleString(undefined, {
          dateStyle: 'short',
          timeStyle: 'short'
      });
  } catch (e) {
      console.error("Error formatting timestamp:", timestamp, e);
      return 'Invalid Date';
  }
};


/**
 * Generates Tailwind CSS classes for session/therapy type badges
 * using mappings defined in constants.ts.
 * @param type - The session or therapy type string.
 * @param category - Specifies whether the type is 'session' or 'therapy'.
 * @returns A string of Tailwind classes for the badge.
 */
export const getBadgeClasses = (type?: string, category: 'session' | 'therapy' = 'session'): string => {
    // Base classes remain the same
    const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize";

    const typeLower = type?.toLowerCase();
    let colorClasses = '';

    // Look up the color classes from the constant map
    if (typeLower) {
        if (category === 'session') {
            colorClasses = BADGE_COLOR_MAP.session[typeLower] || defaultSessionClasses;
        } else { // category === 'therapy'
            colorClasses = BADGE_COLOR_MAP.therapy[typeLower] || defaultTherapyClasses;
        }
    } else {
        // Handle undefined type - use default based on category
        colorClasses = category === 'session' ? defaultSessionClasses : defaultTherapyClasses;
    }

    // Use cn() to merge base classes with the determined color classes
    return cn(base, colorClasses);
}
