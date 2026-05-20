import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          /* Accent — warm Côte d'Ivoire orange, used sparingly */
          orange: {
            DEFAULT: "#C96F2D",
            "50": "#FDF8F3",
            "100": "#FBE9DA",
            "200": "#F5CFAD",
            "300": "#E8A86F",
            "400": "#D98B44",
            "500": "#C96F2D",
            "600": "#A85A24",
            "700": "#87461C",
          },
          /* Surface — warm stone: Swiss spa / private bank */
          warm: {
            DEFAULT: "#F7F6F2",
            "50": "#FAFAF8",
            "100": "#F5F4EF",
            "200": "#EFEEE8",
            "300": "#E6E4DA",
            "400": "#DDDAD0",
            "500": "#C8C3B7",
            "600": "#A8A294",
            "700": "#7D7769",
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
          /* Semantic — muted, professional */
          green: {
            DEFAULT: "#4A6B4A",
            "50": "#F2F7F2",
            "100": "#E0EDE0",
            "200": "#B8D4B8",
            "300": "#8CAA8C",
            "400": "#769576",
            "500": "#4A6B4A",
            "600": "#3A563A",
            "700": "#2B412B",
          },
          red: {
            DEFAULT: "#8B3A3A",
            "50": "#FBF6F6",
            "100": "#F2E0E0",
            "200": "#E0B8B8",
            "300": "#BE8686",
            "400": "#AD6C6C",
            "500": "#8B3A3A",
            "600": "#6E2E2E",
            "700": "#522323",
          },
          amber: {
            DEFAULT: "#8B6914",
            "50": "#FDFAF2",
            "100": "#F9F0D5",
            "200": "#F0DB9A",
            "300": "#C8AD64",
            "400": "#B3974A",
            "500": "#8B6914",
            "600": "#6E5310",
            "700": "#523E0C",
          },
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
          },
        },
      },
      boxShadow: {
        "soft": "0 1px 2px 0 rgba(0,0,0,0.03)",
        "card": "0 1px 3px 0 rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.04)",
        "panel": "0 8px 32px 0 rgba(0,0,0,0.06), 0 0 0 0.5px rgba(0,0,0,0.04)",
        "dropdown": "0 4px 16px 0 rgba(0,0,0,0.05), 0 0 0 0.5px rgba(0,0,0,0.04)",
        "natural": "0 1px 2px 0 rgba(89,67,41,0.04), 0 2px 6px 0 rgba(89,67,41,0.03)",
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
