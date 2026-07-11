/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9eaff',
          200: '#bcdaff',
          300: '#8ec3fe',
          400: '#59a1fb',
          500: '#337ef7',
          600: '#1d5fec',
          700: '#154ad9',
          800: '#173daf',
          900: '#19388a',
          950: '#142354'
        }
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }]
      }
    },
  },
  plugins: [],
};
