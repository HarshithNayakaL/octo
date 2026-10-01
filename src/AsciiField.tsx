import { useEffect, useRef } from "react";

const ramp = " .·:-=+*#%";

/** A quiet ASCII scan used while research is in progress. Decorative only. */
export default function AsciiField({ className = "" }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const node = canvas.current;
    const context = node?.getContext("2d");
    if (!node || !context) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cell = 11;
    let frame = 0;
    let raf = 0;
    let width = 0;
    let height = 0;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      width = node.clientWidth;
      height = node.clientHeight;
      node.width = width * ratio;
      node.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.font = `500 10px ui-monospace, "SFMono-Regular", Menlo, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
    };
    const draw = (t: number) => {
      context.clearRect(0, 0, width, height);
      const cols = Math.ceil(width / cell);
      const rows = Math.ceil(height / cell);
      const scan = ((t / 2600) % 1.4) - 0.2;
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const u = x / cols;
          const v = y / rows;
          const wave =
            Math.sin(u * 9 + t / 900) * 0.5 +
            Math.sin(v * 7 - t / 1300 + u * 3) * 0.5;
          const beam = Math.max(0, 1 - Math.abs(u - scan) * 7);
          const edge = Math.min(u, 1 - u, v, 1 - v) * 4;
          const level = Math.min(
            1,
            Math.max(0, (wave * 0.32 + 0.3 + beam * 0.55) * Math.min(1, edge)),
          );
          const glyph = ramp[Math.floor(level * (ramp.length - 1))];
          if (glyph === " ") continue;
          context.fillStyle = `rgba(0, 47, 167, ${0.08 + level * 0.32})`;
          context.fillText(glyph, x * cell + cell / 2, y * cell + cell / 2);
        }
    };
    const loop = (t: number) => {
      if (frame++ % 3 === 0) draw(t);
      raf = requestAnimationFrame(loop);
    };
    resize();
    const observer = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    observer.observe(node);
    if (still) draw(0);
    else raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);
  return (
    <canvas
      ref={canvas}
      className={`ascii-field ${className}`}
      aria-hidden="true"
    />
  );
}
