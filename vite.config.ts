import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Backend for the dev proxy; SAR_BACKEND_PORT allows a second backend (e.g. with a test database)
const backendPort = process.env.SAR_BACKEND_PORT || "3001";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    // Same-origin API in development: works from localhost, 127.0.0.1 or the LAN IP without CORS
    proxy: {
      "/api": `http://localhost:${backendPort}`,
      "/health": `http://localhost:${backendPort}`,
      "/terminal": { target: `ws://localhost:${backendPort}`, ws: true },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // One React instance for every library (motion, cmdk, react-query)
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["motion/react", "cmdk"],
  },
}));
