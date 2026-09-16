import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isJsonObject, isJsonString, parseJson, type ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { CITIES_EXAMPLES } from "../packages/gatekeeper-cities/src/examples";
import { ECONOMY_EXAMPLES } from "../packages/gatekeeper-economy/src/examples";
import { ENERGY_EXAMPLES } from "../packages/gatekeeper-energy/src/examples";
import { ENVIRONMENT_EXAMPLES } from "../packages/gatekeeper-environment/src/examples";
import { GOVERNMENT_EXAMPLES } from "../packages/gatekeeper-government/src/examples";
import { HEALTH_EXAMPLES } from "../packages/gatekeeper-health/src/examples";
import { MOBILITY_EXAMPLES } from "../packages/gatekeeper-mobility/src/examples";
import { SOCIETY_EXAMPLES } from "../packages/gatekeeper-society/src/examples";
import { TELECOM_EXAMPLES } from "../packages/gatekeeper-telecom/src/examples";
import { workerTopics } from "../tools/packages";

/** One library's module namespace, as this test reads it: exported values, one of which is its examples. */
interface LibraryModule {
  readonly [name: string]: readonly ExampleFeed[];
}

/**
 * The library indexes Vite found, each a loader for its module: a new library
 * under `formats/` or `sources/` is held to these rules without being listed here.
 */
interface LibraryModules {
  readonly [path: string]: () => Promise<LibraryModule>;
}

// SAFETY: `import.meta.glob` types every module as `unknown`. A library index is a
// namespace object; this test reads its exported values only to find the example
// feeds among them, and ignores everything that is not one.
const LIBRARIES = {
  ...import.meta.glob("../packages/gatekeeper-shared/src/formats/*/index.ts"),
  ...import.meta.glob("../packages/gatekeeper-shared/src/sources/*/index.ts"),
} as LibraryModules;

function libraryName(path: string): string {
  return path.split("/").at(-2)!;
}

function isExampleFeed(value: ExampleFeed | undefined): boolean {
  return value !== undefined && value.slug !== undefined && value.config !== undefined && value.policy !== undefined;
}

/** The example arrays one library module exports; a library must export exactly one. */
function exampleArrays(module: LibraryModule): Array<readonly ExampleFeed[]> {
  return Object.values(module).filter((value) => Array.isArray(value) && value.length > 0 && isExampleFeed(value[0]));
}

async function libraryExamples(): Promise<Map<string, readonly ExampleFeed[]>> {
  const found = new Map<string, readonly ExampleFeed[]>();
  for (const [path, load] of Object.entries(LIBRARIES)) {
    const name = libraryName(path);
    const arrays = exampleArrays(await load());
    expect(arrays, `${name} must export exactly one examples array`).toHaveLength(1);
    found.set(name, arrays[0]!);
  }
  return found;
}

/** Explicit review holds are not runtime feature flags: their examples must stay out of Worker install lists. */
function publicationHolds(): Map<string, string> {
  const rows = parseJson(readFileSync(new URL("../research/source-publication-holds.json", import.meta.url), "utf8"));
  if (!Array.isArray(rows)) throw new Error("Publication holds must be an array");
  const result = new Map<string, string>();
  for (const row of rows) {
    if (!isJsonObject(row) || !isJsonString(row.source) || !isJsonString(row.reason) || row.reason.length < 20) {
      throw new Error("Every publication hold must name its source and concrete reason");
    }
    if (result.has(row.source)) throw new Error("Duplicate publication hold");
    result.set(row.source, row.reason);
  }
  return result;
}

const PUBLICATION_HOLDS = publicationHolds();

/** What each topic Worker installs, which is what the Registry turns into feeds. */
const WORKERS = new Map<string, readonly ExampleFeed[]>([
  ["cities", CITIES_EXAMPLES],
  ["economy", ECONOMY_EXAMPLES],
  ["energy", ENERGY_EXAMPLES],
  ["environment", ENVIRONMENT_EXAMPLES],
  ["government", GOVERNMENT_EXAMPLES],
  ["health", HEALTH_EXAMPLES],
  ["mobility", MOBILITY_EXAMPLES],
  ["society", SOCIETY_EXAMPLES],
  ["telecom", TELECOM_EXAMPLES],
]);
const DEPLOYED: ExampleFeed[] = [...WORKERS.values()].flat();

