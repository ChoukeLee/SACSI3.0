import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(30 12% 90%)",
        input: "hsl(30 12% 90%)",
        ring: "hsl(14 86% 55%)",
        background: "hsl(30 6% 98%)",
        foreground: "hsl(24 8% 11%)",
        primary: {
          DEFAULT: "hsl(14 86% 55%)",
          foreground: "hsl(0 0% 100%)",
        },
        secondary: {
          DEFAULT: "hsl(34 8% 96%)",
          foreground: "hsl(24 8% 11%)",
        },
        destructive: {
          DEFAULT: "hsl(0 52% 52%)",
          foreground: "hsl(0 0% 100%)",
        },
        muted: {
          DEFAULT: "hsl(34 8% 96%)",
          foreground: "hsl(24 4% 42%)",
        },
        accent: {
          DEFAULT: "hsl(14 86% 96%)",
          foreground: "hsl(14 70% 35%)",
        },
        popover: {
          DEFAULT: "hsl(0 0% 100%)",
          foreground: "hsl(24 8% 11%)",
        },
        card: {
          DEFAULT: "hsl(0 0% 100%)",
          foreground: "hsl(24 8% 11%)",
        },
        sidebar: {
          DEFAULT: "hsl(30 6% 98%)",
          foreground: "hsl(24 8% 11%)",
          primary: "hsl(14 86% 55%)",
          "primary-foreground": "hsl(0 0% 100%)",
          accent: "hsl(34 8% 96%)",
          "accent-foreground": "hsl(24 8% 11%)",
          border: "hsl(30 12% 90%)",
          ring: "hsl(14 86% 55%)",
        },
      },
      fontFamily: {
        sans: ['"MiSans"', '"Microsoft YaHei"', '"PingFang SC"', '"Segoe UI"', "system-ui", "-apple-system", "sans-serif"],
        mono: ['"ui-monospace"', '"SFMono-Regular"', '"Menlo"', '"Monaco"', '"Consolas"', "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
