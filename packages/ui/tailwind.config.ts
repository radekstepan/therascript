// tailwind.config.js
const colors = require('tailwindcss/colors');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"], // Keep class-based dark mode if needed for Theme provider
  content: [
    // App src files
    './src/**/*.{js,jsx,ts,tsx}',
    // './public/index.html'
  ],
  prefix: "", // No prefix for utilities
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
       colors: {
         // Keep specific color palettes if needed for NON-COMPONENT styling
         'brand': colors.blue,
         'success': colors.emerald,
         'danger': colors.rose,
       },
       borderRadius: {
         // Keep if using Tailwind radius classes alongside Themes
         // lg: "var(--radius)",
         // md: "calc(var(--radius) - 2px)",
         // sm: "calc(var(--radius) - 4px)",
       },
       keyframes: {
         // Keep general keyframes if any (e.g., spin)
       },
       animation: {
          // Keep general animations if any
       },
    },
  },
  plugins: [
      // Remove plugins related to old UI system
    ],
}
