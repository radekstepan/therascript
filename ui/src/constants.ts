// src/constants.ts

// --- Session and Therapy Types (Keep as is) ---
export const SESSION_TYPES = [
  "individual", "phone", "skills group", "family session",
  "family skills", "couples", "couples individual"
];

export const THERAPY_TYPES = [
  "ACT", "DBT", "CBT", "ERP", "Mindfulness",
  "Couples ACT", "Couples DBT", "DBT Skills"
];

// --- Badge Color Mappings ---

// Define default classes
export const defaultSessionClasses = "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
export const defaultTherapyClasses = "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200"; // Example different default

// Define specific mappings (using lowercase keys for easier lookup)
export const BADGE_COLOR_MAP = {
  session: {
    'individual': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    'phone': 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
    'skills group': 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
    'family session': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
    'family skills': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    'couples': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
    'couples individual': 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900 dark:text-fuchsia-200',
    // Add mappings for any other SESSION_TYPES here
  } as Record<string, string>, // Type assertion for string keys
  therapy: {
    'act': 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
    'dbt': 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
    'cbt': 'bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200',
    'erp': 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200',
    'mindfulness': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
    'couples act': 'bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200',
    'couples dbt': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    'dbt skills': 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
     // Add mappings for any other THERAPY_TYPES here
  } as Record<string, string> // Type assertion for string keys
};
