/**
 * The Gatekeeper Workers and the lists that name them, generated rather than kept in step by hand.
 *
 *   node tools/packages.ts            rewrite every generated file
 *   node tools/packages.ts --check    fail when a checked-in file differs
 *
 * A Worker is one library: how the data is read, never what it is about. From
 * every library's deployment declaration (`worker.ts`) and its examples, this
 * writes that library's `src/index.ts`, `wrangler.jsonc`, `package.json` and
 * `tsconfig.json`: its vars, secrets, buckets and CPU limit. A library under a
 * publication hold gets no Worker until the hold is lifted. It also rewrites
 * the root `package.json` scripts that run every Worker and the kernel's
 * `GATEKEEPER_*` service bindings, leaving the rest of both files as they are.
 * Output goes through Oxfmt, so generated files are formatted files.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ExampleFeed, LibraryDeployment } from "../packages/gatekeeper-shared/src/index.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const PACKAGES = join(ROOT, "packages");
const PACKAGE_JSON = join(ROOT, "package.json");
const KERNEL_CONFIG = join(ROOT, "apps/kernel/wrangler.jsonc");
const KERNEL_PACKAGE = "apps/kernel";
const SHARED = "gatekeeper-shared";
const SHARED_SOURCE = join(PACKAGES, SHARED, "src");
const HOLDS = join(SHARED_SOURCE, "publication-holds.json");
const COMPATIBILITY_DATE = "2026-09-09";

/** Every Gatekeeper Worker package, by the library it carries, in directory order. */
export function workerPackages(): string[] {
  return (
    readdirSync(PACKAGES, { withFileTypes: true })
      // A directory left behind by a deleted package (its ignored node_modules and .wrangler) is not a Worker: only a Wrangler config makes one.
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("gatekeeper-") && entry.name !== SHARED && existsSync(join(PACKAGES, entry.name, "wrangler.jsonc")))
      .map((entry) => entry.name.slice("gatekeeper-".length))
      .toSorted()
  );
}

