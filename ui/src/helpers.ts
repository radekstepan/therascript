// src/helpers.ts
// Removed cn import as it's not used here anymore
// REMOVED: Unused badge color map imports

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
      // Using standard Intl formatting for locale-awareness
      return date.toLocaleString(undefined, {
          dateStyle: 'short',
          timeStyle: 'short'
      });
  } catch (e) {
      console.error("Error formatting timestamp:", timestamp, e);
      return 'Invalid Date';
  }
};


// --- REMOVED getBadgeClasses function ---
// This function is no longer needed because Radix Themes Badge component
// handles color variants directly via its `color` prop.
// The logic to map session/therapy types to specific colors is now
// handled within the SessionListTable component using color maps.
/*
export const getBadgeClasses = (type?: string, category: 'session' | 'therapy' = 'session'): string => {
    // ... old implementation ...
}
*/
