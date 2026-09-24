import { describe, expect, it } from "vitest";
import { buildListings, buildPublishers, withoutPublisher } from "../src/lib/catalog";
import type { Feed, Product } from "../src/lib/types";

const FEED: Feed = {
  id: "feed_vehicles",
  slug: "carris-vehicles-feed",
  title: "Carris Metropolitana vehicle positions",
  description: "Near-real-time vehicle state.",
  publisher: { id: "carris-metropolitana", name: "Carris Metropolitana" },
  licence: { id: "cc-by-4.0", name: "CC BY 4.0" },
  topics: ["mobility"],
  format: "own-api",
  cadenceSeconds: 60,
  enabled: true,
  staleAfterSeconds: 600,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-24T10:00:00.000Z",
};

function product(slug: string, title: string, role: Product["role"], rowCount: number): Product {
  return {
    id: slug,
    slug,
    feedId: FEED.id,
    title,
    description: `${title}, described.`,
    role,
    schema: { fields: [] },
    version: 1,
    status: "current",
    currentAcquisitionId: null,
    watermark: null,
    rowCount,
    completeness: "complete",
    stale: false,
    staleAfterSeconds: 600,
    cadenceSeconds: 60,
    historyMode: "latest",
    exposeHistory: false,
    licence: FEED.licence,
    attribution: null,
    hasChanges: false,
    hasSeries: false,
    updatedAt: "2026-09-24T10:00:00.000Z",
  };
}

describe("the catalog's listings", () => {
  const listings = buildListings(
    [
      product("carris-vehicles", "Carris Metropolitana vehicles", "current-state", 1200),
      product("carris-active-vehicles", "Carris Metropolitana active vehicles over time", "time-series", 0),
      { ...product("orphan", "A product whose feed is gone", "reference", 3), feedId: "feed_gone" },
    ],
    [FEED],
  );

  it("lists every table and series on its own, each with its feed's publisher, terms and topics", () => {
    expect(listings.map((listing) => listing.id)).toEqual(["carris-vehicles", "carris-active-vehicles"]);
    expect(listings.map(({ title, role, publisher, licence, topics }) => ({ title, role, publisher: publisher.id, licence: licence.id, topics }))).toEqual([
      { title: "Carris Metropolitana vehicles", role: "current-state", publisher: "carris-metropolitana", licence: "cc-by-4.0", topics: ["mobility"] },
      { title: "Carris Metropolitana active vehicles over time", role: "time-series", publisher: "carris-metropolitana", licence: "cc-by-4.0", topics: ["mobility"] },
    ]);
    expect(listings.map((listing) => listing.empty)).toEqual([false, true]);
  });

  it("counts a publisher's tables and series, not the feeds they come from", () => {
    expect(buildPublishers(listings).map((publisher) => [publisher.id, publisher.listings.length])).toEqual([["carris-metropolitana", 2]]);
  });

  it("drops the publisher's name from a title under their own heading, and keeps a title that does not start with it", () => {
    const [vehicles] = listings;
    if (!vehicles) throw new Error("no listing");
    expect(withoutPublisher(vehicles)).toBe("Vehicles");
    expect(withoutPublisher({ ...vehicles, title: "Fuel types", publisher: { id: "dgeg", name: "DGEG · Direção-Geral de Energia e Geologia" } })).toBe("Fuel types");
    expect(withoutPublisher({ ...vehicles, title: "DGEG fuel types", publisher: { id: "dgeg", name: "DGEG · Direção-Geral de Energia e Geologia" } })).toBe("Fuel types");
  });
});
