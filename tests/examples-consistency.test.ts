import { describe, expect, it } from "vitest";
import { LICENCES, PUBLISHERS, isLicence, isPublisher, isTopic, publisherEnabled } from "@open-data-pt/catalog";
import type { ExampleFeed } from "@open-data-pt/contract";
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
  ...import.meta.glob("../apps/gatekeeper/src/formats/*/index.ts"),
  ...import.meta.glob("../apps/gatekeeper/src/sources/*/index.ts"),
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

  it("read each source once, whatever the feed is called", () => {
    // Unique slugs are not enough: two feeds named differently can still name the same
    // dataset and the same resource, and then the catalog collects one source twice and
    // publishes it as two products. Identical configuration is identical data.
    const bySource = new Map<string, string[]>();
    for (const example of DEPLOYED) {
      const source = JSON.stringify(Object.entries(example.config).toSorted(([left], [right]) => left.localeCompare(right)));
      bySource.set(source, [...(bySource.get(source) ?? []), example.slug]);
    }
    expect([...bySource.values()].filter((slugs) => slugs.length > 1)).toEqual([]);
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
      "infoagua",
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
      "snirh",
      "snit",
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

  it("carries every library directory, each once", () => {
    const carried = new Set(CARRIED_NAMES);
    expect(CARRIED_NAMES.length, "libraries.ts lists a library twice").toBe(carried.size);
    expect(
      Object.keys(LIBRARIES)
        .map(libraryName)
        .filter((name) => !carried.has(name)),
      "a library directory no line of libraries.ts lists",
    ).toEqual([]);
    expect(
      CARRIED_NAMES.filter((name) => !(name in LIBRARIES_BY_NAME)),
      "listed in libraries.ts but no such directory",
    ).toEqual([]);
  });

  it("installs every example of an enabled publisher, each once", async () => {
    const libraries = await libraryExamples();
    const offered = [...libraries].flatMap(([, examples]) => examples.filter((example) => publisherEnabled(example.publisher)).map((example) => example.slug)).toSorted();
    expect(DEPLOYED.map((example) => example.slug).toSorted()).toEqual(offered);
  });

  it("installs nothing from a publisher held for permission", async () => {
    const held = Object.keys(PUBLISHERS).filter((key) => !publisherEnabled(key));
    expect(held.length, "no publisher is held, so nothing proves a hold works").toBeGreaterThan(0);
    expect(DEPLOYED.filter((example) => held.includes(example.publisher)).map((example) => example.slug)).toEqual([]);
    // The libraries that read them still ship: a hold is about whose data we serve, not about what code exists.
    const libraries = await libraryExamples();
    const readingHeld = [...libraries].filter(([, examples]) => examples.some((example) => held.includes(example.publisher))).map(([name]) => name);
    expect(
      readingHeld.filter((name) => !CARRIED_NAMES.includes(name)),
      "a library that reads a held publisher but is not carried",
    ).toEqual([]);
  });

  it("names its own library in every example configuration", async () => {
    const libraries = await libraryExamples();
    const wrong = [...libraries].flatMap(([name, examples]) =>
      examples.filter((example) => example.config.source !== name).map((example) => `${example.slug}: ${example.config.source ?? "(none)"} is not ${name}`),
    );
    expect(wrong).toEqual([]);
  });
});
