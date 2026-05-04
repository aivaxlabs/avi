export default {
  content: ['./index.html', './src/renderer/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 24px 80px var(--shadow-brand)',
        soft: '0 18px 60px var(--shadow-soft)',
      },
    },
  },
  plugins: [],
};
