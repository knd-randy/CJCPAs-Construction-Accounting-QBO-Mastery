/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f3f6ff',
          100: '#dfe8ff',
          200: '#bed1ff',
          300: '#9ab7ff',
          400: '#6f90ff',
          500: '#465ef5',
          600: '#3245d8',
          700: '#2736ab',
          800: '#212f89',
          900: '#1f2c72',
        },
      },
      boxShadow: {
        card: '0 20px 45px rgba(15, 23, 42, 0.15)',
      },
    },
  },
  plugins: [],
}

