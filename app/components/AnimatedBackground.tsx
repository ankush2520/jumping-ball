"use client";

import React, { useEffect, useRef } from "react";

export default function AnimatedBackground(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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
      life: number;
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
      const area = width * height;
      const density = Math.max(28, Math.min(160, Math.round(area / 14000)));
      particles = new Array(density).fill(0).map(() => {
        const speed = 0.08 + Math.random() * 0.6; // base speed
        const angle = Math.random() * Math.PI * 2;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed * 0.6,
          r: 1 + Math.random() * 8,
          hue: 230 - Math.random() * 60, // blue -> purple
          alpha: 0.06 + Math.random() * 0.28,
          life: 0,
        } as Particle;
      });
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

    function drawFog(t: number) {
      // subtle moving fog using large soft circles
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const fogAlpha = 0.06;
      for (let i = 0; i < 3; i++) {
        const sx = (Math.sin(t * 0.00012 + i) * 0.5 + 0.5) * width;
        const sy = (Math.cos(t * 0.00009 + i * 1.3) * 0.5 + 0.5) * height;
        const rad = Math.max(width, height) * (0.45 + i * 0.12);
        const fg = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad);
        fg.addColorStop(0, `rgba(90,60,140,${fogAlpha})`);
        fg.addColorStop(0.4, `rgba(30,20,60,${fogAlpha * 0.9})`);
        fg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }

    function updateAndRender(t: number) {
      const now = t;
      const dt = Math.min(48, now - lastT) / 16.6667; // normalize to ~60fps
      lastT = now;

      // cinematic gradient base
      drawGradient();

      // subtle moving fog
      drawFog(t);

      // particles glow
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let p of particles) {
        p.x += p.vx * dt * (0.6 + Math.sin(t * 0.0005 + p.r) * 0.4);
        p.y += p.vy * dt * (0.6 + Math.cos(t * 0.0003 + p.r) * 0.4);
        p.life += dt * 0.02;

        // wrap edges
        if (p.x < -p.r) p.x = width + p.r;
        if (p.x > width + p.r) p.x = -p.r;
        if (p.y < -p.r) p.y = height + p.r;
        if (p.y > height + p.r) p.y = -p.r;

        ctx.beginPath();
        const col = `hsla(${p.hue} 70% 60% / ${p.alpha})`;
        ctx.fillStyle = col;
        ctx.shadowBlur = p.r * 8;
        ctx.shadowColor = `hsla(${p.hue} 80% 60% / ${Math.min(0.9, p.alpha + 0.2)})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // soft vignette to add cinematic depth
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
