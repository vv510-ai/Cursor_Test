import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SparkLearn 星火学伴 · 多智能体个性化学习",
  description:
    "基于讯飞星火的个性化资源生成与学习多智能体系统 —— 数据结构与算法",
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
        <header className="sticky top-0 z-40 border-b border-hairline bg-ink/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="relative flex h-7 w-7 items-center justify-center rounded-md border border-spark/50 bg-panel">
                <span className="absolute h-2 w-2 rounded-full bg-ember shadow-[0_0_10px_2px_rgba(251,146,60,.6)]" />
                <span className="absolute inset-0 rounded-md border border-spark/20 animate-breathe" />
              </span>
              <span className="text-[15px] font-bold tracking-wide text-slate-100">
                SparkLearn <span className="text-ember">星火学伴</span>
              </span>
            </Link>
            <nav className="ml-2 flex items-center gap-1">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className="group rounded-md px-3 py-1.5 text-sm text-muted transition hover:bg-panel hover:text-body"
                >
                  <span className="mr-1.5 font-mono text-[10px] tracking-[0.18em] text-spark/60 group-hover:text-spark">
                    {n.code}
                  </span>
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto hidden items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-muted md:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-mint" />
              MULTI-AGENT · 数据结构与算法
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-5">{children}</main>
      </body>
    </html>
  );
}
