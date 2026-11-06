import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// the engine this dashboard ships in: only the build (dist/) goes into the plugin
const engine = resolve(import.meta.dirname, "../../../plugins/skill-osint/skills/investigation/engine")

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src"), "@engine": resolve(engine, "lib") } },
  // one local bundle, served from this machine
  build: { outDir: resolve(engine, "dashboard/dist"), emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  // npm run dev: http://localhost:5173/ with `osint.mjs dashboard` running
  server: { proxy: { "/api/": { target: "http://127.0.0.1:41387", changeOrigin: true, configure: proxy => proxy.on("proxyReq", req => { if (req.getHeader("origin")) req.setHeader("origin", "http://127.0.0.1:41387") }) } } },
})
