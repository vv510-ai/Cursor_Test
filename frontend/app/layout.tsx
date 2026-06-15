import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SparkLearn 星火学伴 · 多智能体个性化学习",
  description: "面向数据结构与算法学习的多智能体个性化学习工作台",
};

const NAV = [
  { href: "/", label: "学习对话", code: "CHAT" },
  { href: "/resources", label: "资源工坊", code: "FORGE" },
  { href: "/path", label: "学习路径", code: "PATH" },
  { href: "/eval", label: "学情评估", code: "EVAL" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">
        <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/88 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 md:min-h-16 md:flex-row md:items-center md:gap-6 md:py-0">
            <Link href="/" className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg border border-blue-200 bg-blue-50 text-sm font-black text-blue-700 shadow-sm">
                S
              </span>
              <span className="leading-tight">
                <span className="block text-base font-black tracking-tight text-slate-950">SparkLearn</span>
                <span className="block text-xs font-medium text-slate-500">星火学伴</span>
              </span>
            </Link>

            <nav className="no-scrollbar -mx-1 flex flex-1 items-center gap-1.5 overflow-x-auto px-1 md:justify-center">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="group shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
                >
                  <span className="mr-2 font-mono text-[10px] tracking-[0.18em] text-blue-500/75 group-hover:text-blue-600">
                    {n.code}
                  </span>
                  {n.label}
                </Link>
              ))}
            </nav>

            <div className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 lg:flex">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              多智能体在线
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
