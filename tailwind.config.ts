import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

// Colours are RGB channels in CSS variables (src/index.css) so every token supports /opacity.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: token("canvas"),
        panel: token("panel"),
        card: token("card"),
        raised: token("raised"),
        hover: token("hover"),
        line: token("line"),
        ink: token("ink"),
        muted: token("muted"),
        faint: token("faint"),
        accent: { DEFAULT: token("accent"), strong: token("accent-strong"), soft: token("accent-soft"), ink: token("accent-ink") },
        ok: token("ok"),
        warn: token("warn"),
        bad: token("bad"),
        info: token("info"),
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', "JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "22px",
        panel: "18px",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
