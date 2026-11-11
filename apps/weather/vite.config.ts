import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    // three.js is most of the bundle and all of it is needed for the first frame.
    chunkSizeWarningLimit: 800,
    emptyOutDir: true,
    target: "es2022",
  },
});
