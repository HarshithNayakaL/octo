import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronsRight, Check } from "lucide-react";

/** Slide-to-confirm for actions with outside effects. Keyboard: arrows, Home/End, Enter. */
export default function SlideConfirm({
  label,
  disabled = false,
  onConfirm,
}: {
  label: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef<number | undefined>(undefined);
  const [value, setValue] = useState(0);
  const [done, setDone] = useState(false);
  const knob = 44;
  const range = () => Math.max(1, (track.current?.clientWidth ?? 0) - knob - 8);
  const finish = (next: number) => {
    if (next >= 0.92 && !done) {
      setValue(1);
      setDone(true);
      onConfirm();
    } else if (!done) setValue(0);
  };
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || done) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = e.clientX - value * range();
  };
  const move = (e: PointerEvent<HTMLButtonElement>) => {
    if (start.current === undefined) return;
    setValue(Math.min(1, Math.max(0, (e.clientX - start.current) / range())));
  };
  const up = () => {
    if (start.current === undefined) return;
    start.current = undefined;
    finish(value);
  };
  const key = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || done) return;
    const steps: Record<string, number> = {
      ArrowRight: 0.25,
      ArrowUp: 0.25,
      ArrowLeft: -0.25,
      ArrowDown: -0.25,
    };
    if (e.key in steps) {
      e.preventDefault();
      const next = Math.min(1, Math.max(0, value + steps[e.key]));
      setValue(next);
      if (next === 1) finish(1);
    } else if (e.key === "End" || e.key === "Enter") {
      e.preventDefault();
      finish(1);
    } else if (e.key === "Home") setValue(0);
  };
  return (
    <div
      ref={track}
      className={`slide-confirm ${disabled ? "disabled" : ""} ${done ? "done" : ""}`}
      style={{ ["--slide" as string]: value }}
    >
      <span className="slide-confirm-fill" />
      <span className="slide-confirm-label">{done ? "Confirmed" : label}</span>
      <button
        type="button"
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        aria-disabled={disabled || done}
        disabled={disabled}
        className="slide-confirm-knob"
        style={{ transform: `translateX(${value * range()}px)` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        {done ? <Check size={18} /> : <ChevronsRight size={18} />}
      </button>
    </div>
  );
}
