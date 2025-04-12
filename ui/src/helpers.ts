// TODO merge in utils here

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
