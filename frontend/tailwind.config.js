/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'sans': ['JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'monospace'],
        'mono': ['JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'monospace'],
      },
      colors: {
        'bg-primary': '#F5F5F0',
        'bg-secondary': '#EEEEEE',
        'text-primary': '#1A1A1A',
        'text-secondary': '#6B6B6B',
        'accent': '#FF4F00',
        'accent-hover': '#E64500',
        'border': '#1A1A1A',
        'nb-black': '#000000',
      },
      boxShadow: {
        'brutal': '4px 4px 0px black',
        'brutal-sm': '2px 2px 0px black',
      },
    },
  },
  plugins: [],
}
