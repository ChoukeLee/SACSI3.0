import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      /* ── macOS-style palette: cool+warm grays, system-blue accent, soft tones ── */
      colors: {
        brand: {
          /* Accent — macOS system blue (#007AFF family) */
          blue: {
            DEFAULT: "#0070E0",
            "50": "#F0F7FF",
            "100": "#DBECFE",
            "200": "#B8D8FD",
            "500": "#0070E0",
            "600": "#0059B3",
            "700": "#004C99",
          },
          /* Surface — warm-adjacent grays (macOS sidebar / window bg) */
          surface: {
            DEFAULT: "#F5F5F7",
            "50": "#FAFAFA",
            "100": "#F0F0F3",
            "200": "#E8E8ED",
            "300": "#DCDCE2",
          },
          /* Ink — Apple text grays, never pure black */
          ink: {
            DEFAULT: "#1D1D1F",
            "50": "#FAFAFA",
            "100": "#F5F5F7",
            "200": "#E8E8ED",
            "300": "#D2D2D7",
            "400": "#AEAEB2",
            "500": "#86868B",
            "600": "#6E6E73",
            "700": "#3A3A3C",
            "800": "#2C2C2E",
            "900": "#1D1D1F",
          },
          /* Semantic — Apple-style soft tints */
          green: { DEFAULT: "#34C759", "50": "#F0FDF4", "100": "#DCFCE7" },
          red: { DEFAULT: "#FF3B30", "50": "#FFF5F5", "100": "#FEE2E2" },
          amber: { DEFAULT: "#FF9500", "50": "#FFFBF0", "100": "#FFF3D6" },
          sky: { DEFAULT: "#5AC8FA", "50": "#F0FAFF", "100": "#E0F4FE" },
        },
      },
      /* ── macOS shadows: barely-there elevation ── */
      boxShadow: {
        "soft": "0 1px 3px 0 rgba(0,0,0,0.04)",
        "card": "0 2px 8px 0 rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.03)",
        "panel": "0 8px 32px 0 rgba(0,0,0,0.08), 0 0 0 0.5px rgba(0,0,0,0.04)",
        "dropdown": "0 4px 16px 0 rgba(0,0,0,0.06), 0 0 0 0.5px rgba(0,0,0,0.04)",
      },
      /* ── Border radius: Apple continuous curves ── */
      borderRadius: {
        "sm": "6px",
        "md": "8px",
        "lg": "12px",
        "xl": "16px",
        "2xl": "20px",
      },
      zIndex: {
        "base": "0", "sticky": "10", "dropdown": "20",
        "overlay": "40", "panel": "50", "toast": "100",
      },
      transitionDuration: {
        "fast": "120ms", "normal": "200ms", "slow": "300ms",
      },
    },
  },
  plugins: [],
};

export default config;
