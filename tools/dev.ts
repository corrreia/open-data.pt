/**
 * Run the kernel and the Gatekeeper locally.
 *
 *   pnpm dev                      a catalog worth looking at: the libraries below
 *   pnpm dev ckan                 the CKAN library alone
 *   pnpm dev ckan gtfs            those two
 *   pnpm dev all                  every library, all 283 feeds — polls every source we read
 *   pnpm dev ckan --port 3000     anything else on the line goes to Wrangler
 *
 * Each Worker gets its own `wrangler dev`, which is what lets the Gatekeeper's
 * session carry `--var GATEKEEPER_LIBRARIES`; they find each other over the
 * service binding across commands, as Wrangler's multi-Worker guide describes
 * (https://developers.cloudflare.com/workers/local-development/multi-workers/).
 * One command with two `--config` flags cannot do it: the first config is the
 * primary Worker and command-line flags reach only that one, so the selection
 * never arrived and every library was carried and every source polled.
 *
 * `.dev.vars` cannot carry it either: the Gatekeeper declares
 * `secrets.required`, and Wrangler then loads only those keys from that file
 * (https://developers.cloudflare.com/workers/wrangler/configuration/#secrets-configuration-property).
 * That file is for the secrets a source needs, and this tool never writes it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const KERNEL_CONFIG = "apps/kernel/wrangler.jsonc";
const GATEKEEPER_CONFIG = "packages/gatekeeper/wrangler.jsonc";
const KERNEL_PORT = "8787";
/** The Gatekeeper answers RPC only, but its own session still needs a port of its own. */
const GATEKEEPER_PORT = "8788";
/** And its own inspector port: two sessions both taking Wrangler's default 9229 kill each other. */
const GATEKEEPER_INSPECTOR_PORT = "9230";

/**
 * What `pnpm dev` carries when nothing is named: five publishers, five sets of
 * terms, four topics, and every kind of product — reference tables, current
 * state, an event log, time series and a summary — from sources whose answers
 * are small. Enough for the catalog, the publisher and licence pages, a map and
 * a chart to all have something real in them, without installing the other 250
 * feeds and reading every source in the country to look at a page.
 */
const DEFAULT_LIBRARIES = ["ipma", "dgeg", "omie", "carris", "usgs"];

/**
 * No local feed runs more often than this. Carris positions are a minute apart
 * in production, which is right there and rude from a laptop left open; half an
 * hour still shows the site collecting, and the freshness window moves with it
 * so nothing reads as late. `DEV_MIN_CADENCE_SECONDS=60 pnpm dev` restores the
 * real cadences when that is what you are working on.
 */
const DEFAULT_CADENCE_FLOOR = "1800";

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

/** What the command line asked for: the libraries to carry, and the flags Wrangler is handed. */
interface Selection {
  only: string[];
  passthrough: string[];
}

/** Library names and Wrangler flags, in any order; pnpm passes its own `--` separator through. */
function parse(argv: string[]): Selection {
  const flagAt = argv.findIndex((argument) => argument.startsWith("-") && argument !== "--");
  const names = (flagAt === -1 ? argv : argv.slice(0, flagAt)).filter((argument) => argument !== "--");
  const passthrough = flagAt === -1 ? [] : argv.slice(flagAt);
  if (names.includes("all")) return { only: [], passthrough };
  if (names.length === 0) return { only: DEFAULT_LIBRARIES, passthrough };
  const known = libraries();
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    process.stderr.write(`Unknown library: ${unknown.join(", ")}. Known: ${known.join(", ")}, or "all".\n`);
    process.exit(1);
  }
  return { only: [...new Set(names)], passthrough };
}

/** This machine's address on the network, for the phone or the other laptop. */
function lanAddress(): string | undefined {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .find((address) => address.family === "IPv4" && !address.internal)?.address;
}

/** A running Wrangler session, and the way to end it. */
interface Session {
  stop: () => void;
}

/**
 * One Wrangler session, restarted when it falls over: its dev proxy dies on its
 * own every so often, and a session that ends takes the site down with it.
 */
function supervise(name: string, args: string[], onGone: () => void): Session {
  let child: ChildProcess | undefined;
  let stopped = false;
  const run = () => {
    child = spawn(wranglerBinary(), args, { stdio: "inherit", shell: false, cwd: ROOT });
    child.on("error", (error) => {
      process.stderr.write(`could not start wrangler for the ${name}: ${error.message}\n`);
      onGone();
    });
    child.on("exit", () => {
      if (stopped) return;
      process.stdout.write(`the ${name} session ended; starting it again\n`);
      setTimeout(run, 2000);
    });
  };
  run();
  return {
    stop: () => {
      stopped = true;
      if (child && child.exitCode === null) child.kill("SIGTERM");
    },
  };
}

function main(): void {
  const { only, passthrough } = parse(process.argv.slice(2));
  const floor = process.env.DEV_MIN_CADENCE_SECONDS ?? DEFAULT_CADENCE_FLOOR;
  const lan = lanAddress();
  process.stdout.write(
    [
      `kernel + gatekeeper, carrying ${only.length === 0 ? "every library" : only.join(", ")}`,
      `no feed collected more often than every ${Math.round(Number(floor) / 60)} min`,
      `http://localhost:${KERNEL_PORT}${lan ? ` and http://${lan}:${KERNEL_PORT}` : ""}`,
      "",
    ].join("\n"),
  );

  const gatekeeper = supervise(
    "gatekeeper",
    ["dev", "--config", GATEKEEPER_CONFIG, "--port", GATEKEEPER_PORT, "--inspector-port", GATEKEEPER_INSPECTOR_PORT, "--var", `GATEKEEPER_LIBRARIES:${only.join(",")}`],
    () => stop(1),
  );
  const kernel = supervise(
    "kernel",
    ["dev", "--config", KERNEL_CONFIG, "--ip", "0.0.0.0", "--port", KERNEL_PORT, "--var", `DEV_MIN_CADENCE_SECONDS:${floor}`, ...passthrough],
    () => stop(1),
  );

  let stopping = false;
  function stop(code: number) {
    if (stopping) return;
    stopping = true;
    gatekeeper.stop();
    kernel.stop();
    process.exit(code);
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => stop(0));
}

main();
