import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LICENCES, TOPICS, isLicence, isTopic, type ExampleFeed } from "@open-data-pt/gatekeeper";
import { DATASETS, FEEDS, PUBLISHERS, datasetEnabled, publisherEnabled } from "@open-data-pt/gatekeeper/catalog";
import { CARRIED_NAMES, INSTALLED, datasetOf } from "./catalog";

/**
 * Every library directory on disk: each format, and each publisher's own
 * library, which is a folder beside their datasets with a deployment in it. A
 * new one is held to these rules without being listed here.
 */
const SRC = fileURLToPath(new URL("../src/", import.meta.url).href);

/** The folders directly inside `path`, each ending in a slash. */
function folders(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${path}${entry.name}/`);
}

const LIBRARY_NAMES = [...folders(`${SRC}formats/`), ...folders(`${SRC}publishers/`).flatMap(folders)]
  .filter((folder) => existsSync(`${folder}deployment.ts`))
  .map((folder) => basename(folder));

/** Every feed every publisher folder declares, held or not, by the library that reads it. */
function feedsByLibrary(): Map<string, ExampleFeed[]> {
  const found = new Map<string, ExampleFeed[]>();
  for (const feed of FEEDS) {
    const name = feed.config.source ?? "";
    found.set(name, [...(found.get(name) ?? []), feed]);
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
    expect(LIBRARY_NAMES.toSorted()).toEqual([
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
      "ripestat",
      "snirh",
      "snit",
      "udata",
      "usgs",
      "wfs",
    ]);
  });

  it("tags every dataset, held or not, with catalog topics and nothing else", () => {
    const strays = [...DATASETS]
      .filter(([, dataset]) => dataset.topics.length === 0 || dataset.topics.some((topic) => !isTopic(topic)))
      .map(([id, dataset]) => `${id} (${dataset.topics.join(", ")})`);
    expect(strays).toEqual([]);
  });

  it("gives every publisher a dataset and every dataset a feed, and names only licences the vocabulary knows, each used", () => {
    expect(
      [...PUBLISHERS.keys()].filter((id) => ![...DATASETS.values()].some((dataset) => dataset.publisher === id)),
      "publishers with no dataset",
    ).toEqual([]);
    expect(
      [...DATASETS].filter(([, dataset]) => dataset.feeds.length === 0).map(([id]) => id),
      "datasets no feed reads",
    ).toEqual([]);
    expect(
      [...DATASETS].filter(([, dataset]) => !isLicence(dataset.licence)).map(([id]) => id),
      "datasets naming a licence outside the vocabulary",
    ).toEqual([]);
    const licences = new Set<string>([...DATASETS.values()].map((dataset) => dataset.licence));
    expect(
      Object.keys(LICENCES).filter((key) => !licences.has(key)),
      "licences no dataset names",
    ).toEqual([]);
    const topics = new Set<string>([...DATASETS.values()].flatMap((dataset) => dataset.topics));
    expect(
      Object.keys(TOPICS).filter((key) => !topics.has(key)),
      "topics no dataset names",
    ).toEqual([]);
  });

  it("names what a feed is only when its dataset has others to tell it from", () => {
    const wrong = [...DATASETS].flatMap(([id, dataset]) =>
      dataset.feeds
        .filter((feed) => dataset.feeds.length > 1 !== (feed.title !== undefined && feed.description !== undefined))
        .map((feed) => `${id}: ${feed.slug} ${dataset.feeds.length > 1 ? "needs its own title and description" : "repeats its dataset's"}`),
    );
    expect(wrong).toEqual([]);
  });

  it("carries every library directory, each once", () => {
    const carried = new Set(CARRIED_NAMES);
    expect(CARRIED_NAMES.length, "libraries.ts lists a library twice").toBe(carried.size);
    expect(
      LIBRARY_NAMES.filter((name) => !carried.has(name)),
      "a library directory no line of libraries.ts lists",
    ).toEqual([]);
    expect(
      CARRIED_NAMES.filter((name) => !LIBRARY_NAMES.includes(name)),
      "listed in libraries.ts but no such directory",
    ).toEqual([]);
  });

  it("installs every feed of an enabled publisher, each once", () => {
    const offered = FEEDS.filter((feed) => datasetEnabled(feed.dataset))
      .map((feed) => feed.slug)
      .toSorted();
    expect(DEPLOYED.map((example) => example.slug).toSorted()).toEqual(offered);
  });

  it("installs nothing from a publisher held for permission", () => {
    const held = [...PUBLISHERS.keys()].filter((key) => !publisherEnabled(key));
    expect(held.length, "no publisher is held, so nothing proves a hold works").toBeGreaterThan(0);
    expect(DEPLOYED.filter((example) => held.includes(datasetOf(example).publisher)).map((example) => example.slug)).toEqual([]);
    // The libraries that read them still ship: a hold is about whose data we serve, not about what code exists.
    const readingHeld = [...feedsByLibrary()].filter(([, examples]) => examples.some((example) => held.includes(datasetOf(example).publisher))).map(([name]) => name);
    expect(
      readingHeld.filter((name) => !CARRIED_NAMES.includes(name)),
      "a library that reads a held publisher but is not carried",
    ).toEqual([]);
  });

  it("reads every feed through a library the Worker carries", () => {
    const wrong = FEEDS.filter((feed) => !CARRIED_NAMES.includes(feed.config.source ?? "")).map((feed) => `${feed.slug}: ${feed.config.source ?? "(none)"}`);
    expect(wrong).toEqual([]);
  });
});
