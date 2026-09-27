import { describe, expect, it } from "vitest";
import { resolveLibraryFeed, type GatekeeperLibraries } from "@open-data-pt/gatekeeper";
import { FEEDS, RUNNABLE, catalogOf } from "@open-data-pt/gatekeeper/catalog";
import { CARRIED_NAMES, INSTALLED, carriedLibraries } from "./catalog";
import { jsonAs, readFixture } from "./support";

const PINNED = new URL("./fixtures/feed-identity.json", import.meta.url);

/**
 * A feed's resolved identity decides whether its epoch rotates and whether its
 * checkpoint is still its own (`resourceKey`, `kind`), and its ID derives from
 * its slug. This pins every feed's identity to a fixture, so a change to
 * how the Worker is laid out, or to how a library stamps its resource keys, is
 * seen for what it is: every feed re-walking its history from nothing.
 * Update the fixture (`vitest -u`) only for a change that is meant to do that.
 */
describe("every feed's resolved identity", () => {
  it("is what it was", async () => {
    const identities: Record<string, { resourceKey: string; kind: string }> = {};
    for (const feed of FEEDS) {
      const resolved = await resolveLibraryFeed(feed.config, carriedLibraries(feed.config.source ?? ""));
      identities[feed.slug] = { resourceKey: resolved.resourceKey, kind: resolved.kind };
    }
    const text = `${JSON.stringify(Object.fromEntries(Object.entries(identities).toSorted(([a], [b]) => a.localeCompare(b))), null, 2)}\n`;
    await expect(text).toMatchFileSnapshot("./fixtures/feed-identity.json");
  }, 60_000);

  it("paces every history walk: a feed with a backfill states how often one slice of it may be read", async () => {
    const unpaced: string[] = [];
    for (const feed of FEEDS) {
      if (!RUNNABLE.get(feed.slug)?.backfill) continue;
      const resolved = await resolveLibraryFeed(feed.config, carriedLibraries(feed.config.source ?? ""));
      if (resolved.history?.minSliceSeconds === undefined) unpaced.push(`${feed.slug} (${resolved.kind})`);
    }
    expect(unpaced).toEqual([]);
  }, 60_000);

  it("is what the catalog tells the kernel: every installed feed, resolved to its pinned resource key, with no configuration", async () => {
    const pinned = jsonAs<Record<string, { resourceKey: string; kind: string }>>(readFixture(PINNED));
    const libraries: GatekeeperLibraries = new Map(CARRIED_NAMES.flatMap((name) => [...carriedLibraries(name)]));
    const { feeds } = await catalogOf(INSTALLED, libraries);
    expect(feeds).toHaveLength(INSTALLED.length);
    for (const feed of feeds) {
      expect({ slug: feed.slug, resourceKey: feed.resourceKey }).toEqual({ slug: feed.slug, resourceKey: pinned[feed.slug]?.resourceKey });
      expect(Object.keys(feed)).not.toContain("config");
      expect(Object.keys(feed)).not.toContain("kind");
    }
  }, 60_000);
});
