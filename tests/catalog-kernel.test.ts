import { beforeAll, describe, expect, it } from "vitest";
import type { CatalogDescription, GatekeeperLibraries } from "@open-data-pt/gatekeeper";
import { catalogOf } from "@open-data-pt/gatekeeper/catalog";
import { POLICY_CEILINGS, checkedCatalog } from "../apps/kernel/src/registry/vocabulary";
import { CARRIED_NAMES, INSTALLED, carriedLibraries } from "../apps/gatekeeper/tests/catalog";

const POLICY_FIELDS = ["cadenceSeconds", "timeoutSeconds", "maxBytes", "maxOutputBytes", "maxRecordBytes", "maxRecords"] as const;

/*
 * The catalog the Gatekeeper answers, checked the way the kernel checks it at the door. One malformed entry refuses the
 * whole answer, and the Registry then keeps every feed as it was: nothing the release adds, changes or retires reaches
 * it, and only the kernel's logs say why.
 */
describe("the Gatekeeper's catalog as the kernel reads it", () => {
  let catalog: CatalogDescription;

  beforeAll(async () => {
    const libraries: GatekeeperLibraries = new Map(CARRIED_NAMES.flatMap((name) => [...carriedLibraries(name)]));
    catalog = await catalogOf(INSTALLED, libraries);
  }, 60_000);

  it("is accepted whole, every installed feed in it and every policy within Kernel ceilings", () => {
    const { feeds } = checkedCatalog(catalog);
    expect(feeds.map((feed) => feed.slug).toSorted()).toEqual(INSTALLED.map((feed) => feed.slug).toSorted());
  });

  it.each(POLICY_FIELDS.map((field) => [field, POLICY_CEILINGS[field]]))("rejects a catalog whose %s exceeds the Kernel ceiling", (field, ceiling) => {
    const changed = structuredClone(catalog);
    const feed = changed.feeds[0];
    if (!feed) throw new Error("The installed catalog has a feed");
    feed.policy = { ...feed.policy, [field]: ceiling + 1 };
    expect(() => checkedCatalog(changed)).toThrow(`Kernel ceiling of ${ceiling}`);
  });
});
