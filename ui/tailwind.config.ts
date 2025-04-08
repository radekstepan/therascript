// tailwind.config.js
const colors = require('tailwindcss/colors');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    // App src files - Make sure this matches your project structure
    './src/**/*.{js,jsx,ts,tsx}',
    // Correct path to Tremor node module files
    './node_modules/@tremor/**/*.{js,ts,jsx,tsx}',
    // Include public index if you use Tailwind classes there
    // './public/index.html'
  ],
  darkMode: 'class', // or 'media'
  theme: {
    transparent: 'transparent',
    current: 'currentColor',
    extend: {
      colors: {
        // Light mode
        tremor: {
          brand: {
            faint: colors.blue[50],
            muted: colors.blue[200],
            subtle: colors.blue[400],
            DEFAULT: colors.blue[500],
            emphasis: colors.blue[700],
            inverted: colors.white,
          },
          background: {
            muted: colors.gray[50],
            subtle: colors.gray[100],
            DEFAULT: colors.white,
            emphasis: colors.gray[700],
          },
          border: {
            DEFAULT: colors.gray[200],
          },
          ring: {
            DEFAULT: colors.gray[200],
          },
          content: {
            subtle: colors.gray[400],
            DEFAULT: colors.gray[500],
            emphasis: colors.gray[700],
            strong: colors.gray[900],
            inverted: colors.white,
          },
        },
        // Dark mode (optional, customize as needed)
        'dark-tremor': {
          brand: {
            faint: '#0B1229', // Adjust dark mode colors
            muted: colors.blue[950],
            subtle: colors.blue[800],
            DEFAULT: colors.blue[500],
            emphasis: colors.blue[400],
            inverted: colors.blue[950],
          },
          background: {
            muted: '#131A2B',
            subtle: colors.gray[800],
            DEFAULT: colors.gray[900],
            emphasis: colors.gray[300],
          },
          border: {
            DEFAULT: colors.gray[800],
          },
          ring: {
            DEFAULT: colors.gray[800],
          },
          content: {
            subtle: colors.gray[600],
            DEFAULT: colors.gray[500],
            emphasis: colors.gray[200],
            strong: colors.gray[50],
            inverted: colors.gray[950],
          },
        },
      },
      boxShadow: {
        // Light mode
        'tremor-input': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'tremor-card': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        'tremor-dropdown': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        // Dark mode
        'dark-tremor-input': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'dark-tremor-card': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        'dark-tremor-dropdown': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
      },
      borderRadius: {
        'tremor-small': '0.375rem', // rounded-md
        'tremor-default': '0.5rem', // rounded-lg
        'tremor-full': '9999px', // rounded-full
      },
      fontSize: {
        'tremor-label': ['0.75rem', { lineHeight: '1rem' }],       // text-xs
        'tremor-default': ['0.875rem', { lineHeight: '1.25rem' }], // text-sm
        'tremor-title': ['1.125rem', { lineHeight: '1.75rem' }],   // text-lg
        'tremor-metric': ['1.875rem', { lineHeight: '2.25rem' }],  // text-3xl
      },
    },
  },
  safelist: [
    // You might need to safelist specific classes if they are dynamically generated
    // and not directly present in your templates. Example:
    // {
    //   pattern: /^(bg|text|border)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(100|200|300|400|500|600|700|800|900|950)$/,
    //   variants: ['hover', 'ui-selected'],
    // },
  ],
  plugins: [
      require('@headlessui/tailwindcss'), // If using Headless UI
      require('@tailwindcss/forms')
    ],
};
