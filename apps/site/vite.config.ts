import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** One HTML entry per page; the kernel serves `dist` as its static assets, so every URL stays what it was. */
const ALL_PAGES = ["index", "catalog", "publisher", "licence", "product", "status", "analytics", "start", "operations", "contribute"];
/** SITE_PAGES=index,catalog builds a subset while pages are being worked on. */
const PAGES = process.env.SITE_PAGES ? ALL_PAGES.filter((page) => process.env.SITE_PAGES?.split(",").includes(page)) : ALL_PAGES;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    // ECharts is one lazy chunk that loads only on tabs that draw a chart.
    chunkSizeWarningLimit: 800,
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: Object.fromEntries(PAGES.map((page) => [page, resolve(import.meta.dirname, page === "index" ? "index.html" : `${page}/index.html`)])),
    },
  },
});
