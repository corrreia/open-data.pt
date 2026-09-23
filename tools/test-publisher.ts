/**
 * Run one publisher's tests.
 *
 *   pnpm test:publisher apa            the tests in APA's folder, and the Gatekeeper-wide checks every feed is held to
 *   pnpm test:publisher apa --live     the same, then every APA feed against the real source
 *
 * A publisher's folder holds the tests of their own library, when they have one. The Gatekeeper-wide
 * checks run too — every feed's identity, the folder rules, the catalog's consistency — so a publisher
 * read entirely through a shared format, with no tests of its own, is still checked.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [publisher, ...rest] = process.argv.slice(2).filter((argument) => argument !== "--");
const live = rest.includes("--live");

if (!publisher || !existsSync(join(ROOT, "apps/gatekeeper/src/publishers", publisher, "index.ts"))) {
  console.error("Usage: pnpm test:publisher <publisher key> [--live]; the key is a folder under apps/gatekeeper/src/publishers/.");
  process.exit(1);
}

function vitest(paths: string[], env: NodeJS.ProcessEnv = {}): number {
  const result = spawnSync(join(ROOT, "node_modules/.bin/vitest"), ["run", "--passWithNoTests", ...paths], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  return result.status ?? 1;
}

const status = vitest([`apps/gatekeeper/src/publishers/${publisher}/`, "apps/gatekeeper/tests/"]);
if (status !== 0 || !live) process.exit(status);
process.exit(vitest(["tests/live-examples.test.ts"], { LIVE_EXAMPLES: publisher }));
