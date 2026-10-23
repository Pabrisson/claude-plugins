import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// the engine this studio ships in: only the build (dist/) goes into the plugin
const engine = resolve(
  import.meta.dirname,
  "../../../plugins/skill-video/skills/video-editor/engine"
)

export default defineConfig({
  // relative URLs: the studio is served under /<slug>/
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
      "@engine": resolve(engine, "lib"),
    },
  },
  build: { outDir: resolve(engine, "studio/dist"), emptyOutDir: true },
  // npm run dev: open http://localhost:5173/<slug>/ with `video.mjs studio` running
  server: {
    proxy: {
      "^/[a-z0-9-]+/(api|video|review)/": {
        target: "http://127.0.0.1:41187",
        changeOrigin: true,
      },
    },
  },
})
