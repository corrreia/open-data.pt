import { describe, expect, it } from "vitest";
import type { GatekeeperLibraries } from "@open-data-pt/gatekeeper";
import { catalogOf } from "@open-data-pt/gatekeeper/catalog";
import { checkedCatalog } from "../apps/kernel/src/registry/vocabulary";
import { CARRIED_NAMES, INSTALLED, carriedLibraries } from "../apps/gatekeeper/tests/catalog";

/*
 * The catalog the Gatekeeper answers, checked the way the kernel checks it at the door. One malformed entry refuses the
 * whole answer, and the Registry then keeps every feed as it was: nothing the release adds, changes or retires reaches
 * it, and only the kernel's logs say why.
 */
describe("the Gatekeeper's catalog as the kernel reads it", () => {
  it("is accepted whole, every installed feed in it", async () => {
    const libraries: GatekeeperLibraries = new Map(CARRIED_NAMES.flatMap((name) => [...carriedLibraries(name)]));
    const { feeds } = checkedCatalog(await catalogOf(INSTALLED, libraries));
    expect(feeds.map((feed) => feed.slug).toSorted()).toEqual(INSTALLED.map((feed) => feed.slug).toSorted());
  }, 60_000);
});
