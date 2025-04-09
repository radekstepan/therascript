// src/constants.ts

// --- Session and Therapy Types ---
// Kept as they are used for Select dropdowns
export const SESSION_TYPES = [
  "individual", "phone", "skills group", "family session",
  "family skills", "couples", "couples individual"
];

export const THERAPY_TYPES = [
  "ACT", "DBT", "CBT", "ERP", "Mindfulness",
  "Couples ACT", "Couples DBT", "DBT Skills"
];

// --- REMOVED Badge Color Mappings ---
// These are no longer needed as Radix Themes Badge component handles colors via its `color` prop.
// The logic to map types to colors is now within the SessionListTable component.
// export const defaultSessionClasses = "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
// export const defaultTherapyClasses = "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200";
// export const BADGE_COLOR_MAP = { ... };
