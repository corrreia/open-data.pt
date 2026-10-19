import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { brandIcons } from "./icons";

/** Each publisher's mark lives in their folder in the Gatekeeper; the build puts it where the API says it is, `publishers/<key>.<ext>`. */
function publisherMarks(): Plugin {
  return {
    name: "publisher-marks",
    closeBundle() {
      const folders = resolve(import.meta.dirname, "../gatekeeper/src/publishers");
      const target = resolve(import.meta.dirname, "dist/publishers");
      mkdirSync(target, { recursive: true });
      for (const folder of readdirSync(folders, { withFileTypes: true })) {
        if (!folder.isDirectory()) continue;
        for (const extension of ["svg", "png"]) {
          const mark = resolve(folders, folder.name, `logo.${extension}`);
          if (existsSync(mark)) copyFileSync(mark, resolve(target, `${folder.name}.${extension}`));
        }
      }
    },
  };
}

/** Country flags for the analytics page, `flags/<ISO code>.svg`, fetched only for the countries it lists. */
function countryFlags(): Plugin {
  return {
    name: "country-flags",
    closeBundle() {
      const flags = resolve(import.meta.dirname, "node_modules/country-flag-icons/3x2");
      const target = resolve(import.meta.dirname, "dist/flags");
      mkdirSync(target, { recursive: true });
      for (const flag of readdirSync(flags)) copyFileSync(resolve(flags, flag), resolve(target, flag));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), brandIcons(), publisherMarks(), countryFlags()],
  build: {
    outDir: "dist",
    // ECharts is one lazy chunk that loads only on tabs that draw a chart.
    chunkSizeWarningLimit: 800,
    emptyOutDir: true,
    target: "es2022",
  },
});
