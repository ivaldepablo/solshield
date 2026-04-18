/* Matrix-style falling glyph background — subtle, performant */
const MatrixBg = ({ enabled = true }) => {
  const canvasRef = React.useRef(null);

  React.useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf, cols, drops, w, h;
    const chars = '0123456789ABCDEF$SOLABCDEFabcdef{}[]()<>:;.+-*/\\|';
    const fontSize = 13;

    const resize = () => {
      w = canvas.width = window.innerWidth * devicePixelRatio;
      h = canvas.height = window.innerHeight * devicePixelRatio;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      cols = Math.floor(w / (fontSize * devicePixelRatio));
      drops = new Array(cols).fill(0).map(() => Math.random() * -100);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      ctx.fillStyle = 'rgba(7,9,10,0.08)';
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${fontSize * devicePixelRatio}px "JetBrains Mono", monospace`;
      for (let i = 0; i < cols; i++) {
        const ch = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize * devicePixelRatio;
        const y = drops[i] * fontSize * devicePixelRatio;

        // leading char bright, trail dim
        if (Math.random() > 0.98) {
          ctx.fillStyle = 'rgba(0,255,102,0.9)';
        } else {
          ctx.fillStyle = 'rgba(0,180,70,0.35)';
        }
        ctx.fillText(ch, x, y);

        if (y > h && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [enabled]);

  if (!enabled) return null;
  return <canvas ref={canvasRef} className="matrix-bg" />;
};

window.MatrixBg = MatrixBg;
