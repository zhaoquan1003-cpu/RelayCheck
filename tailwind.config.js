/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/client/**/*.{vue,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}