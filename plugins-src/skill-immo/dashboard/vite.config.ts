import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// the engine this dashboard ships in: only the build (dist/) goes into the plugin
const engine = resolve(
  import.meta.dirname,
  "../../../plugins/skill-immo/skills/property-search/engine"
)

export default defineConfig({
  // relative URLs: the dashboard is served under /<slug>/
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "@engine": resolve(engine, "lib"),
    },
  },
  // one local bundle (MapLibre and Recharts weigh 2 MB): served from this machine, never split
  build: { outDir: resolve(engine, "dashboard/dist"), emptyOutDir: true, chunkSizeWarningLimit: 2500 },
  // npm run dev: open http://localhost:5173/<slug>/ with `immo.mjs dashboard` running
  server: {
    proxy: {
      "/api/": { target: "http://127.0.0.1:41287", changeOrigin: true },
    },
  },
})
