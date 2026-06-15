"use client";
/** Markdown 渲染:react-markdown + GFM;```mermaid 代码块经 CDN 渲染为图,
 *  失败(离线/CDN 不可达)时降级展示源码,保证演示永不白屏。 */
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getMermaid } from "@/lib/cdn";

let seq = 0;

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await getMermaid();
        const { svg } = await m.render(`mmd-${++seq}`, code);
        if (alive && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code]);
  if (failed)
    return (
      <pre className="!bg-[#0a0f22]">
        <code>{code}</code>
      </pre>
    );
  return <div ref={ref} className="my-2 overflow-x-auto rounded-lg border border-hairline bg-[#0a0f22] p-2" />;
}

export default function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div className={`prose-spark text-[13.5px] ${streaming ? "caret" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { className, children } = props as { className?: string; children?: React.ReactNode };
            const lang = /language-(\w+)/.exec(className || "")?.[1];
            const raw = String(children ?? "").replace(/\n$/, "");
            if (lang === "mermaid" && !streaming) return <MermaidBlock code={raw} />;
            if (lang)
              return (
                <pre>
                  <code>{raw}</code>
                </pre>
              );
            return <code>{raw}</code>;
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
