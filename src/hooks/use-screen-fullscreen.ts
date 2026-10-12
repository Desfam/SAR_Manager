import { useCallback, useEffect, useState } from 'react';

function setScreenFullscreen(value: boolean) {
  const desktop = window.sarDesktop;
  if (desktop?.window.setFullScreen) void desktop.window.setFullScreen(value);
  else if (value) void document.documentElement.requestFullscreen?.().catch(() => undefined);
  else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

/**
 * A fullscreen view that also puts the window (Electron) or the document (browser) into fullscreen.
 * F11 toggles; Esc leaves when `escapeLeaves` is set. Leaving fullscreen from outside closes the view.
 */
export function useScreenFullscreen({ escapeLeaves = true }: { escapeLeaves?: boolean } = {}) {
  const [fullscreen, setFullscreen] = useState(false);

  const set = useCallback((value: boolean) => {
    setFullscreen(value);
    setScreenFullscreen(value);
  }, []);
  const toggle = useCallback(() => setFullscreen((value) => {
    setScreenFullscreen(!value);
    return !value;
  }), []);

  useEffect(() => {
    const unsubscribe = window.sarDesktop?.window.onFullScreenChange?.((value) => {
      if (!value) setFullscreen(false);
    });
    const onDocument = () => {
      if (!document.fullscreenElement && !window.sarDesktop) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onDocument);
    return () => {
      unsubscribe?.();
      document.removeEventListener('fullscreenchange', onDocument);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F11') {
        event.preventDefault();
        toggle();
      } else if (event.key === 'Escape' && escapeLeaves) {
        setFullscreen((value) => {
          if (value) setScreenFullscreen(false);
          return false;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [escapeLeaves, toggle]);

  // Never leave the window stuck in fullscreen when navigating away
  useEffect(() => () => setScreenFullscreen(false), []);

  return { fullscreen, setFullscreen: set, toggle };
}
