/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'sans': ['Inter', 'Poppins', 'Segoe UI', 'Tahoma', 'Geneva', 'Verdana', 'sans-serif'],
        'mono': ['Inter', 'Poppins', 'Segoe UI', 'Tahoma', 'Geneva', 'Verdana', 'sans-serif'],
      },
      colors: {
        'bg-primary': '#F8FAFC',
        'bg-secondary': '#F8FAFC',
        'text-primary': '#0F172A',
        'text-secondary': '#475569',
        'accent': '#2563EB',
        'accent-hover': '#1D4ED8',
        'border': '#CBD5E1',
        'nb-black': '#0F172A',
      },
      boxShadow: {
        'brutal': '0 8px 24px -12px rgba(15, 23, 42, 0.12)',
        'brutal-sm': '0 4px 10px -6px rgba(15, 23, 42, 0.10)',
      },
    },
  },
  plugins: [],
}
