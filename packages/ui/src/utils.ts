// Purpose: General utility functions used across the UI package.

import { type ClassValue, clsx } from "clsx"; // Utility for conditionally joining class names together
import { twMerge } from "tailwind-merge"; // Utility to merge Tailwind CSS classes without conflicts

/**
 * Combines multiple class names or conditional class objects into a single string,
 * resolving Tailwind CSS class conflicts intelligently.
 *
 * Example: cn("p-4", "bg-blue-500", isActive && "font-bold", "bg-red-500")
 * Result (if isActive is true): "p-4 font-bold bg-red-500" (bg-blue-500 is overridden by bg-red-500)
 *
 * @param inputs - A list of class names (strings), conditional class objects, or arrays of class names.
 * @returns A merged string of class names.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
