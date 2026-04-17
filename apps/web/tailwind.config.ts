import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0f',
        panel: '#12121a',
        card: '#1a1a2e',
        fg: '#e0e0e0',
        mute: '#8892b0',
        dim: '#4a5568',
        neon: {
          green: '#00ff41',
          cyan: '#00e5ff',
          red: '#ff003c',
          amber: '#ffab00',
        },
      },
      fontFamily: {
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'JetBrains Mono', 'Menlo', 'monospace'],
      },
      animation: {
        blink: 'blink 1s steps(1) infinite',
        scan: 'scan 8s linear infinite',
        flicker: 'flicker 6s steps(1) infinite',
        'pulse-border': 'pulseBorder 2s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 2.2s ease-in-out infinite',
        'fade-in': 'fadeIn 0.4s ease-out both',
        'slide-up': 'slideUp 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both',
      },
      keyframes: {
        blink: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0' } },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        flicker: {
          '0%, 96%, 100%': { opacity: '1' },
          '97%': { opacity: '0.92' },
          '98%': { opacity: '1' },
          '99%': { opacity: '0.97' },
        },
        pulseBorder: {
          '0%, 100%': { borderColor: 'rgba(0, 229, 255, 0.2)' },
          '50%': { borderColor: 'rgba(0, 229, 255, 0.6)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(0, 255, 65, 0.0)' },
          '50%': { boxShadow: '0 0 24px 0 rgba(0, 255, 65, 0.25)' },
        },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
