import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LICENCES, TOPICS, isLicence, isTopic } from "@open-data-pt/gatekeeper";
import { FEEDS, PUBLISHERS } from "@open-data-pt/gatekeeper/catalog";
import { CARRIED_NAMES, INSTALLED } from "./catalog";

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

describe("example feed policies", () => {
  it("never call a feed stale before its next collection is due", () => {
    const early = INSTALLED.filter((example) => example.staleAfterSeconds < example.policy.cadenceSeconds).map(
      (example) => `${example.slug}: stale after ${example.staleAfterSeconds}s, collected every ${example.policy.cadenceSeconds}s`,
    );
    expect(early).toEqual([]);
  });

  it("leave products out of history only under a policy that keeps changes, naming each once", () => {
    const misplaced = INSTALLED.filter((example) => {
      const left = example.policy.withoutHistory ?? [];
      return left.length > 0 && (example.policy.historyMode !== "changes" || new Set(left).size !== left.length || left.some((key) => key.trim() === ""));
    }).map((example) => example.slug);
    expect(misplaced).toEqual([]);
  });

  it("read each source once, whatever the feed is called", () => {
    // Unique slugs are not enough: two feeds named differently can still name the same
    // dataset and the same resource, and then the catalog collects one source twice and
    // publishes it as two products. Identical configuration is identical data.
    const bySource = new Map<string, string[]>();
    for (const example of INSTALLED) {
      const source = JSON.stringify(Object.entries(example.config).toSorted(([left], [right]) => left.localeCompare(right)));
      bySource.set(source, [...(bySource.get(source) ?? []), example.slug]);
    }
    expect([...bySource.values()].filter((slugs) => slugs.length > 1)).toEqual([]);
  });
});

describe("libraries and the Worker that carries them", () => {
  it("tags every feed, held or not, with catalog topics and nothing else", () => {
    const strays = FEEDS.filter((feed) => feed.topics.length === 0 || feed.topics.some((topic) => !isTopic(topic))).map((feed) => `${feed.slug} (${feed.topics.join(", ")})`);
    expect(strays).toEqual([]);
  });

  it("gives every publisher a feed, and names only licences the vocabulary knows, each used", () => {
    expect(
      [...PUBLISHERS].filter(([, publisher]) => publisher.feeds.length === 0).map(([id]) => id),
      "publishers with no feed",
    ).toEqual([]);
    expect(
      FEEDS.filter((feed) => !isLicence(feed.licence)).map((feed) => feed.slug),
      "feeds naming a licence outside the vocabulary",
    ).toEqual([]);
    const licences = new Set<string>(FEEDS.map((feed) => feed.licence));
    expect(
      Object.keys(LICENCES).filter((key) => !licences.has(key)),
      "licences no feed names",
    ).toEqual([]);
    const topics = new Set<string>(FEEDS.flatMap((feed) => feed.topics));
    expect(
      Object.keys(TOPICS).filter((key) => !topics.has(key)),
      "topics no feed names",
    ).toEqual([]);
  });

  it("credits every feed's publisher, held or not, as they ask to be credited", () => {
    expect(FEEDS.filter((feed) => (feed.attribution ?? "").trim() === "").map((feed) => feed.slug)).toEqual([]);
  });

  it("gives every feed a title and a description of its own, no two feeds of a publisher alike", () => {
    expect(FEEDS.filter((feed) => feed.title.trim() === "" || feed.description.trim() === "").map((feed) => feed.slug)).toEqual([]);
    const seen = new Map<string, string>();
    const repeated: string[] = [];
    for (const feed of FEEDS) {
      const key = `${feed.publisher}: ${feed.title}`;
      const other = seen.get(key);
      if (other) repeated.push(`${other} and ${feed.slug} are both "${feed.title}"`);
      seen.set(key, feed.slug);
    }
    expect(repeated).toEqual([]);
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

  it("reads every feed through a library the Worker carries", () => {
    const wrong = FEEDS.filter((feed) => !CARRIED_NAMES.includes(feed.config.source ?? "")).map((feed) => `${feed.slug}: ${feed.config.source ?? "(none)"}`);
    expect(wrong).toEqual([]);
  });
});
