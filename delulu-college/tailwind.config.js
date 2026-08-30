/** @type {import('tailwindcss').Config} */
// Compiled at build time with `npm run build:css` (see tailwind.input.css and
// package.json). This replaces the Tailwind Play CDN runtime compiler that was
// previously loaded from https://cdn.tailwindcss.com — the app now ships a
// static, dependency-free stylesheet with zero runtime CDN requests.
module.exports = {
  darkMode: 'class',
  content: ['./public/**/*.{html,js}'],
  theme: {
    extend: {
      colors: {
        'on-secondary-fixed': '#2b160a', 'outline-variant': '#dec0ba', 'on-surface': '#1b1c1c',
        'on-tertiary': '#ffffff', 'tertiary-fixed-dim': '#cbc5c2', 'surface-bright': '#fbf9f8',
        'on-tertiary-fixed-variant': '#494644', 'primary': '#a53b29', 'surface-dim': '#dcd9d9',
        'on-primary-fixed-variant': '#842415', 'tertiary-fixed': '#e7e1de', 'error': '#ba1a1a',
        'error-container': '#ffdad6', 'inverse-surface': '#303030', 'on-surface-variant': '#57423e',
        'on-secondary-container': '#795a4a', 'primary-fixed': '#ffdad4', 'surface': '#fbf9f8',
        'outline': '#8b716d', 'tertiary-container': '#a8a3a0', 'on-primary-container': '#731709',
        'secondary-container': '#fdd4c0', 'surface-container-low': '#f5f3f2', 'surface-container': '#f0eded',
        'surface-tint': '#a53b29', 'surface-container-highest': '#e4e2e1', 'secondary-fixed-dim': '#e6beab',
        'on-background': '#1b1c1c', 'on-error': '#ffffff', 'secondary': '#765848',
        'on-primary-fixed': '#3f0300', 'surface-container-high': '#eae8e7', 'surface-container-lowest': '#ffffff',
        'background': '#fbf9f8', 'inverse-primary': '#ffb4a6', 'on-error-container': '#93000a',
        'on-tertiary-fixed': '#1d1b19', 'on-secondary': '#ffffff', 'inverse-on-surface': '#f3f0f0',
        'secondary-fixed': '#ffdbca', 'primary-container': '#ff7e67', 'on-primary': '#ffffff',
        'on-tertiary-container': '#3c3a37', 'on-secondary-fixed-variant': '#5c4132', 'surface-variant': '#e4e2e1',
        'primary-fixed-dim': '#ffb4a6', 'tertiary': '#615e5b'
      },
      borderRadius: { DEFAULT: '1rem', lg: '2rem', xl: '3rem', full: '9999px' },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'serif']
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries')
  ]
};
