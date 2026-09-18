/**
 * Run the kernel and the Gatekeeper locally, carrying only the libraries you
 * are working on.
 *
 *   pnpm dev                      every library
 *   pnpm dev -- ckan              the CKAN library alone
 *   pnpm dev -- ckan gtfs         those two
 *
 * The selection is written to `packages/gatekeeper/.dev.vars` as
 * GATEKEEPER_LIBRARIES, which the Worker reads; the Registry installs the
 * examples of the carried libraries and retires the rest of a local state.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const KERNEL_CONFIG = "apps/kernel/wrangler.jsonc";
const GATEKEEPER_CONFIG = "packages/gatekeeper/wrangler.jsonc";
const DEV_VARS = join(ROOT, "packages/gatekeeper/.dev.vars");

/** The workspace's own Wrangler, so `node tools/dev.ts` works outside `pnpm run`. */
function wranglerBinary(): string {
  const local = join(ROOT, "node_modules/.bin/wrangler");
  return existsSync(local) ? local : "wrangler";
}

/** Every library directory, held or not; the Worker carries only the listed ones, so a held name selects nothing. */
function libraries(): string[] {
  const shared = join(ROOT, "packages/gatekeeper-shared/src");
  return ["formats", "sources"].flatMap((group) => readdirSync(join(shared, group))).toSorted();
}

function selected(names: string[]): string[] {
  const known = libraries();
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    process.stderr.write(`Unknown library: ${unknown.join(", ")}. Known: ${known.join(", ")}\n`);
    process.exit(1);
  }
  return [...new Set(names)];
}

function main(): void {
  const only = selected(process.argv.slice(2));
  writeFileSync(DEV_VARS, `GATEKEEPER_LIBRARIES=${only.join(",")}\n`);
  process.stdout.write(`wrangler dev: kernel + gatekeeper carrying ${only.length === 0 ? "every library" : only.join(", ")}\n`);
  const child = spawn(wranglerBinary(), ["dev", "--config", KERNEL_CONFIG, "--config", GATEKEEPER_CONFIG], { stdio: "inherit", shell: false, cwd: ROOT });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
  child.on("error", (error) => {
    process.stderr.write(`could not start wrangler: ${error.message}\n`);
    process.exit(1);
  });
}

main();
