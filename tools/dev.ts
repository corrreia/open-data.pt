/**
 * Run the kernel locally with only the Gatekeepers you are working on.
 *
 *   pnpm dev                      the kernel and every Gatekeeper Worker
 *   pnpm dev -- ckan              the kernel and the CKAN Worker
 *   pnpm dev -- ckan gtfs         the kernel and those two
 *
 * A Gatekeeper the kernel is bound to but that is not running is not an error:
 * the Registry's example sync logs `gatekeeper_unavailable` for it and carries
 * on with the ones that answered, and it keeps the feeds of the missing one
 * rather than retiring them. So a single-Worker session installs that Worker's
 * example feeds and leaves every other feed alone.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { workerConfig, workerPackages } from "./packages.ts";

const KERNEL_CONFIG = "apps/kernel/wrangler.jsonc";
const ROOT = new URL("..", import.meta.url).pathname;

/** The workspace's own Wrangler, so `node tools/dev.ts` works outside `pnpm run`. */
function wranglerBinary(): string {
  const local = join(ROOT, "node_modules/.bin/wrangler");
  return existsSync(local) ? local : "wrangler";
}

function selected(names: string[]): string[] {
  const workers = workerPackages();
  if (names.length === 0) return workers;
  const unknown = names.filter((name) => !workers.includes(name));
  if (unknown.length > 0) {
    process.stderr.write(`Unknown Gatekeeper: ${unknown.join(", ")}. Known: ${workers.join(", ")}\n`);
    process.exit(1);
  }
  return [...new Set(names)];
}

function main(): void {
  const workers = selected(process.argv.slice(2));
  const args = ["dev", "--config", KERNEL_CONFIG];
  for (const worker of workers) args.push("--config", workerConfig(worker));
  process.stdout.write(`wrangler dev: kernel + ${workers.join(", ")}\n`);
  const child = spawn(wranglerBinary(), args, { stdio: "inherit", shell: false, cwd: ROOT });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
  child.on("error", (error) => {
    process.stderr.write(`could not start wrangler: ${error.message}\n`);
    process.exit(1);
  });
}

main();
