"use client";
/** Markmap 交互脑图:markmap-lib/view 经 CDN 渲染;失败降级为 Markdown 大纲文本。 */
import { useEffect, useRef, useState } from "react";
import { getMarkmap } from "@/lib/cdn";

export default function Markmap({ markdown }: { markdown: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mm = await getMarkmap();
        const { root } = new mm.Transformer().transform(markdown);
        if (!alive || !ref.current) return;
        ref.current.innerHTML = "";
        mm.Markmap.create(
          ref.current,
          { autoFit: true, duration: 350, color: () => "#38bdf8" },
          root,
        );
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [markdown]);

  if (failed)
    return (
      <pre className="max-h-72 overflow-auto rounded-lg border border-hairline bg-[#0a0f22] p-3 text-xs leading-6 text-body">
        {markdown}
      </pre>
    );
  return (
    <svg
      ref={ref}
      className="h-72 w-full rounded-lg border border-hairline bg-[#0a0f22] [&_text]:!fill-[#c7d2e8] [&_text]:!text-[12px]"
    />
  );
}
