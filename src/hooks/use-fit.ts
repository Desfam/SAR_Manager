import { useLayoutEffect, useState, type RefObject } from 'react';

/** Padding of the page wrapper in App.tsx (pt-5 + pb-8) */
const PAGE_PADDING = 20 + 32;

/**
 * Height that fills the visible page area so a page can lay itself out without scrolling.
 * Returns null on small windows, where the page should fall back to normal scrolling.
 */
export function useFitHeight(ref: RefObject<HTMLElement>, minWidth = 1280, minHeight = 640) {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const main = ref.current?.closest('main');
    if (!main) return;
    const update = () => setHeight(window.innerWidth >= minWidth && main.clientHeight >= minHeight - PAGE_PADDING ? main.clientHeight - PAGE_PADDING : null);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(main);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [ref, minWidth, minHeight]);
  return height;
}

/** How many rows of the given height fit into an element (at least 1) */
export function useFitCount(ref: RefObject<HTMLElement>, rowHeight: number, fallback = 8) {
  const [count, setCount] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setCount(Math.max(1, Math.floor(entry.contentRect.height / rowHeight))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rowHeight]);
  return count;
}
