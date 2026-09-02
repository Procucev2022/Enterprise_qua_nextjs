/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f4fa',
          100: '#dce5f4',
          200: '#bdd0e9',
          300: '#90b1dc',
          400: '#5d8fcc',
          500: '#074193', // Procucev Brand Dark Blue
          600: '#053476',
          700: '#042759',
          800: '#031b3e',
          900: '#021128',
          950: '#010a18',
        },
        indigo: {
          50: '#f0f4fa',
          100: '#dce5f4',
          200: '#bdd0e9',
          300: '#90b1dc',
          400: '#5d8fcc',
          500: '#074193', // Procucev Brand Dark Blue
          600: '#053476',
          700: '#042759',
          800: '#031b3e',
          900: '#021128',
          950: '#010a18',
        },
        amber: {
          50: '#fff2eb',
          100: '#ffe0cc',
          200: '#ffbf99',
          300: '#ff9c66',
          400: '#ff7433',
          500: '#ff4800', // Procucev Brand Orange
          600: '#cc3a00',
          700: '#992b00',
          800: '#661d00',
          900: '#330e00',
          950: '#1a0700',
        },
        purple: {
          50: '#fff0ff',
          100: '#ffd6ff',
          200: '#ffadff',
          300: '#ff75ff',
          400: '#ff3dff',
          500: '#ff00ff', // Procucev Brand Magenta
          600: '#cc00cc',
          700: '#990099',
          800: '#660066',
          900: '#330033',
          950: '#1a001a',
        },
        sky: {
          50: '#e6fcff',
          100: '#b3f7ff',
          200: '#80f2ff',
          300: '#4decff',
          400: '#1ae5ff',
          500: '#00dbff', // Procucev Brand Sky Blue
          600: '#00afcc',
          700: '#008399',
          800: '#005766',
          900: '#002c33',
          950: '#00161a',
        },
        cyan: {
          50: '#e6fcff',
          100: '#b3f7ff',
          200: '#80f2ff',
          300: '#4decff',
          400: '#1ae5ff',
          500: '#00ffff', // Procucev Brand Cyan
          600: '#00afcc',
          700: '#008399',
          800: '#005766',
          900: '#002c33',
          950: '#00161a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        space: ['"Space Grotesk"', 'sans-serif'],
        grotesk: ['"Space Grotesk"', 'sans-serif'],
        display: ['"Space Grotesk"', 'sans-serif'],
        inter: ['Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        jetbrains: ['"JetBrains Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
};
