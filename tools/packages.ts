/**
 * The lists of Worker packages, generated rather than kept in step by hand.
 *
 *   node tools/packages.ts            rewrite the generated enumerations
 *   node tools/packages.ts --check    fail when the checked-in files differ
 *
 * Two files hold them: the root `package.json` scripts that run every Worker,
 * and the kernel's `services` array of `GATEKEEPER_*` bindings. Everything else
 * in both files — keys, order, comments — is left exactly as it is.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PACKAGES = join(ROOT, "packages");
const PACKAGE_JSON = join(ROOT, "package.json");
const KERNEL_CONFIG = join(ROOT, "apps/kernel/wrangler.jsonc");
const KERNEL_PACKAGE = "apps/kernel";
const SHARED = "gatekeeper-shared";

/** Every Gatekeeper Worker package, by its topic name, in directory order. */
export function workerTopics(): string[] {
  return (
    readdirSync(PACKAGES, { withFileTypes: true })
      // A directory left behind by a deleted package (its ignored node_modules and .wrangler) is not a Worker: only a Wrangler config makes one.
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("gatekeeper-") && entry.name !== SHARED && existsSync(join(PACKAGES, entry.name, "wrangler.jsonc")))
      .map((entry) => entry.name.slice("gatekeeper-".length))
      .toSorted()
  );
}

/** The Wrangler config of one topic Worker, relative to the repository root. */
export function workerConfig(topic: string): string {
  return `packages/gatekeeper-${topic}/wrangler.jsonc`;
}

/** The scripts this generator owns; every other script in package.json is left alone. */
interface GeneratedScripts {
  dev: string;
  "deploy:gatekeepers": string;
  "deploy:dry-run": string;
  types: string;
  "types:check": string;
  typecheck: string;
}

function generatedScripts(topics: string[]): GeneratedScripts {
  const configs = topics.map(workerConfig);
  const all = [...configs, `${KERNEL_PACKAGE}/wrangler.jsonc`];
  const typesFile = (config: string) => config.replace("wrangler.jsonc", "worker-configuration.d.ts");
  return {
    dev: "pnpm build:site && node tools/dev.ts",
    "deploy:gatekeepers": configs.map((config) => `wrangler deploy --config ${config}`).join(" && "),
    "deploy:dry-run": ["pnpm build:site", ...all.map((config) => `wrangler deploy --dry-run --config ${config}`)].join(" && "),
    types: all.map((config) => `wrangler types ${typesFile(config)} --config ${config}`).join(" && "),
    "types:check": all.map((config) => `wrangler types ${typesFile(config)} --check --config ${config}`).join(" && "),
    typecheck: [...all.map((config) => `tsc -p ${config.replace("wrangler.jsonc", "tsconfig.json")}`), "tsc -p apps/site/tsconfig.json --noEmit"].join(" && "),
  };
}

/** The root `package.json` as it should be, with the generated scripts in their existing places. */
export function expectedPackageJson(topics: string[]): string {
  const text = readFileSync(PACKAGE_JSON, "utf8");
  const parsed: { scripts: Record<string, string> } = JSON.parse(text);
  const generated = generatedScripts(topics);
  for (const [name, value] of Object.entries(generated)) {
    if (!(name in parsed.scripts)) throw new Error(`package.json has no ${name} script to generate into`);
    parsed.scripts[name] = value;
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

const SERVICES_COMMENT = "  // One Worker per catalog topic; the kernel discovers them by binding prefix.\n";

function servicesBlock(topics: string[]): string {
  const entries = topics.map((topic) => `    { "binding": "GATEKEEPER_${topic.toUpperCase()}", "service": "open-data-pt-gatekeeper-${topic}" }`).join(",\n");
  return `${SERVICES_COMMENT}  "services": [\n${entries},\n  ],\n`;
}

/** The kernel's Wrangler config as it should be: only the `services` array and its comment are replaced. */
export function expectedKernelConfig(topics: string[]): string {
  const text = readFileSync(KERNEL_CONFIG, "utf8");
  const array = text.indexOf('  "services": [');
  if (array < 0) throw new Error("apps/kernel/wrangler.jsonc has no services array");
  const end = text.indexOf("  ],\n", array);
  if (end < 0) throw new Error("apps/kernel/wrangler.jsonc has an unterminated services array");
  // Take any `//` comment lines directly above the array with it, so the generator owns them too.
  let start = array;
  for (let above = text.lastIndexOf("\n", start - 2); above >= 0; above = text.lastIndexOf("\n", start - 2)) {
    const line = text.slice(above + 1, start);
    if (!line.trimStart().startsWith("//")) break;
    start = above + 1;
  }
  return text.slice(0, start) + servicesBlock(topics) + text.slice(end + "  ],\n".length);
}

interface GeneratedFile {
  path: string;
  label: string;
  expected: string;
}

export function generatedFiles(): GeneratedFile[] {
  const topics = workerTopics();
  return [
    { path: PACKAGE_JSON, label: "package.json", expected: expectedPackageJson(topics) },
    { path: KERNEL_CONFIG, label: "apps/kernel/wrangler.jsonc", expected: expectedKernelConfig(topics) },
  ];
}

function main(): void {
  const check = process.argv.includes("--check");
  const stale: string[] = [];
  for (const file of generatedFiles()) {
    if (readFileSync(file.path, "utf8") === file.expected) continue;
    stale.push(file.label);
    if (!check) writeFileSync(file.path, file.expected);
  }
  if (check && stale.length > 0) {
    process.stderr.write(`${stale.join(", ")} do not match tools/packages.ts; run \`pnpm packages:sync\`\n`);
    process.exit(1);
  }
  process.stdout.write(stale.length === 0 ? "Generated lists are up to date.\n" : `Rewrote ${stale.join(", ")}.\n`);
}

if (process.argv[1] === import.meta.filename) main();
