import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LICENCES, PUBLISHERS, isJsonObject, isJsonString, isLicence, isPublisher, isTopic, parseJson, type ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { CARRIED_NAMES, INSTALLED } from "./catalog";

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

const LIBRARIES_BY_NAME = Object.fromEntries(Object.keys(LIBRARIES).map((path) => [libraryName(path), path]));

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

/** Explicit review holds are not runtime feature flags: their examples must stay out of what the Worker installs. */
function publicationHolds(): Map<string, string> {
  const rows = parseJson(readFileSync(new URL("../packages/gatekeeper-shared/src/publication-holds.json", import.meta.url), "utf8"));
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

/** What the Gatekeeper Worker installs, which is what the Registry turns into feeds. */
const DEPLOYED: ExampleFeed[] = INSTALLED;

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

describe("libraries and the Worker that carries them", () => {
  it("finds a format library per standard and a source library per bespoke API", () => {
    expect(Object.keys(LIBRARIES).map(libraryName).toSorted()).toEqual([
      "anepc",
      "arcgis",
      "bpstat",
      "carris",
      "ckan",
      "dgeg",
      "eurostat",
      "firms",
      "gbfs",
      "gtfs",
      "ine",
      "ioda",
      "ipma",
      "metrolisboa",
      "myinfo",
      "nasapower",
      "ngsi",
      "ogc",
      "omie",
      "opendatasoft",
      "parliament",
      "peeringdb",
      "ren",
      "ripeatlas",
      "ripestat",
      "udata",
      "usgs",
      "wfs",
    ]);
  });

  it("tags every example, held or not, with catalog topics and nothing else", async () => {
    const libraries = await libraryExamples();
    const strays = [...libraries.values()]
      .flat()
      .filter((example) => (example.topics ?? []).length === 0 || (example.topics ?? []).some((topic) => !isTopic(topic)))
      .map((example) => `${example.slug} (${(example.topics ?? []).join(", ")})`);
    expect(strays).toEqual([]);
  });

  it("names every example's publisher and licence from the vocabularies, and leaves no entry unused", async () => {
    const examples = [...(await libraryExamples()).values()].flat();
    const strays = examples
      .filter((example) => !isPublisher(example.publisher) || !isLicence(example.policy.serving.licence))
      .map((example) => `${example.slug} (${example.publisher}, ${example.policy.serving.licence})`);
    expect(strays).toEqual([]);
    const publishers = new Set(examples.map((example) => example.publisher));
    const licences = new Set(examples.map((example) => example.policy.serving.licence));
    expect(
      Object.keys(PUBLISHERS).filter((key) => !publishers.has(key)),
      "publishers no example names",
    ).toEqual([]);
    expect(
      Object.keys(LICENCES).filter((key) => !licences.has(key)),
      "licences no example names",
    ).toEqual([]);
  });

  it("carries every cleared library, and no held one", () => {
    const carried = new Set(CARRIED_NAMES);
    expect(CARRIED_NAMES.length, "libraries.ts lists a library twice").toBe(carried.size);
    const cleared = Object.keys(LIBRARIES)
      .map(libraryName)
      .filter((name) => !PUBLICATION_HOLDS.has(name));
    expect(
      cleared.filter((name) => !carried.has(name)),
      "cleared but not listed in libraries.ts",
    ).toEqual([]);
    expect(
      [...PUBLICATION_HOLDS.keys()].filter((name) => carried.has(name)),
      "held but listed in libraries.ts",
    ).toEqual([]);
    expect(
      CARRIED_NAMES.filter((name) => !(name in LIBRARIES_BY_NAME)),
      "listed in libraries.ts but no such directory",
    ).toEqual([]);
  });

  it("installs every cleared library's examples, each once", async () => {
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
