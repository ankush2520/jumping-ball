"use client";

import React, { useEffect, useRef } from "react";

export default function AnimatedBackground(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    let raf = 0;
    let width = 0;
    let height = 0;
    let dpr = Math.max(1, window.devicePixelRatio || 1);

    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      hue: number;
      alpha: number;
    };

    let particles: Particle[] = [];

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      initParticles();
    };

    const initParticles = () => {
      // Drastically reduced particle count for performance
      const density = width < 768 ? 12 : 16;
      particles = [];
      for (let i = 0; i < density; i++) {
        const speed = 0.15 + Math.random() * 0.35;
        const angle = Math.random() * Math.PI * 2;
        particles.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.5,
          r: 2 + Math.random() * 4,
          hue: 230 - Math.random() * 60,
          alpha: 0.1 + Math.random() * 0.2,
        });
      }
    };

    let lastT = performance.now();

    function drawGradient() {
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, "#07102a");
      g.addColorStop(0.25, "#0b1633");
      g.addColorStop(0.5, "#2b0d3a");
      g.addColorStop(1, "#0b1230");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }

    function drawVignette() {
      const vg = ctx.createRadialGradient(
        width / 2,
        height / 2,
        Math.min(width, height) * 0.25,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.8,
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(3,6,16,0.55)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, width, height);
    }

    function updateAndRender(t: number) {
      const now = t;
      const dt = Math.min(48, now - lastT) / 16.6667;
      lastT = now;

      drawGradient();

      ctx.globalCompositeOperation = "screen";
      for (let p of particles) {
        p.x += p.vx * 0.5;
        p.y += p.vy * 0.5;

        if (p.x < -p.r) p.x = width + p.r;
        if (p.x > width + p.r) p.x = -p.r;
        if (p.y < -p.r) p.y = height + p.r;
        if (p.y > height + p.r) p.y = -p.r;

        ctx.beginPath();
        ctx.fillStyle = `hsla(${p.hue} 70% 50% / ${p.alpha})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      drawVignette();

      raf = requestAnimationFrame(updateAndRender);
    }

    resize();
    raf = requestAnimationFrame((t) => {
      lastT = t;
      updateAndRender(t);
    });

    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="animated-bg-canvas" aria-hidden />;
}
