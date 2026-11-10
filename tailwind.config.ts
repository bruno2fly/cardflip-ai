import type { Config } from "tailwindcss";

/**
 * CardFlip "private terminal" skin — tokens lifted from the approved v0 design.
 *
 * The app's pages use Tailwind's gray/yellow/green/red scales inline, so the
 * fastest faithful reskin is to RE-MAP those scales onto the v0 palette:
 *   gray-950 → #0B0B0C (page bg)      gray-900 → #121214 (panels)
 *   gray-800 → #18181B (raised)        gray-700 → #202024 (highest surface)
 *   gray-600 → #6B6964 (dim text)      gray-500 → #A09D96 (muted text)
 *   yellow-* → champagne gold #D7B87F family
 *   green-*  → up green #62C795 family, red-* → down red #E5706C family
 * Nothing in the pages' logic changes — only what these classes resolve to.
 */
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        gray: {
          200: "#DDDBD4",
          300: "#C7C4BC",
          400: "#B5B2AA",
          500: "#A09D96",
          600: "#6B6964",
          700: "#202024",
          750: "#1C1C20",
          800: "#18181B",
          850: "#151518",
          900: "#121214",
          950: "#0B0B0C",
        },
        yellow: {
          200: "#EDDDBC",
          300: "#E0C48F",
          400: "#D7B87F",
          500: "#C9A76C",
          600: "#B08F55",
          700: "#8A6D3C",
          800: "#4A4030",
          900: "#332A1B",
          950: "#201A11",
        },
        green: {
          300: "#7FD3A8",
          400: "#62C795",
          500: "#4FB786",
          600: "#3D9A6D",
          700: "#2E5C46",
          800: "#1F4634",
          900: "#16301F",
          950: "#0F1E17",
        },
        red: {
          300: "#F09692",
          400: "#E5706C",
          500: "#D95F5B",
          600: "#C24E4A",
          700: "#7A3431",
          800: "#5C2623",
          900: "#3F1A18",
          950: "#2A1110",
        },
        orange: {
          200: "#EFCBA4",
          300: "#E3B379",
          400: "#D9A05B",
          500: "#C98F4A",
          600: "#A9763B",
          700: "#6E4C26",
          800: "#523722",
          900: "#3A2718",
          950: "#251910",
        },
        blue: {
          400: "#8FA3BF",
          500: "#7A91B3",
          600: "#5F7396",
          800: "#2A3446",
          900: "#1C2330",
          950: "#12161F",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        DEFAULT: "4px",
        sm: "2px",
        md: "6px",
        lg: "10px",
        xl: "10px",
        "2xl": "12px",
        "3xl": "16px",
      },
      boxShadow: {
        hi: "inset 0 1px 0 rgba(255,255,255,.035)",
      },
    },
  },
  plugins: [],
};
export default config;
