/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/client/**/*.{vue,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"PingFang SC"', 'sans-serif'],
        mono: ['SFMono-Regular', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