describe("example feed policies", () => {
  it("never call a feed stale before its next collection is due", () => {
    const early = DEPLOYED.filter((example) => example.staleAfterSeconds < example.policy.collection.cadenceSeconds).map(
      (example) => `${example.slug}: stale after ${example.staleAfterSeconds}s, collected every ${example.policy.collection.cadenceSeconds}s`,
    );
    expect(early).toEqual([]);
  });

  it("leave products out of history only under a policy that keeps changes, naming each once", () => {
    const misplaced = DEPLOYED.filter((example) => {
      const left = example.policy.collection.withoutHistory ?? [];
      return left.length > 0 && (example.policy.collection.historyMode !== "changes" || new Set(left).size !== left.length || left.some((key) => key.trim() === ""));
    }).map((example) => example.slug);
    expect(misplaced).toEqual([]);
  });

  it("use unique slugs", () => {
    const slugs = DEPLOYED.map((example) => example.slug);
    expect(slugs.filter((slug, index) => slugs.indexOf(slug) !== index)).toEqual([]);
  });
});

describe("libraries and the Workers that carry them", () => {
  it("finds a format library per standard and a source library per bespoke API", () => {
    expect(Object.keys(LIBRARIES).map(libraryName).toSorted()).toEqual([
      "arcgis",
      "bpstat",
      "carris",
      "ckan",
      "dgeg",
      "eurostat",
      "gbfs",
      "gtfs",
      "ine",
      "ipma",
      "metrolisboa",
      "ogc",
      "omie",
      "opendatasoft",
      "parliament",
      "peeringdb",
      "ren",
      "ripestat",
      "udata",
    ]);
  });

  it("lists every Worker package here", () => {
    expect([...WORKERS.keys()]).toEqual(workerTopics());
  });

  it("puts every feed in a Worker whose topic the feed carries", () => {
    const misplaced = [...WORKERS].flatMap(([topic, examples]) =>
      examples.filter((example) => !example.topics?.includes(topic)).map((example) => `${example.slug} (${(example.topics ?? []).join(", ")}) is in ${topic}`),
    );
    expect(misplaced).toEqual([]);
  });

  it("wires every library, held or not, into a Worker", () => {
    const wiring = workerTopics()
      .map((topic) => readFileSync(new URL(`../packages/gatekeeper-${topic}/src/index.ts`, import.meta.url), "utf8"))
      .join("\n");
    const unwired = Object.keys(LIBRARIES)
      .map(libraryName)
      .filter((name) => !new RegExp(`\\[\\s*"${name}",\\s*\\{`).test(wiring));
    expect(unwired).toEqual([]);
  });

  it("gives every cleared library example to exactly one Worker", async () => {
    const libraries = await libraryExamples();
    const offered = [...libraries]
      .filter(([name]) => !PUBLICATION_HOLDS.has(name))
      .flatMap(([, examples]) => examples.map((example) => example.slug))
      .toSorted();
    expect(DEPLOYED.map((example) => example.slug).toSorted()).toEqual(offered);
  });

  it("never auto-publishes an adapter awaiting permission or record validation", async () => {
    const libraries = await libraryExamples();
    for (const source of PUBLICATION_HOLDS.keys()) {
      expect(libraries.has(source), `Unknown publication hold ${source}`).toBe(true);
      expect(DEPLOYED.filter((example) => example.config.source === source)).toEqual([]);
    }
  });

  it("names its own library in every example configuration", async () => {
    const libraries = await libraryExamples();
    const wrong = [...libraries].flatMap(([name, examples]) =>
      examples.filter((example) => example.config.source !== name).map((example) => `${example.slug}: ${example.config.source ?? "(none)"} is not ${name}`),
    );
    expect(wrong).toEqual([]);
  });
});
