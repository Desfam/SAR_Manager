export interface SarDesktopBridge {
  isDesktop: true;
  backendPort: number;
  platform: string;
  window: {
    minimize: () => void;
    toggleMaximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
    setFullScreen: (value: boolean) => Promise<boolean>;
    onFullScreenChange: (callback: (fullScreen: boolean) => void) => () => void;
  };
  backendStatus: () => Promise<{ ok: boolean; owned: boolean; port: number; starting?: boolean; error?: string }>;
  /** older builds of the desktop shell don't have it */
  onNavigate?: (callback: (path: string) => void) => () => void;
}

declare global {
  interface Window {
    /** Present only inside the Electron app (see electron/preload.cjs). */
    sarDesktop?: SarDesktopBridge;
  }
}
