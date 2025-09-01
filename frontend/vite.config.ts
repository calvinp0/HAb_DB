import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const OVER_TUNNEL = !!process.env.TUNNEL; // set TUNNEL=1 when using localtunnel
const PUBLIC_HOST = process.env.PUBLIC_HOST || ""; // e.g. abc-123.localhost.run


// tip: in Vite, '/src' points to the project root's src folder
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": "/src" } },
  server: {
    host: true,
    port: 5173,
    strictPort: true,

    // 👇 allow your tunnel hostname(s)
    allowedHosts: [
      PUBLIC_HOST,          // exact host if you set env
      ".localhost.run",     // ssh reverse tunnel
      ".loca.lt",           // localtunnel (if you use it)
      ".trycloudflare.com", // cloudflare quick tunnel (if you use it)
      ".lhr.life"
    ],

    // 👇 HMR over HTTPS tunnel works better with wss + 443
    hmr: PUBLIC_HOST
      ? { host: PUBLIC_HOST, protocol: "wss", clientPort: 443 }
      : { protocol: "ws", clientPort: 5173 },

    // keep your API proxy
    proxy: { "/api": { target: "http://api:8000", changeOrigin: true } },
  },
});
