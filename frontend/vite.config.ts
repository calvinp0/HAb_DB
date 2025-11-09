// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const PUBLIC_HOST = process.env.PUBLIC_HOST || "";
const TUNNEL = process.env.TUNNEL === "1" || process.env.TUNNEL === "true";

const allowedHosts = [
  PUBLIC_HOST || undefined,
  ".localhost.run",
  ".loca.lt",
  ".trycloudflare.com",
  ".lhr.life",
].filter(Boolean) as string[];

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts,
    hmr: PUBLIC_HOST
      ? {
          host: PUBLIC_HOST,
          protocol: TUNNEL ? "wss" : "ws",
          clientPort: TUNNEL ? 443 : 5173,
        }
      : {
          protocol: "ws",
          clientPort: 5173,
        },
    proxy: {
      "/api": {
        target: "http://api:8000",
        changeOrigin: true,
      },
    },
  },
});
