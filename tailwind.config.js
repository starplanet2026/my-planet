/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        star: {
          50: '#fffdf0',
          100: '#fff9d6',
          200: '#fff0a8',
          300: '#ffe670',
          400: '#ffd633',
          500: '#ffc700',
          600: '#f5a300',
          700: '#cc8500',
        },
        coin: {
          50: '#fffbeb',
          100: '#fef3c7',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
        reward: {
          50: '#ecfdf5',
          500: '#10b981',
          600: '#059669',
        },
        penalty: {
          50: '#fef2f2',
          500: '#ef4444',
          600: '#dc2626',
        },
      },
      fontFamily: {
        sans: ['"PingFang SC"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        'cute': '1.5rem',
        'cute-lg': '2rem',
      },
      animation: {
        'coin-pop': 'coin-pop 0.4s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'bounce-soft': 'bounce-soft 0.5s ease-out',
      },
      keyframes: {
        'coin-pop': {
          '0%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.15)' },
          '100%': { transform: 'scale(1)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'bounce-soft': {
          '0%': { transform: 'scale(0.95)' },
          '50%': { transform: 'scale(1.05)' },
          '100%': { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
