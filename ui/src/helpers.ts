// src/helpers.ts

/**
 * Gets today's date as a string in "YYYY-MM-DD" format.
 */
export const getTodayDateString = (): string => {
  const today = new Date();
  const year = today.getFullYear();
  // getMonth() is 0-indexed, so add 1
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
* Formats a Unix timestamp (milliseconds) into a locale-aware date and time string.
* Returns an empty string or 'Invalid Date' if the timestamp is invalid.
* @param timestamp - The Unix timestamp in milliseconds.
*/
export const formatTimestamp = (timestamp?: number): string => {
  if (timestamp === null || timestamp === undefined || isNaN(timestamp)) {
      return ''; // Return empty for null, undefined, or NaN
  }
  try {
      const date = new Date(timestamp);
      // Check if the date object is valid after creation
      if (isNaN(date.getTime())) {
         return 'Invalid Date';
      }
      // Use locale-aware formatting
      return date.toLocaleString(undefined, {
          dateStyle: 'short', // e.g., "3/29/2024"
          timeStyle: 'short'  // e.g., "10:30 AM"
      });
  } catch (e) {
      console.error("Error formatting timestamp:", timestamp, e);
      return 'Invalid Date'; // Return specific error string on exception
  }
};
