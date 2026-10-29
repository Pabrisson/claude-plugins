import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// the engine this dashboard ships in: only the build (dist/) goes into the plugin
const engine = resolve(
  import.meta.dirname,
  "../../../plugins/skill-video/skills/media-generator/engine"
)

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "./src") },
  },
  build: { outDir: resolve(engine, "studio/dist"), emptyOutDir: true },
  // npm run dev: open http://localhost:5173/ with `media.mjs studio` running
  server: {
    proxy: {
      "^/(api|files|__media-generator)": {
        target: "http://127.0.0.1:41287",
        changeOrigin: true,
      },
    },
  },
})
