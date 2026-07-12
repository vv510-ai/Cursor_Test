/** 重前端库(mermaid / markmap)走 CDN 动态加载:
 *  避免 npm 版本/构建风险;离线或 CDN 失败时由调用方降级为源码展示。 */

const loaded = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`load fail: ${src}`));
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src)!;
}

declare global {
  interface Window {
    mermaid?: {
      initialize: (c: object) => void;
      parse?: (code: string) => Promise<unknown> | unknown;
      render: (id: string, code: string) => Promise<{ svg: string }>;
    };
    markmap?: { Markmap: { create: (el: SVGElement, opts: object | undefined, data: unknown) => unknown }; Transformer: new () => { transform: (md: string) => { root: unknown } } };
  }
}

let mermaidReady = false;
export async function getMermaid() {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js");
  if (!window.mermaid) throw new Error("mermaid unavailable");
  if (!mermaidReady) {
    window.mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        primaryColor: "#eff6ff",
        primaryBorderColor: "#93c5fd",
        primaryTextColor: "#1e3a8a",
        lineColor: "#94a3b8",
        secondaryColor: "#f1f5f9",
        tertiaryColor: "#ffffff",
        fontSize: "13px",
      },
    });
    mermaidReady = true;
  }
  return window.mermaid;
}

export async function getMarkmap() {
  await loadScript("https://cdn.jsdelivr.net/npm/d3@7.9.0");
  await loadScript("https://cdn.jsdelivr.net/npm/markmap-lib@0.17.2");
  await loadScript("https://cdn.jsdelivr.net/npm/markmap-view@0.17.2");
  const g = window as unknown as { markmap?: Window["markmap"] };
  if (!g.markmap?.Markmap || !g.markmap?.Transformer) throw new Error("markmap unavailable");
  return g.markmap;
}
