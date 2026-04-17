'use client';

import { useEffect, useRef } from 'react';

const CHARS =
  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF@#$%&*()[]{}<>+-=_|/\\?!';
const FONT_SIZE = 14;
const TRAIL_ALPHA = 0.055;

export function MatrixRain({ opacity = 0.18 }: { opacity?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let columns = 0;
    let drops: number[] = [];
    let speeds: number[] = [];
    let dpr = 1;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.scale(dpr, dpr);
      columns = Math.floor(w / FONT_SIZE);
      drops = new Array(columns).fill(0).map(() => Math.random() * -50);
      speeds = new Array(columns).fill(0).map(() => 0.5 + Math.random() * 0.8);
      ctx.fillStyle = '#0a0a0f';
      ctx.fillRect(0, 0, w, h);
    };

    const draw = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.fillStyle = `rgba(10, 10, 15, ${TRAIL_ALPHA})`;
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${FONT_SIZE}px ui-monospace, "JetBrains Mono", monospace`;

      for (let i = 0; i < drops.length; i++) {
        const ch = CHARS.charAt(Math.floor(Math.random() * CHARS.length));
        const y = drops[i]! * FONT_SIZE;
        ctx.fillStyle = y < 30 ? 'rgba(220, 255, 220, 0.95)' : 'rgba(0, 255, 65, 0.55)';
        ctx.fillText(ch, i * FONT_SIZE, y);
        if (y > h && Math.random() > 0.97) drops[i] = 0;
        drops[i]! += speeds[i]!;
      }
      rafId = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    draw();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ opacity, zIndex: 0 }}
      aria-hidden
    />
  );
}
