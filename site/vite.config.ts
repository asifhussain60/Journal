import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The Cloudflare Worker (worker/index.ts) serves the built dist/ and handles
// /api/*. In local dev, Vite serves the SPA and proxies /api/* to `wrangler dev`
// (default port 8787) so same-origin + credentials behaviour matches production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
      "/health": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
