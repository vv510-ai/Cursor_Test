/** BFF 代理:浏览器 → /api/* → FastAPI 后端,流式 body 原样透传(SSE 友好)。 */
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

async function proxy(req: NextRequest, { params }: { params: { path: string[] } }) {
  const target = `${BACKEND}/api/${params.path.join("/")}${req.nextUrl.search}`;
  const init: RequestInit & { duplex?: string } = {
    method: req.method,
    headers: { "Content-Type": req.headers.get("content-type") || "application/json" },
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }
  const res = await fetch(target, init);
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") || "application/json",
      "Cache-Control": "no-cache",
    },
  });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE };
