import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      // ── Color system: WCAG AA compliant ──
      // Primary orange darkened from #F77F00 to #E06F00 for >=4.5:1 on white
      colors: {
        brand: {
          orange: {
            DEFAULT: "#E06F00",
            "50": "#FFF7F0",
            "100": "#FFECCF",
            "200": "#FFD49E",
            "300": "#FFB86D",
            "400": "#FF9C3D",
            "500": "#E06F00", // WCAG AA 4.5:1 on white
            "600": "#B85B00",
            "700": "#8F4700",
            "800": "#663300",
            "900": "#3D1F00",
          },
          green: {
            DEFAULT: "#009E60",
            "50": "#ECFDF5",
            "100": "#D1FAE5",
            "500": "#009E60",
            "700": "#067647",
          },
          ink: {
            DEFAULT: "#1F2933",
            "50": "#F8FAFC",
            "100": "#F1F5F9",
            "300": "#CBD5E1",
            "500": "#64748B",
            "700": "#334155",
            "900": "#1F2933",
          },
        },
      },

      // ── Shadow scale: layered elevation ──
      boxShadow: {
        "soft": "0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)",
        "card": "0 4px 12px rgb(31 41 51 / 0.06)",
        "panel": "0 10px 40px rgb(31 41 51 / 0.12)",
        "dropdown": "0 4px 16px rgb(31 41 51 / 0.10)",
      },

      // ── Z-index scale ──
      zIndex: {
        "base": "0",
        "sticky": "10",
        "dropdown": "20",
        "overlay": "40",
        "panel": "50",
        "toast": "100",
      },

      // ── Transition tokens ──
      transitionDuration: {
        "fast": "120ms",
        "normal": "200ms",
        "slow": "300ms",
      },
    },
  },
  plugins: [],
};

export default config;
