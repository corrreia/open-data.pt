import { describe, expect, it } from "vitest";
import type { ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { CITIES_EXAMPLES } from "../packages/gatekeeper-cities/src/examples";
import { ENERGY_EXAMPLES } from "../packages/gatekeeper-energy/src/examples";
import { ENVIRONMENT_EXAMPLES } from "../packages/gatekeeper-environment/src/examples";
import { HEALTH_EXAMPLES } from "../packages/gatekeeper-health/src/examples";
import { MOBILITY_EXAMPLES } from "../packages/gatekeeper-mobility/src/examples";
import { STATISTICS_EXAMPLES } from "../packages/gatekeeper-statistics/src/examples";

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

/** What the six Workers actually install, which is what the Registry turns into feeds. */
const DEPLOYED: ExampleFeed[] = [
  ...CITIES_EXAMPLES,
  ...ENERGY_EXAMPLES,
  ...ENVIRONMENT_EXAMPLES,
  ...HEALTH_EXAMPLES,
  ...MOBILITY_EXAMPLES,
  ...STATISTICS_EXAMPLES,
];

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
      "arcgis", "bpstat", "carris", "ckan", "dgeg", "eurostat", "gbfs", "gtfs",
      "ine", "ipma", "metrolisboa", "omie", "opendatasoft", "ren", "udata",
    ]);
  });

  it("gives every library example to exactly one Worker", async () => {
    const libraries = await libraryExamples();
    const offered = [...libraries.values()].flatMap((examples) => examples.map((example) => example.slug)).toSorted();
    expect(DEPLOYED.map((example) => example.slug).toSorted()).toEqual(offered);
  });

  it("names its own library in every example configuration", async () => {
    const libraries = await libraryExamples();
    const wrong = [...libraries].flatMap(([name, examples]) => examples
      .filter((example) => example.config.source !== name)
      .map((example) => `${example.slug}: ${example.config.source ?? "(none)"} is not ${name}`));
    expect(wrong).toEqual([]);
  });
});
