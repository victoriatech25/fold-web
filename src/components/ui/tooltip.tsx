"use client";

import { createPortal } from "react-dom";
import { useId, useRef, useState } from "react";

export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(72, Math.min(window.innerWidth - 72, rect.left + rect.width / 2)),
      top: rect.bottom + 7,
    });
  };

  return (
    <>
      <span ref={anchorRef} className="inline-flex" aria-describedby={position ? id : undefined} onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocus={show} onBlur={() => setPosition(null)}>
        {children}
      </span>
      {position ? createPortal(
        <span id={id} role="tooltip" style={{ left: position.left, top: position.top }} className="pointer-events-none fixed z-[9999] -translate-x-1/2 whitespace-nowrap rounded bg-slate-950 px-2 py-1 text-[11px] font-semibold text-white shadow-lg">
          <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-950" />
          <span className="relative">{label}</span>
        </span>,
        document.body,
      ) : null}
    </>
  );
}

