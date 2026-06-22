"use client";
/** Markmap 交互脑图:markmap-lib/view 经 CDN 渲染;失败降级为 Markdown 大纲文本。 */
import { useEffect, useRef, useState } from "react";
import { getMarkmap } from "@/lib/cdn";

const MARKMAP_LIB_ESM_URL = "https://cdn.jsdelivr.net/npm/markmap-lib@0.17.2/+esm";
const MARKMAP_VIEW_ESM_URL = "https://cdn.jsdelivr.net/npm/markmap-view@0.17.2/+esm";

const MARKMAP_JSON_OPTIONS = {
  color: ["#38bdf8", "#818cf8", "#22c55e", "#f59e0b", "#f472b6", "#2dd4bf"],
  colorFreezeLevel: 2,
  duration: 220,
  fitRatio: 0.9,
  initialExpandLevel: 2,
  maxInitialScale: 1.35,
  maxWidth: 220,
  nodeMinHeight: 20,
  paddingX: 12,
  spacingHorizontal: 96,
  spacingVertical: 12,
};

type D3SelectionLike = {
  attr: (...args: unknown[]) => D3SelectionLike;
  call: (...args: unknown[]) => D3SelectionLike;
  on: (...args: unknown[]) => D3SelectionLike;
  remove: () => D3SelectionLike;
  select: (...args: unknown[]) => D3SelectionLike;
  selectAll: (...args: unknown[]) => D3SelectionLike;
  style: (...args: unknown[]) => D3SelectionLike;
};

function instantTransition(selection: D3SelectionLike) {
  const chain = (sel: D3SelectionLike) => ({
    attr: (...args: unknown[]) => {
      sel.attr(...args);
      return chain(sel);
    },
    call: (...args: unknown[]) => {
      sel.call(...args);
      return chain(sel);
    },
    end: () => Promise.resolve(),
    on: (...args: unknown[]) => {
      sel.on(...args);
      return chain(sel);
    },
    remove: () => {
      sel.remove();
      return chain(sel);
    },
    select: (...args: unknown[]) => chain(sel.select(...args)),
    selectAll: (...args: unknown[]) => chain(sel.selectAll(...args)),
    style: (...args: unknown[]) => {
      sel.style(...args);
      return chain(sel);
    },
  });
  return chain(selection);
}

type MarkmapRuntime = {
  Markmap: { create: (el: SVGElement, opts: object | undefined, data: unknown) => unknown };
  Transformer: new () => { transform: (md: string) => { root: unknown } };
  deriveOptions?: (opts: object) => object;
};

async function loadMarkmapRuntime(): Promise<MarkmapRuntime> {
  try {
    return (await getMarkmap()) as MarkmapRuntime;
  } catch {
    const [lib, view] = await Promise.all([
      import(/* webpackIgnore: true */ MARKMAP_LIB_ESM_URL),
      import(/* webpackIgnore: true */ MARKMAP_VIEW_ESM_URL),
    ]);
    return { ...lib, ...view } as MarkmapRuntime;
  }
}

export default function Markmap({ markdown }: { markdown: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    (async () => {
      try {
        const mm = await loadMarkmapRuntime();
        const { root } = new mm.Transformer().transform(markdown);
        const options = {
          autoFit: true,
          pan: true,
          zoom: true,
          ...(mm.deriveOptions ? mm.deriveOptions(MARKMAP_JSON_OPTIONS) : MARKMAP_JSON_OPTIONS),
        };
        if (!alive || !ref.current) return;
        ref.current.innerHTML = "";
        const markmap = mm.Markmap.create(ref.current, options, null) as {
          setData: (data: unknown) => void;
          transition: (selection: D3SelectionLike) => unknown;
        };
        markmap.transition = instantTransition;
        markmap.setData(root);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [markdown]);

  if (!markdown.trim()) {
    return (
      <div className="border-y border-orange-200 bg-orange-50 px-3 py-3 text-sm text-orange-800">
        <div className="font-bold">脑图内容为空</div>
        <div className="mt-1 text-xs leading-5 text-orange-700">当前资源没有可渲染的 Markdown 层级。</div>
      </div>
    );
  }

  if (failed)
    return (
      <pre className="max-h-72 overflow-auto rounded-lg border border-hairline bg-[#0a0f22] p-3 text-xs leading-6 text-body">
        {markdown}
      </pre>
    );
  return (
    <div className="markmap-dark rounded-lg border border-hairline bg-[#08111f] p-3 shadow-inner shadow-black/20">
      <svg
        ref={ref}
        className="h-80 w-full rounded-md bg-[#0a0f22] [&_.markmap-foreign]:!text-[#dbeafe] [&_.markmap-foreign]:!text-[12px] [&_.markmap-link]:!opacity-80 [&_circle]:!stroke-[2px]"
      />
    </div>
  );
}
