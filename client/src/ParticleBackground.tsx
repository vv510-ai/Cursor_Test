import { useEffect, useRef } from "react";

import "./ParticleBackground.css";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
};

/**
 * Full-viewport particle + link mesh. pointer-events: none; sits behind UI.
 */
export function ParticleBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let canvasEl: HTMLCanvasElement;
    let gfx: CanvasRenderingContext2D;
    const r = ref.current;
    if (!(r instanceof HTMLCanvasElement)) return;
    const g = r.getContext("2d");
    if (!(g instanceof CanvasRenderingContext2D)) return;
    canvasEl = r;
    gfx = g;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const particles: Particle[] = [];

    const lineRgb = [99, 179, 237] as const;
    const glowRgb = [56, 189, 248] as const;

    function initParticles(w: number, h: number) {
      particles.length = 0;
      const area = w * h;
      const density = 0.000075;
      let n = Math.floor(area * density);
      n = Math.max(40, Math.min(n, 130));
      if (reduced) n = Math.min(n, 28);

      for (let i = 0; i < n; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: reduced ? 0 : (Math.random() - 0.5) * 0.45,
          vy: reduced ? 0 : (Math.random() - 0.5) * 0.45,
          r: Math.random() * 1.15 + 0.55,
        });
      }
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvasEl.width = Math.floor(w * dpr);
      canvasEl.height = Math.floor(h * dpr);
      canvasEl.style.width = `${w}px`;
      canvasEl.style.height = `${h}px`;
      gfx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initParticles(w, h);
    }

    const linkDistBase = () => Math.min(window.innerWidth, window.innerHeight) * 0.125;

    function step() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const linkDist = linkDistBase();

      gfx.clearRect(0, 0, w, h);

      for (const p of particles) {
        if (!reduced) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;
          p.x = Math.min(w, Math.max(0, p.x));
          p.y = Math.min(h, Math.max(0, p.y));
          p.vx += (Math.random() - 0.5) * 0.012;
          p.vy += (Math.random() - 0.5) * 0.012;
          const cap = 0.65;
          p.vx = Math.min(cap, Math.max(-cap, p.vx));
          p.vy = Math.min(cap, Math.max(-cap, p.vy));
        }
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          if (d < linkDist && d > 0) {
            const t = 1 - d / linkDist;
            const alpha = t * t * 0.42;
            gfx.strokeStyle = `rgba(${lineRgb[0]},${lineRgb[1]},${lineRgb[2]},${alpha})`;
            gfx.lineWidth = 0.55;
            gfx.beginPath();
            gfx.moveTo(a.x, a.y);
            gfx.lineTo(b.x, b.y);
            gfx.stroke();
          }
        }
      }

      for (const p of particles) {
        const grad = gfx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        grad.addColorStop(0, `rgba(${glowRgb[0]},${glowRgb[1]},${glowRgb[2]},0.75)`);
        grad.addColorStop(0.45, `rgba(${glowRgb[0]},${glowRgb[1]},${glowRgb[2]},0.22)`);
        grad.addColorStop(1, "rgba(56,189,248,0)");
        gfx.fillStyle = grad;
        gfx.beginPath();
        gfx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        gfx.fill();
        gfx.fillStyle = `rgba(224,242,254,0.9)`;
        gfx.beginPath();
        gfx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        gfx.fill();
      }

      if (!reduced) raf = requestAnimationFrame(step);
    }

    resize();
    window.addEventListener("resize", resize);
    if (reduced) step();
    else raf = requestAnimationFrame(step);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={ref} className="particle-bg" aria-hidden />;
}
