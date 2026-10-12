import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { LocateFixed, ZoomIn, ZoomOut } from 'lucide-react';

const MIN = 0.15;
const MAX = 2.5;

/**
 * Drag to pan, wheel to zoom around the cursor. Children keep their layout size
 * (CSS transforms do not change it), so a map measured by width still fits the viewport at 100 %.
 */
export function PanZoom({ children }: { children: ReactNode }) {
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);

  /** Scale so the whole content is visible, centered */
  const fit = useCallback(() => {
    const box = viewport.current?.getBoundingClientRect();
    const inner = content.current;
    if (!box || !inner) return;
    const scale = Math.min(1, Math.max(MIN, Math.min(box.width / inner.offsetWidth, box.height / inner.offsetHeight)));
    setView({ scale, x: (box.width - inner.offsetWidth * scale) / 2, y: Math.max(0, (box.height - inner.offsetHeight * scale) / 2) });
  }, []);

  // Fit once the map has been laid out (it measures its width first)
  useEffect(() => {
    const timer = setTimeout(fit, 450);
    return () => clearTimeout(timer);
  }, [fit]);

  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const rect = viewport.current?.getBoundingClientRect();
    setView((current) => {
      const scale = Math.min(MAX, Math.max(MIN, current.scale * factor));
      const px = clientX !== undefined && rect ? clientX - rect.left : (rect?.width ?? 0) / 2;
      const py = clientY !== undefined && rect ? clientY - rect.top : (rect?.height ?? 0) / 2;
      // keep the point under the cursor in place
      const ratio = scale / current.scale;
      return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
    });
  };

  return (
    <div
      ref={viewport}
      className="relative h-full w-full cursor-grab touch-none overflow-clip active:cursor-grabbing"
      onWheel={(event) => zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { x: view.x, y: view.y, startX: event.clientX, startY: event.clientY, moved: false };
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state) return;
        const dx = event.clientX - state.startX;
        const dy = event.clientY - state.startY;
        if (!state.moved && Math.hypot(dx, dy) < 4) return;
        if (!state.moved) {
          state.moved = true;
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        }
        setView((current) => ({ ...current, x: state.x + dx, y: state.y + dy }));
      }}
      onPointerUp={() => {
        // a drag must not end in a click on a map node
        if (drag.current?.moved) {
          const swallow = (click: MouseEvent) => {
            click.stopPropagation();
            click.preventDefault();
          };
          window.addEventListener('click', swallow, { capture: true, once: true });
          setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
        }
        drag.current = null;
      }}
    >
      <div ref={content} className="w-fit" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}>{children}</div>

      <div className="absolute bottom-4 right-4 flex items-center gap-1 rounded-full border border-line/[0.12] bg-panel/90 p-1 shadow-xl backdrop-blur" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" aria-label="Verkleinern" onClick={() => zoomAt(1 / 1.25)} className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink"><ZoomOut className="size-4" /></button>
        <button type="button" onClick={() => setView({ x: 0, y: 0, scale: 1 })} className="h-8 min-w-14 rounded-full px-2 font-mono text-[11.5px] text-muted hover:bg-raised hover:text-ink" title="Auf 100 % zurücksetzen">
          {Math.round(view.scale * 100)} %
        </button>
        <button type="button" aria-label="Vergrößern" onClick={() => zoomAt(1.25)} className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink"><ZoomIn className="size-4" /></button>
        <button type="button" aria-label="Ganze Map einpassen" title="Ganze Map einpassen" onClick={fit} className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink"><LocateFixed className="size-4" /></button>
      </div>
    </div>
  );
}
