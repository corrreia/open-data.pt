import { jsonAs, readFixture } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import type { JsonValue } from "@open-data-pt/contract";
import { collectWfsFeed, validateWfsFeedConfig } from "#/formats/wfs/index";

/** The features of a saved WFS answer, to serve back a page at a time. */
function features(name: string): JsonValue[] {
  return jsonAs<{ features: JsonValue[] }>(readFixture(new URL(`./fixtures/${name}`, import.meta.url))).features;
}

const wfsConfig = {
  feed: "events",
  host: "maps.effis.emergency.copernicus.eu",
  path: "/effis",
  typeName: "ms:modis.ba.poly",
  idField: "id",
  eventTimeField: "FIREDATE",
  sourcePublishedAtField: "LASTUPDATE",
  countryField: "COUNTRY",
  countryValue: "PT",
  dateField: "FIREDATE",
  numberFields: "AREA_HA,BROADLEA,CONIFER,MIXED,PERCNA2K",
  dateFields: "FIREDATE,FINALDATE,LASTUPDATE",
  days: "180",
};

const SGIFR_HOSTS = new Set(["api.sgifr.gov.pt"]);

const wfsReferenceConfig = {
  feed: "reference",
  host: "api.sgifr.gov.pt",
  path: "/v1/wfs/AGIF/apps-subregionais",
  typeName: "apps:apps_adaptacao_subregional",
  idField: "id",
  propertyNames: "id,municipio,area_ha,art_60,data_aprovacao_publicacao",
  numberFields: "area_ha,id_apps",
  dateOnlyFields: "data_aprovacao_publicacao",
};

const now = new Date("2026-09-18T20:00:00Z");

describe("WFS source boundary", () => {
  it("rejects a caller-controlled host or path", () => {
    expect(() => validateWfsFeedConfig({ ...wfsConfig, host: "evil.example" }, new Set(["maps.effis.emergency.copernicus.eu"]))).toThrow(
      expect.objectContaining({ code: "source-denied" }),
    );
    expect(() => validateWfsFeedConfig({ ...wfsConfig, path: "//evil.example/effis" }, new Set(["maps.effis.emergency.copernicus.eu"]))).toThrow(
      expect.objectContaining({ code: "invalid-config" }),
    );
  });

  it("rejects a malformed upstream response", async () => {
    await expect(collectWfsFeed(wfsConfig, undefined, new Set(["maps.effis.emergency.copernicus.eu"]), async () => new Response("<invalid/>"), now)).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it("filters and pages an OGC WFS collection before normalizing it", async () => {
    const burnt = features("effis-burnt-areas.json");
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.origin).toBe("https://maps.effis.emergency.copernicus.eu");
      const filter = url.searchParams.get("FILTER") ?? "";
      expect(filter).toContain("<ogc:Literal>PT</ogc:Literal>");
      expect(filter).toContain("<ogc:Literal>2026-03-22</ogc:Literal>");
      if (url.searchParams.get("resultType") === "hits") return new Response('<wfs:FeatureCollection numberOfFeatures="1"></wfs:FeatureCollection>');
      expect(url.searchParams.get("startIndex")).toBe("0");
      expect(url.searchParams.get("maxFeatures")).toBe("1");
      return new Response(JSON.stringify({ type: "FeatureCollection", features: burnt }));
    });
    const fetched = await collectWfsFeed(wfsConfig, undefined, new Set(["maps.effis.emergency.copernicus.eu"]), fetcher, now);
    expect(fetched).toMatchObject({ kind: "body", completeness: "complete", validator: { etag: expect.stringMatching(/^"sha256-/u) } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("normalizes a reference layer and refuses the event window's fields", () => {
    expect(validateWfsFeedConfig(wfsReferenceConfig, SGIFR_HOSTS)).toEqual({
      feed: "reference",
      host: "api.sgifr.gov.pt",
      path: "/v1/wfs/AGIF/apps-subregionais",
      typeName: "apps:apps_adaptacao_subregional",
      idField: "id",
      propertyNames: "area_ha,art_60,data_aprovacao_publicacao,id,municipio",
      numberFields: "area_ha,id_apps",
      dateOnlyFields: "data_aprovacao_publicacao",
    });
    // A reference layer has no window to filter, so the event fields are not its to carry.
    expect(() => validateWfsFeedConfig({ ...wfsReferenceConfig, days: "180" }, SGIFR_HOSTS)).toThrow("Unsupported WFS field: days");
    expect(() => validateWfsFeedConfig({ ...wfsReferenceConfig, host: "evil.example" }, SGIFR_HOSTS)).toThrow("The WFS host is not allowed");
    expect(() => validateWfsFeedConfig({ ...wfsReferenceConfig, url: "https://evil.example" }, SGIFR_HOSTS)).toThrow("Unsupported WFS field: url");
  });

  it("walks a whole reference layer, asking only for the attributes it keeps", async () => {
    const plans = features("sgifr-apps-subregionais.json");
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.origin).toBe("https://api.sgifr.gov.pt");
      // Nothing is filtered: the layer is the product.
      expect(url.searchParams.get("FILTER")).toBeNull();
      if (url.searchParams.get("resultType") === "hits") return new Response('<wfs:FeatureCollection numberOfFeatures="3"></wfs:FeatureCollection>');
      // GeoServer answers to the media type, and the outlines are never asked for.
      expect(url.searchParams.get("outputFormat")).toBe("application/json");
      expect(url.searchParams.get("propertyName")).toBe("area_ha,art_60,data_aprovacao_publicacao,id,municipio");
      expect(url.searchParams.get("sortBy")).toBe("id");
      expect(url.searchParams.get("startIndex")).toBe("0");
      return new Response(JSON.stringify({ type: "FeatureCollection", features: plans }));
    });
    const fetched = await collectWfsFeed(wfsReferenceConfig, undefined, SGIFR_HOSTS, fetcher, now);
    expect(fetched).toMatchObject({ kind: "body", completeness: "complete", validator: { etag: expect.stringMatching(/^"sha256-/u) } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops a reference page that comes back short rather than publishing a hole", async () => {
    const plans = features("sgifr-apps-subregionais.json");
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      if (url.searchParams.get("resultType") === "hits") return new Response('<wfs:FeatureCollection numberOfFeatures="9"></wfs:FeatureCollection>');
      return new Response(JSON.stringify({ type: "FeatureCollection", features: plans }));
    });
    await expect(collectWfsFeed(wfsReferenceConfig, undefined, SGIFR_HOSTS, fetcher, now)).rejects.toMatchObject({ code: "upstream-error" });
  });
});
