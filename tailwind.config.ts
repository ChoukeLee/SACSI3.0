import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['"MiSans"', '-apple-system', 'BlinkMacSystemFont', '"Helvetica Neue"', 'sans-serif'],
      },
      colors: {
        brand: {
          /* Accent — Ivory Coast orange #F77F00, used sparingly */
          orange: {
            DEFAULT: "#F77F00",
            "50": "#FEFAF5",
            "100": "#FDE1C4",
            "200": "#FCC992",
            "300": "#FCB05F",
            "400": "#FD972B",
            "500": "#F77F00",
            "600": "#CE6A00",
            "700": "#A75600",
            "800": "#814200",
            "900": "#512E09",
            "950": "#2D1A06",
          },
          /* Success — Ivory Coast green #009E60 */
          green: {
            DEFAULT: "#009E60",
            "50": "#F5FEFB",
            "100": "#B4FCDF",
            "200": "#71FBC3",
            "300": "#2CFBA8",
            "400": "#02E087",
            "500": "#009E60",
            "600": "#008952",
            "700": "#007345",
            "800": "#075737",
            "900": "#07412A",
            "950": "#062D1D",
          },
          /* Neutral — clean white-to-charcoal scale */
          neutral: {
            DEFAULT: "#FFFFFF",
            "50": "#FAFAFA",
            "100": "#F5F5F5",
            "200": "#EEEEEE",
            "300": "#E0E0E0",
            "400": "#BDBDBD",
            "500": "#9E9E9E",
            "600": "#757575",
            "700": "#616161",
            "800": "#424242",
            "900": "#212121",
            "950": "#1A1A1A",
          },
          /* Ink — warm near-black, never pure #000 */
          ink: {
            DEFAULT: "#1D1D1B",
            "50": "#F4F4F2",
            "100": "#E8E8E4",
            "200": "#D1D1CC",
            "300": "#8A8D84",
            "400": "#6B6E66",
            "500": "#5F625A",
            "600": "#4A4C45",
            "700": "#363830",
            "800": "#282921",
            "900": "#1D1D1B",
          },
          /* Danger — rich red, never orange for destructive actions */
          red: {
            DEFAULT: "#DC2626",
            "50": "#FEF2F2",
            "100": "#FEE2E2",
            "200": "#FECACA",
            "300": "#FCA5A5",
            "400": "#F87171",
            "500": "#DC2626",
            "600": "#B91C1C",
            "700": "#991B1B",
            "800": "#7F1D1D",
            "900": "#450A0A",
            "950": "#2D0505",
          },
          /* Warning — amber for alerts, checkouts, pending */
          amber: {
            DEFAULT: "#D97706",
            "50": "#FFFBEB",
            "100": "#FEF3C7",
            "200": "#FDE68A",
            "300": "#FCD34D",
            "400": "#FBBF24",
            "500": "#D97706",
            "600": "#B45309",
            "700": "#92400E",
            "800": "#78350F",
            "900": "#451A03",
            "950": "#2D1002",
          },
          /* Info — calm slate-blue for neutral metadata */
          sky: {
            DEFAULT: "#4A6B7D",
            "50": "#F4F7F9",
            "100": "#E0EAF0",
            "200": "#B8CFDA",
            "300": "#8CA7B5",
            "400": "#7693A2",
            "500": "#4A6B7D",
            "600": "#3A5564",
            "700": "#2B404B",
            "800": "#1E2D35",
            "900": "#121B20",
            "950": "#0A0F12",
          },
          /* Backward compat alias — maps old warm tokens to neutral */
          warm: {
            DEFAULT: "#FFFFFF",
            "50": "#FAFAFA",
            "100": "#F5F5F5",
            "200": "#EEEEEE",
            "300": "#E0E0E0",
            "400": "#BDBDBD",
            "500": "#9E9E9E",
            "600": "#757575",
            "700": "#616161",
          },
        },
      },
      boxShadow: {
        "soft": "0 1px 2px 0 rgba(15,23,42,0.05)",
        "card": "0 1px 2px rgba(15,23,42,0.05), 0 10px 28px -24px rgba(15,23,42,0.35)",
        "panel": "0 20px 48px -24px rgba(15,23,42,0.32), 0 0 0 1px rgba(15,23,42,0.04)",
        "dropdown": "0 12px 28px -18px rgba(15,23,42,0.28), 0 0 0 1px rgba(15,23,42,0.05)",
        "natural": "0 1px 2px rgba(15,23,42,0.05), 0 14px 34px -30px rgba(89,67,41,0.45)",
        "lifted": "0 18px 44px -34px rgba(15,23,42,0.45)",
      },
      borderRadius: {
        "sm": "6px",
        "md": "8px",
        "lg": "10px",
        "xl": "14px",
        "2xl": "18px",
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
