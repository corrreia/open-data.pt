/**
 * The Gatekeeper Workers and the lists that name them, generated rather than kept in step by hand.
 *
 *   node tools/packages.ts            rewrite every generated file
 *   node tools/packages.ts --check    fail when a checked-in file differs
 *
 * A feed runs in the Worker of its first topic. From every library's examples
 * and its deployment declaration (`worker.ts`), this writes each topic Worker's
 * `src/index.ts`, `wrangler.jsonc`, `package.json` and `tsconfig.json`: the
 * libraries its feeds use, their vars, secrets, buckets and CPU limit. It also
 * rewrites the root `package.json` scripts that run every Worker and the
 * kernel's `GATEKEEPER_*` service bindings, leaving the rest of both files as
 * they are. Output goes through Oxfmt, so generated files are formatted files.
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

/** One library as the generator reads it: where it lives, what it declares, and its examples. */
interface Library {
  source: string;
  /** `formats` or `sources`. */
  group: string;
  deploymentExport: string;
  deployment: LibraryDeployment<never>;
  examplesExport: string;
  examples: readonly ExampleFeed[];
  held: boolean;
}

/** What one topic Worker carries. */
interface TopicPlan {
  topic: string;
  libraries: Library[];
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

/** Each topic some feed names first, with the libraries those feeds use; held libraries are wired but not installed. */
export async function planTopics(libraries: Library[]): Promise<TopicPlan[]> {
  const { TOPICS } = await import(join(SHARED_SOURCE, "topics.ts"));
  const topics = new Map<string, Set<Library>>();
  for (const library of libraries) {
    for (const example of library.examples) {
      const topic = example.topics?.[0];
      if (!topic || !Object.hasOwn(TOPICS, topic)) throw new Error(`${example.slug}: its first topic ${topic ?? "(none)"} is not one of ${Object.keys(TOPICS).join(", ")}`);
      topics.set(topic, (topics.get(topic) ?? new Set()).add(library));
    }
  }
  return [...topics]
    .map(([topic, used]) => ({ topic, libraries: [...used].toSorted((left, right) => left.source.localeCompare(right.source)) }))
    .toSorted((left, right) => left.topic.localeCompare(right.topic));
}

function format(path: string, text: string): string {
  const result = spawnSync(join(ROOT, "node_modules/.bin/oxfmt"), ["--stdin-filepath", path], { cwd: ROOT, input: text, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`oxfmt could not format ${path}: ${result.stderr}`);
  return result.stdout;
}

function workerIndex(plan: TopicPlan): string {
  const imports = plan.libraries.map(
    (library) =>
      `import { ${[library.deploymentExport, ...(library.held ? [] : [library.examplesExport])].join(", ")} } from "@open-data-pt/gatekeeper-shared/${library.group}/${library.source}";`,
  );
  const held = plan.libraries.filter((library) => library.held).map((library) => library.source);
  return [
    `// Generated by \`pnpm packages:sync\` from the feeds whose first topic is ${plan.topic}; do not edit.`,
    `import { topicGatekeeper } from "@open-data-pt/gatekeeper-shared/topic-worker";`,
    ...imports,
    "",
    ...(held.length > 0 ? [`// Wired but not installed until packages/gatekeeper-shared/src/publication-holds.json clears them: ${held.join(", ")}.`] : []),
    `export default topicGatekeeper<Env>(`,
    `  ${JSON.stringify(plan.topic)},`,
    `  [${plan.libraries.map((library) => library.deploymentExport).join(", ")}],`,
    `  [${plan.libraries
      .filter((library) => !library.held)
      .map((library) => `...${library.examplesExport}`)
      .join(", ")}],`,
    `);`,
    "",
  ].join("\n");
}

function workerConfigText(plan: TopicPlan): string {
  const vars: Record<string, string> = {};
  for (const library of plan.libraries) {
    for (const [name, value] of Object.entries(library.deployment.vars)) {
      if (vars[name] !== undefined && vars[name] !== value) throw new Error(`${plan.topic}: two libraries declare ${name} differently`);
      vars[name] = value;
    }
  }
  const secrets = plan.libraries.flatMap((library) => (library.deployment.secrets ?? []).map((secret) => `${secret} (${library.source})`));
  const buckets = plan.libraries.flatMap((library) => library.deployment.r2Buckets ?? []);
  const cpu = Math.max(0, ...plan.libraries.map((library) => library.deployment.cpuMs ?? 0));
  const lines = [
    `// Generated by \`pnpm packages:sync\` from the deployment declarations (worker.ts) of the libraries its feeds use; do not edit.`,
    "{",
    `  "$schema": "../../node_modules/wrangler/config-schema.json",`,
    `  "name": "open-data-pt-gatekeeper-${plan.topic}",`,
    `  "main": "src/index.ts",`,
    `  "compatibility_date": "${COMPATIBILITY_DATE}",`,
    `  "compatibility_flags": ["nodejs_compat"],`,
    `  "workers_dev": false,`,
    `  "preview_urls": false,`,
    `  "vars": ${JSON.stringify(vars)},`,
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

function workerPackageJson(topic: string): string {
  return `${JSON.stringify({ name: `@open-data-pt/gatekeeper-${topic}`, version: "0.1.0", private: true, type: "module", dependencies: { "@open-data-pt/gatekeeper-shared": "workspace:*" } }, null, 2)}\n`;
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
  const plans = await planTopics(await loadLibraries());
  const topics = plans.map((plan) => plan.topic);
  const files: GeneratedFile[] = [
    { path: PACKAGE_JSON, label: "package.json", expected: expectedPackageJson(topics) },
    { path: KERNEL_CONFIG, label: "apps/kernel/wrangler.jsonc", expected: expectedKernelConfig(topics) },
  ];
  for (const plan of plans) {
    const base = `packages/gatekeeper-${plan.topic}`;
    for (const [name, text] of [
      ["package.json", workerPackageJson(plan.topic)],
      ["tsconfig.json", workerTsconfig()],
      ["wrangler.jsonc", workerConfigText(plan)],
      ["src/index.ts", workerIndex(plan)],
    ] as const) {
      files.push({ path: join(ROOT, base, name), label: `${base}/${name}`, expected: format(`${base}/${name}`, text) });
    }
  }
  return files;
}

/** Worker packages on disk that no feed names as its first topic. */
export async function stalePackages(): Promise<string[]> {
  const topics = new Set((await planTopics(await loadLibraries())).map((plan) => plan.topic));
  return workerTopics().filter((topic) => !topics.has(topic));
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
  if (orphans.length > 0) process.stderr.write(`No feed's first topic is ${orphans.join(", ")}: delete ${orphans.map((topic) => `packages/gatekeeper-${topic}`).join(", ")}\n`);
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
