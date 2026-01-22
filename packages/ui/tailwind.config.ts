// Tailwind CSS configuration file for the UI package.
// Configures theme settings, content paths, and plugins.

const colors = require('tailwindcss/colors'); // Import Tailwind's default color palette

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Use 'class' strategy for dark mode, allowing theme toggling via parent element class
  darkMode: ['class'],
  // Specify files where Tailwind should look for class names to include in the build.
  content: [
    './src/**/*.{js,jsx,ts,tsx}', // Include all JS/TS/JSX/TSX files in the src directory
    // './public/index.html' // Usually not needed unless classes are directly in HTML
  ],
  // No prefix for generated utility classes (e.g., use 'text-red-500' instead of 'tw-text-red-500')
  prefix: '',
  theme: {
    // Container utility configuration (centering, padding)
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px', // Max width for the container at 2xl breakpoint
      },
    },
    // Extend the default Tailwind theme
    extend: {
      // Custom color palettes (can be used alongside Radix theme colors if needed for non-component styling)
      colors: {
        // === MODIFICATION START ===
        // Switch to Zinc for a modern, premium gray scale (similar to Vercel/Shadcn)
        gray: colors.zinc,
        // === MODIFICATION END ===

        brand: colors.blue, // Example custom brand color
        success: colors.emerald, // Example custom success color
        danger: colors.rose, // Example custom danger color
      },
      // Custom border radius values (can be useful if not solely relying on Radix Theme radius)
      borderRadius: {
        // Example using CSS variables (potentially from Radix Theme)
        // lg: "var(--radius)",
        // md: "calc(var(--radius) - 2px)",
        // sm: "calc(var(--radius) - 4px)",
      },
      // Custom keyframes for animations
      keyframes: {
        // Example:
        // 'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        // 'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      // Custom animation utilities
      animation: {
        // Example:
        // 'accordion-down': 'accordion-down 0.2s ease-out',
        // 'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  // Tailwind CSS plugins
  plugins: [
    // require("tailwindcss-animate"), // Example: Plugin for animation utilities
    // require('@tailwindcss/forms'),   // Example: Plugin for form styling resets (may conflict with Radix)
    // Add other necessary Tailwind plugins here
  ],
};
