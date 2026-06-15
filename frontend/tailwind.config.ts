import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B1020",        // 深空底色
        panel: "#111A2E",      // 星图面板
        hairline: "#1E2A45",   // 细线
        spark: "#38BDF8",      // 电光蓝(智能体活动)
        ember: "#FB923C",      // 星火橙(品牌/CTA)
        mint: "#34D399",       // 已掌握/成功
        body: "#C7D2E8",
        muted: "#7C8DB0",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      animation: {
        breathe: "breathe 1.6s ease-in-out infinite",
        dash: "dash 1.2s linear infinite",
        rise: "rise .35s ease-out both",
      },
      keyframes: {
        breathe: { "0%,100%": { opacity: ".45" }, "50%": { opacity: "1" } },
        dash: { to: { strokeDashoffset: "-12" } },
        rise: { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "none" } },
      },
    },
  },
  plugins: [],
};
export default config;
