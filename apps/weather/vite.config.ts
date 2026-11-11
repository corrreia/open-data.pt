import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    // three.js is most of the bundle and all of it is needed for the first frame.
    chunkSizeWarningLimit: 800,
    emptyOutDir: true,
    // Two pages: the map, and the credits at /credits/.
    rollupOptions: { input: { map: resolve(import.meta.dirname, "index.html"), credits: resolve(import.meta.dirname, "credits/index.html") } },
    target: "es2022",
  },
});
