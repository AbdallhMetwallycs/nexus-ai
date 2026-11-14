/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // NEXUS surface scale (dark-first) driven by CSS variables in index.css
        surface: {
          base: 'rgb(var(--s-base) / <alpha-value>)',
          raised: 'rgb(var(--s-raised) / <alpha-value>)',
          overlay: 'rgb(var(--s-overlay) / <alpha-value>)',
          line: 'rgb(var(--s-line) / <alpha-value>)',
        },
        ink: {
          primary: 'rgb(var(--ink-primary) / <alpha-value>)',
          secondary: 'rgb(var(--ink-secondary) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        accent: {
          DEFAULT: '#38BDF8',
          soft: '#7DD3FC',
          deep: '#0284C7',
          glow: 'rgba(56, 189, 248, 0.15)',
        },
        violet: {
          DEFAULT: '#A78BFA',
          deep: '#7C3AED',
        },
        state: {
          ok: '#34D399',
          warn: '#FBBF24',
          err: '#F87171',
          info: '#38BDF8',
          idle: '#94A3B8',
        },
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'Cascadia Code', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', '1rem'],
      },
      borderRadius: {
        card: '12px',
        field: '8px',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.25), 0 0 0 1px rgb(255 255 255 / 0.04)',
        pop: '0 8px 24px rgb(0 0 0 / 0.45)',
        glow: '0 0 0 1px rgb(56 189 248 / 0.35), 0 0 16px rgb(56 189 248 / 0.12)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-dot': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 180ms ease-out',
        'pulse-dot': 'pulse-dot 1.6s ease-in-out infinite',
        shimmer: 'shimmer 1.2s linear infinite',
      },
    },
  },
  plugins: [],
};
