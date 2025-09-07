// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const OVER_TUNNEL = !!process.env.TUNNEL;
const PUBLIC_HOST = process.env.PUBLIC_HOST || "";

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: { "@": "/src" },
    dedupe: ["react", "react-dom"], // <-- keep this
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: [
      PUBLIC_HOST,
      ".localhost.run",
      ".loca.lt",
      ".trycloudflare.com",
      ".lhr.life",
    ],
    hmr: PUBLIC_HOST
      ? { host: PUBLIC_HOST, protocol: "wss", clientPort: 443 }
      : { protocol: "ws", clientPort: 5173 },
    proxy: { "/api": { target: "http://api:8000", changeOrigin: true } },
  },
});
