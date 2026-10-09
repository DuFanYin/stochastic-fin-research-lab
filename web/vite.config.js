import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

// Built into ../static, which the FastAPI server serves. base "./": every URL in the build is relative,
// so the workbench runs under any path prefix (dufanyin.dev/lab/). `npm run dev` proxies the API to a
// local server (PORT=8010 ./run.sh).
export default defineConfig({
  base: "./",
  plugins: [preact(), tailwindcss()],
  build: { outDir: "../static", emptyOutDir: true, assetsDir: "assets", chunkSizeWarningLimit: 300 },
  server: { proxy: { "/api": "http://127.0.0.1:8010" } },
});
