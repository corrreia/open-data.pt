import { describe, expect, it } from "vitest";
import { resolveLibraryFeed } from "@open-data-pt/gatekeeper";
import { FEEDS, RUNNABLE } from "@open-data-pt/gatekeeper/catalog";
import { carriedLibraries } from "./catalog";

/**
 * Resolving a feed reaches no source here. DGEG checks a fuel type against its
 * published list, so this answers that list with every fuel type the DGEG feeds
 * name; any other request is a library reaching the network, and fails.
 */
const FUEL_TYPES = FEEDS.filter((feed) => feed.config.source === "dgeg" && feed.config.fuelTypeId).map((feed) => ({ Id: Number(feed.config.fuelTypeId) }));
const offline: typeof fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.pathname.endsWith("/GetTiposCombustiveis")) return Response.json({ status: true, resultado: FUEL_TYPES });
  throw new Error(`Resolving a feed reached ${url.href}`);
};

/**
 * A feed's resolved identity decides whether its epoch rotates and whether its
 * checkpoint is still its own (`resourceKey`, `kind`), and its ID derives from
 * its slug. This pins every example's identity to a fixture, so a change to
 * how the Worker is laid out, or to how a library stamps its resource keys, is
 * seen for what it is: every feed re-walking its history from nothing.
 * Update the fixture (`vitest -u`) only for a change that is meant to do that.
 */
describe("every example's resolved identity", () => {
  it("is what it was", async () => {
    const identities: Record<string, { resourceKey: string; kind: string }> = {};
    for (const feed of FEEDS) {
      const resolved = await resolveLibraryFeed(feed.config, carriedLibraries(feed.config.source ?? "", {}, offline));
      identities[feed.slug] = { resourceKey: resolved.resourceKey, kind: resolved.kind };
    }
    const text = `${JSON.stringify(Object.fromEntries(Object.entries(identities).toSorted(([a], [b]) => a.localeCompare(b))), null, 2)}\n`;
    await expect(text).toMatchFileSnapshot("./fixtures/feed-identity.json");
  }, 60_000);

  it("paces every history walk: a feed with a backfill states how often one slice of it may be read", async () => {
    const unpaced: string[] = [];
    for (const feed of FEEDS) {
      if (!RUNNABLE.get(feed.slug)?.backfill) continue;
      const resolved = await resolveLibraryFeed(feed.config, carriedLibraries(feed.config.source ?? "", {}, offline));
      if (resolved.history?.minSliceSeconds === undefined) unpaced.push(`${feed.slug} (${resolved.kind})`);
    }
    expect(unpaced).toEqual([]);
  }, 60_000);
});
