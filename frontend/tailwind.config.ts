import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#EEF0F4",
        sidebar: "#0E1320",
        primary: {
          DEFAULT: "#3A5BD9",
          light: "#6B8AFF",
        },
        brand: {
          text: "#161B26",
          sub: "#687182",
          muted: "#9AA4B2",
          border: "#E4E7EC",
        },
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