/** The Wrangler config of one library's Worker, relative to the repository root. */
export function workerConfig(library: string): string {
  return `packages/gatekeeper-${library}/wrangler.jsonc`;
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

function generatedScripts(libraries: string[]): GeneratedScripts {
  const configs = libraries.map(workerConfig);
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
export function expectedPackageJson(libraries: string[]): string {
  const text = readFileSync(PACKAGE_JSON, "utf8");
  const parsed: { scripts: Record<string, string> } = JSON.parse(text);
  const generated = generatedScripts(libraries);
  for (const [name, value] of Object.entries(generated)) {
    if (!(name in parsed.scripts)) throw new Error(`package.json has no ${name} script to generate into`);
    parsed.scripts[name] = value;
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

const SERVICES_COMMENT = "  // One Worker per Gatekeeper library; the kernel discovers them by binding prefix.\n";

function servicesBlock(libraries: string[]): string {
  const entries = libraries.map((library) => `    { "binding": "GATEKEEPER_${library.toUpperCase()}", "service": "open-data-pt-gatekeeper-${library}" }`).join(",\n");
  return `${SERVICES_COMMENT}  "services": [\n${entries},\n  ],\n`;
}

/** The kernel's Wrangler config as it should be: only the `services` array and its comment are replaced. */
export function expectedKernelConfig(libraries: string[]): string {
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
  return text.slice(0, start) + servicesBlock(libraries) + text.slice(end + "  ],\n".length);
}

/** One library as the generator reads it: where it lives, what it declares, and its examples. */
export interface Library {
  source: string;
  /** `formats` or `sources`. */
  group: string;
  deploymentExport: string;
  deployment: LibraryDeployment<never>;
  examplesExport: string;
  examples: readonly ExampleFeed[];
  held: boolean;
}

/** One Worker: the library it carries and the examples it installs. */
export interface WorkerPlan {
  /** The library's name, which is the Worker's name and its `gatekeeperKind`. */
  name: string;
  library: Library;
}

/** Lets plain Node load the shared package's TypeScript, whose imports name no extension. */
function registerTypeScriptResolution(): void {
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.(?:[cm]?[jt]s|json)$/.test(specifier)) {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        for (const candidate of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
      }
      return next(specifier, context);
    },
  });
}

function heldSources(): Set<string> {
  const rows: Array<{ source: string }> = JSON.parse(readFileSync(HOLDS, "utf8"));
  return new Set(rows.map((row) => row.source));
}

/**
 * A library barrel as the generator reads it. `tests/examples-consistency.test.ts`
 * holds every library to exporting one `*_DEPLOYMENT` and one `*_EXAMPLES` array.
 */
interface LibraryModule {
  readonly [name: string]: LibraryDeployment<never> | readonly ExampleFeed[];
}

/** Every library under `formats/` and `sources/`, with its deployment declaration and examples. */
export async function loadLibraries(): Promise<Library[]> {
  const held = heldSources();
  const libraries: Library[] = [];
  for (const group of ["formats", "sources"]) {
    for (const source of readdirSync(join(SHARED_SOURCE, group)).toSorted()) {
      // SAFETY: a library barrel is a module namespace; only its `*_DEPLOYMENT` and `*_EXAMPLES` exports are read, by name.
      const module = (await import(join(SHARED_SOURCE, group, source, "index.ts"))) as LibraryModule;
      const names = Object.keys(module);
      const deploymentExport = names.find((name) => name.endsWith("_DEPLOYMENT"));
      const examplesExport = names.find((name) => name.endsWith("_EXAMPLES"));
      if (!deploymentExport || !examplesExport) throw new Error(`${group}/${source} must export a *_DEPLOYMENT and a *_EXAMPLES array`);
      // SAFETY: selected by the export-name contract above.
      const deployment = module[deploymentExport] as LibraryDeployment<never>;
      // SAFETY: selected by the export-name contract above.
      const examples = module[examplesExport] as readonly ExampleFeed[];
      if (deployment.source !== source) throw new Error(`${group}/${source} declares source ${deployment.source}`);
      libraries.push({ source, group, deploymentExport, deployment, examplesExport, examples, held: held.has(source) });
    }
  }
  return libraries;
}

/**
 * One Worker per library that has examples and no publication hold. Topics are
 * catalog tags: every one a feed carries must be in `TOPICS`, and none of them
 * decides where the feed runs.
 */
export async function planWorkers(libraries: Library[]): Promise<WorkerPlan[]> {
  const { TOPICS } = await import(join(SHARED_SOURCE, "topics.ts"));
  for (const library of libraries) {
    for (const example of library.examples) {
      const unknown = (example.topics ?? []).filter((topic) => !Object.hasOwn(TOPICS, topic));
      if (unknown.length > 0) throw new Error(`${example.slug}: ${unknown.join(", ")} is not one of ${Object.keys(TOPICS).join(", ")}`);
    }
  }
  return libraries
    .filter((library) => !library.held && library.examples.length > 0)
    .map((library) => ({ name: library.source, library }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function format(path: string, text: string): string {
  const result = spawnSync(join(ROOT, "node_modules/.bin/oxfmt"), ["--stdin-filepath", path], { cwd: ROOT, input: text, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`oxfmt could not format ${path}: ${result.stderr}`);
  return result.stdout;
}

function workerIndex(plan: WorkerPlan): string {
  const library = plan.library;
  return [
    `// Generated by \`pnpm packages:sync\` from the ${library.source} library and its examples; do not edit.`,
    `import { libraryGatekeeper } from "@open-data-pt/gatekeeper-shared/library-worker";`,
    `import { ${library.deploymentExport}, ${library.examplesExport} } from "@open-data-pt/gatekeeper-shared/${library.group}/${library.source}";`,
    "",
    `export default libraryGatekeeper<Env>(${library.deploymentExport}, ${library.examplesExport});`,
    "",
  ].join("\n");
}

function workerConfigText(plan: WorkerPlan): string {
  const deployment = plan.library.deployment;
  const secrets = deployment.secrets ?? [];
  const buckets = deployment.r2Buckets ?? [];
  const cpu = deployment.cpuMs ?? 0;
  const lines = [
    `// Generated by \`pnpm packages:sync\` from the deployment declaration (worker.ts) of the ${plan.name} library; do not edit.`,
    "{",
    `  "$schema": "../../node_modules/wrangler/config-schema.json",`,
    `  "name": "open-data-pt-gatekeeper-${plan.name}",`,
    `  "main": "src/index.ts",`,
    `  "compatibility_date": "${COMPATIBILITY_DATE}",`,
    `  "compatibility_flags": ["nodejs_compat"],`,
    `  "workers_dev": false,`,
    `  "preview_urls": false,`,
    `  "vars": ${JSON.stringify(deployment.vars)},`,
    ...(secrets.length > 0 ? [`  // Secrets (wrangler secret put): ${secrets.join(", ")}.`] : []),
    ...(buckets.length > 0 ? [`  "r2_buckets": ${JSON.stringify(buckets.map((bucket) => ({ binding: bucket.binding, bucket_name: bucket.bucketName })))},`] : []),
    ...(cpu > 0 ? [`  "limits": { "cpu_ms": ${cpu} },`] : []),
    `  "observability": {`,
    `    "enabled": true,`,
    `    // The kernel records every acquisition's outcome; a tenth of invocations is enough to debug.`,
    `    "head_sampling_rate": 0.1,`,
    `  },`,
    "}",
    "",
  ];
  return lines.join("\n");
}

function workerPackageJson(library: string): string {
  return `${JSON.stringify({ name: `@open-data-pt/gatekeeper-${library}`, version: "0.1.0", private: true, type: "module", dependencies: { "@open-data-pt/gatekeeper-shared": "workspace:*" } }, null, 2)}\n`;
}

function workerTsconfig(): string {
  return `${JSON.stringify({ extends: "../../tsconfig.json", compilerOptions: { types: ["./worker-configuration.d.ts"] }, include: ["src/**/*.ts", "../gatekeeper-shared/src/**/*.ts", "worker-configuration.d.ts"] }, null, 2)}\n`;
}

interface GeneratedFile {
  path: string;
  label: string;
  expected: string;
}

export async function generatedFiles(): Promise<GeneratedFile[]> {
  const plans = await planWorkers(await loadLibraries());
  const libraries = plans.map((plan) => plan.name);
  const files: GeneratedFile[] = [
    { path: PACKAGE_JSON, label: "package.json", expected: expectedPackageJson(libraries) },
    { path: KERNEL_CONFIG, label: "apps/kernel/wrangler.jsonc", expected: expectedKernelConfig(libraries) },
  ];
  for (const plan of plans) {
    const base = `packages/gatekeeper-${plan.name}`;
    for (const [name, text] of [
      ["package.json", workerPackageJson(plan.name)],
      ["tsconfig.json", workerTsconfig()],
      ["wrangler.jsonc", workerConfigText(plan)],
      ["src/index.ts", workerIndex(plan)],
    ] as const) {
      files.push({ path: join(ROOT, base, name), label: `${base}/${name}`, expected: format(`${base}/${name}`, text) });
    }
  }
  return files;
}

/** Worker packages on disk that carry no library with cleared examples. */
export async function stalePackages(): Promise<string[]> {
  const planned = new Set((await planWorkers(await loadLibraries())).map((plan) => plan.name));
  return workerPackages().filter((name) => !planned.has(name));
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const stale: string[] = [];
  for (const file of await generatedFiles()) {
    if (existsSync(file.path) && readFileSync(file.path, "utf8") === file.expected) continue;
    stale.push(file.label);
    if (check) continue;
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.expected);
  }
  const orphans = await stalePackages();
  if (orphans.length > 0) process.stderr.write(`No cleared library is named ${orphans.join(", ")}: delete ${orphans.map((name) => `packages/gatekeeper-${name}`).join(", ")}\n`);
  if (check && (stale.length > 0 || orphans.length > 0)) {
    if (stale.length > 0) process.stderr.write(`${stale.join(", ")} do not match tools/packages.ts; run \`pnpm packages:sync\`\n`);
    process.exit(1);
  }
  process.stdout.write(stale.length === 0 ? "Generated files are up to date.\n" : `Rewrote ${stale.join(", ")}. Run \`pnpm install\` and \`pnpm types\` for a new Worker.\n`);
}

if (process.argv[1] === import.meta.filename) {
  registerTypeScriptResolution();
  await main();
}
