// Tailwind v4 runs as a PostCSS plugin. Without this file `@import "tailwindcss"` in globals.css is
// never processed, no utility class is generated and the whole app renders unstyled.
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
