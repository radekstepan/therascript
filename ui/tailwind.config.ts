// tailwind.config.js
const colors = require('tailwindcss/colors');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"], // Enable class-based dark mode
  content: [
    // App src files
    './src/**/*.{js,jsx,ts,tsx}',
    // Include public index if you use Tailwind classes there
    // './public/index.html'
  ],
  prefix: "", // No prefix for utilities
  theme: {
    container: { // Optional: configure container utility
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
       colors: {
         // Keep custom colors or define semantic ones if needed
         border: "hsl(var(--border))", // Example semantic color variable
         input: "hsl(var(--input))",
         ring: "hsl(var(--ring))",
         background: "hsl(var(--background))",
         foreground: "hsl(var(--foreground))",
         primary: {
           DEFAULT: "hsl(var(--primary))",
           foreground: "hsl(var(--primary-foreground))",
         },
         secondary: {
           DEFAULT: "hsl(var(--secondary))",
           foreground: "hsl(var(--secondary-foreground))",
         },
         destructive: {
           DEFAULT: "hsl(var(--destructive))",
           foreground: "hsl(var(--destructive-foreground))",
         },
         muted: {
           DEFAULT: "hsl(var(--muted))",
           foreground: "hsl(var(--muted-foreground))",
         },
         accent: {
           DEFAULT: "hsl(var(--accent))",
           foreground: "hsl(var(--accent-foreground))",
         },
         popover: {
           DEFAULT: "hsl(var(--popover))",
           foreground: "hsl(var(--popover-foreground))",
         },
         card: {
           DEFAULT: "hsl(var(--card))",
           foreground: "hsl(var(--card-foreground))",
         },
         // Add specific colors used in the design directly
         'brand': colors.blue, // Example keeping blue as brand
         'success': colors.emerald,
         'danger': colors.rose,
       },
       borderRadius: {
         lg: "var(--radius)", // Example using CSS variables for radius
         md: "calc(var(--radius) - 2px)",
         sm: "calc(var(--radius) - 4px)",
       },
       keyframes: { // Keep animations if defined, add Radix needed ones
         "accordion-down": {
           from: { height: "0" },
           to: { height: "var(--radix-accordion-content-height)" },
         },
         "accordion-up": {
           from: { height: "var(--radix-accordion-content-height)" },
           to: { height: "0" },
         },
          // Add keyframes for Radix Dialog/Select animations if needed (often included in tailwindcss-animate)
         "content-show": {
            from: { opacity: "0", transform: "translate(-50%, -48%) scale(0.96)" },
            to: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
         },
         "content-hide": {
             from: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
             to: { opacity: "0", transform: "translate(-50%, -48%) scale(0.96)" },
         },
          "slide-in-from-right": {
             from: { transform: "translateX(100%)" },
             to: { transform: "translateX(0)" },
         },
         "slide-out-to-right": {
             from: { transform: "translateX(0)" },
             to: { transform: "translateX(100%)" },
         },
       },
       animation: { // Keep animations if defined, add Radix needed ones
         "accordion-down": "accordion-down 0.2s ease-out",
         "accordion-up": "accordion-up 0.2s ease-out",
         // Add animations for Radix Dialog/Select if needed
         "content-show": "content-show 0.2s ease-out",
         "content-hide": "content-hide 0.2s ease-out",
         "slide-in-from-right": "slide-in-from-right 0.3s ease-out",
         "slide-out-to-right": "slide-out-to-right 0.3s ease-out",
       },
    },
  },
  plugins: [
      require("tailwindcss-animate"), // For Radix UI animations
      require('@tailwindcss/forms') // Keep for basic input styling if needed
    ],
}
