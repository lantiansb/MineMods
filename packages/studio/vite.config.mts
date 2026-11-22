import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import { fileURLToPath } from "node:url"

export default defineConfig({
  root: fileURLToPath(new URL("./src/renderer", import.meta.url)),
  base: "./",
  plugins: [solid()],
  build: {
    outDir: fileURLToPath(new URL("./dist/renderer", import.meta.url)),
    emptyOutDir: true,
    // The second page is the one "looking" draws in: a window that is never shown (see src/main/look-window.ts).
    rollupOptions: { input: { index: fileURLToPath(new URL("./src/renderer/index.html", import.meta.url)), look: fileURLToPath(new URL("./src/renderer/look.html", import.meta.url)) } },
  },
})
