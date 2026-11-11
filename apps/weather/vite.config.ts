import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    // three.js is most of the bundle and all of it is needed for the first frame.
    chunkSizeWarningLimit: 900,
    emptyOutDir: true,
    // Two pages: the weather, and the sources at /credits/.
    rollupOptions: { input: { map: resolve(import.meta.dirname, "index.html"), credits: resolve(import.meta.dirname, "credits/index.html") } },
    target: "es2022",
  },
});
