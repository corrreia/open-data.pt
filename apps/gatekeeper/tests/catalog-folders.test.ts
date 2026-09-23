import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DATASETS, FEEDS, PUBLISHERS, RUNNABLE } from "@open-data-pt/gatekeeper/catalog";
import { INDEX_PATH, catalogIndex } from "../../../tools/catalog-index";

const PUBLISHER_ROOT = fileURLToPath(new URL("../src/publishers/", import.meta.url).href);

describe("the publisher folders", () => {
  it("are all in the index the Worker imports: `pnpm catalog` was run after the last folder changed", () => {
    expect(readFileSync(INDEX_PATH, "utf8"), "run `pnpm catalog`").toBe(catalogIndex());
  });

  it("give every folder under publishers/ a publisher, and nothing else a place there", () => {
    const folders = readdirSync(PUBLISHER_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(
      folders.filter((name) => !existsSync(`${PUBLISHER_ROOT}${name}/index.ts`)),
      "a folder with no index.ts",
    ).toEqual([]);
    expect(folders.toSorted()).toEqual([...PUBLISHERS.keys()].toSorted());
  });

  it("key each dataset by its publisher's folder and its own", () => {
    for (const [id, dataset] of DATASETS) {
      expect(id.startsWith(`${dataset.publisher}-`), id).toBe(true);
      const file = id.slice(dataset.publisher.length + 1);
      expect(existsSync(`${PUBLISHER_ROOT}${dataset.publisher}/datasets/${file}/index.ts`), id).toBe(true);
    }
  });

  it("define every feed in its own file, with the functions that read it", () => {
    for (const [slug, feed] of RUNNABLE) {
      expect(feed.fetch, slug).toBeInstanceOf(Function);
      expect("buffered" in feed.transform || "streaming" in feed.transform, slug).toBe(true);
    }
    expect(RUNNABLE.size).toBe(FEEDS.length);
  });
});
