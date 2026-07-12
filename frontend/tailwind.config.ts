import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#F7F9FC",
        panel: "#FFFFFF",
        hairline: "#D8E0EC",
        spark: "#2563EB",
        ember: "#F97316",
        mint: "#059669",
        body: "#1F2937",
        muted: "#64748B",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      animation: {
        breathe: "breathe 1.6s ease-in-out infinite",
        dash: "dash 1.2s linear infinite",
        rise: "rise .35s ease-out both",
        slide: "slide 1.1s ease-in-out infinite",
      },
      keyframes: {
        breathe: { "0%,100%": { opacity: ".45" }, "50%": { opacity: "1" } },
        dash: { to: { strokeDashoffset: "-12" } },
        rise: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "none" },
        },
        slide: {
          "0%": { transform: "translateX(-120%)" },
          "100%": { transform: "translateX(320%)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
