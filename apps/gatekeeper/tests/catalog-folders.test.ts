import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RunnableFeed } from "@open-data-pt/gatekeeper";
import { FEEDS, PUBLISHERS, RUNNABLE } from "@open-data-pt/gatekeeper/catalog";
import { INDEX_PATH, catalogIndex } from "../../../tools/catalog-index";

const PUBLISHER_ROOT = fileURLToPath(new URL("../src/publishers/", import.meta.url).href);

/** What a feed file exports. */
async function feedFile(path: string): Promise<RunnableFeed> {
  // SAFETY: every file under a publisher's feeds/ exports `FEED` from `defineFeed`, which returns a RunnableFeed; a file
  // that does not fails this test by being compared, by identity, against the feeds its publisher lists.
  const module = (await import(path)) as { FEED: RunnableFeed };
  return module.FEED;
}

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

  it("list every feed file under a publisher's feeds/ in that publisher's index.ts, once, and nothing else", async () => {
    for (const [key, publisher] of PUBLISHERS) {
      const folder = `${PUBLISHER_ROOT}${key}/feeds/`;
      const files = existsSync(folder) ? readdirSync(folder).filter((file) => file.endsWith(".ts")) : [];
      const exported = await Promise.all(files.map((file) => feedFile(`${folder}${file}`)));
      expect(
        files.filter((_, at) => !publisher.feeds.some((feed) => feed === exported[at])),
        `${key}: feed files its index.ts does not list`,
      ).toEqual([]);
      expect(publisher.feeds.length, `${key}: its index.ts lists a feed twice, or one from another folder`).toBe(new Set(exported).size);
      expect(new Set(publisher.feeds).size, `${key}: its index.ts lists a feed twice`).toBe(publisher.feeds.length);
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
