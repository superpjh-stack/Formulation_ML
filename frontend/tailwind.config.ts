import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      // SF-TD3 §1.1. 값은 app/globals.css `:root` 와 **반드시** 같아야 한다.
      // brand.text / brand.border 2건은 TD3 표(#1A2035 / #E2E6EF)와 다른데,
      // globals.css 및 44화면 하드코딩과 일치시킨 의도적 선택이다.
      // 근거·전환 절차: specs/design-standards.md §4
      colors: {
        bg: "#EEF0F4",
        sidebar: {
          DEFAULT: "#0E1320",
          text: "#E7EAF0",
        },
        primary: {
          DEFAULT: "#3A5BD9",
          light: "#6B8AFF",
        },
        brand: {
          text: "#161B26", // SF-TD3: #1A2035
          sub: "#687182",
          muted: "#9AA4B2",
          border: "#E4E7EC", // SF-TD3: #E2E6EF
          subtle: "#F8F9FB",
        },
        success: "#22C55E",
        warning: "#F59E0B",
        danger: "#EF4444",
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
      borderRadius: {
        card: "12px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.03)",
      },
    },
  },
  plugins: [],
};

export default config;
