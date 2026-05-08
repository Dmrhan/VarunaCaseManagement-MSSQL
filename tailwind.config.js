/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef4ff',
          100: '#dbe6ff',
          200: '#bccfff',
          300: '#8eaeff',
          400: '#5e85ff',
          500: '#3b62f5',
          600: '#2945d6',
          700: '#2237a8',
          800: '#1f3088',
          900: '#1d2c70',
        },
        // Navy Dark palette — dark mode için Tailwind extension'ı
        // (Tailwind'in mevcut slate ailesi yeterli olmadığında bu değerler kullanılır)
        ndark: {
          bg:      '#0D1117',  // en koyu — html/body
          surface: '#161B22',  // kartlar, paneller
          card:    '#1C2128',  // iç kartlar
          border:  '#30363D',
          text:    '#E6EDF3',
          muted:   '#7D8590',
          dim:     '#484F58',
          accent:  '#1F6FEB',
          link:    '#58A6FF',
        },
        runa: {
          DEFAULT: '#4B0FAE',
          dark:    '#6E40C9',  // dark mode sol kenar
          text:    '#A78BFA',  // dark mode brand text
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.08)',
        drawer: '-12px 0 32px -8px rgb(15 23 42 / 0.18)',
      },
      keyframes: {
        'fade-slide': {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-slide': 'fade-slide 200ms ease-out',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
