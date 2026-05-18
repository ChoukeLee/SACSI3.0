import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      /* ── Premium minimalist palette: warm stone + single restrained accent ── */
      colors: {
        brand: {
          /* Accent — used ONLY for primary CTAs and active nav. Warm amber, not aggressive orange. */
          accent: {
            DEFAULT: "#B85C00",
            "50": "#FDF8F3",
            "100": "#F9EDE2",
            "200": "#F0D3B8",
            "500": "#B85C00",
            "600": "#9A4D00",
            "700": "#7A3D00",
          },
          /* Surface — warm off-white for cards and backgrounds */
          surface: {
            DEFAULT: "#FAFAF8",
            "50": "#FDFDFC",
            "100": "#F7F6F3",
            "200": "#EEECE7",
          },
          /* Ink — cool dark grays for text, never pure black */
          ink: {
            DEFAULT: "#1A1D20",
            "50": "#F8F9FA",
            "100": "#F1F3F5",
            "200": "#E4E7EB",
            "300": "#CBD2D9",
            "400": "#9AA5B1",
            "500": "#7B8794",
            "600": "#616E7C",
            "700": "#3E4C59",
            "800": "#323F4B",
            "900": "#1A1D20",
          },
          /* Semantic — minimal, used for status indicators only */
          green: { DEFAULT: "#0D7B4A", "50": "#F0F9F4", "100": "#DCF2E4" },
          red: { DEFAULT: "#C1292E", "50": "#FEF5F5", "100": "#FDE8E8" },
          amber: { DEFAULT: "#8B6914", "50": "#FDF8F0", "100": "#F9EDD8" },
          sky: { DEFAULT: "#0B6E8A", "50": "#F0F8FB", "100": "#DDF0F5" },
        },
      },

      /* ── Shadows: barely-there, refined ── */
      boxShadow: {
        "soft": "0 1px 2px 0 rgb(0 0 0 / 0.03)",
        "card": "0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.03)",
        "panel": "0 10px 40px rgb(0 0 0 / 0.08)",
        "dropdown": "0 4px 16px rgb(0 0 0 / 0.06)",
      },

      zIndex: {
        "base": "0", "sticky": "10", "dropdown": "20",
        "overlay": "40", "panel": "50", "toast": "100",
      },

      transitionDuration: {
        "fast": "120ms", "normal": "200ms", "slow": "300ms",
      },

      /* ── Typography: refined letter-spacing ── */
      letterSpacing: {
        "tighten": "-0.02em",
        "widen": "0.06em",
      },
    },
  },
  plugins: [],
};

export default config;
