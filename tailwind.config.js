/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        accent: '#2563EB',
        'accent-light': '#EFF6FF',
        'accent-hover': '#1D4ED8',
        surface: 'var(--bg-card)',
        'surface-elevated': 'var(--bg-elevated)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        border: 'var(--border)',
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '20px',
      }
    },
  },
  plugins: [],
}
