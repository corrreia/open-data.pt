import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ANEPC_API_ORIGIN, collectAnepcFeed, validateAnepcFeedConfig } from "../packages/gatekeeper-shared/src/sources/anepc";
import { FIRMS_API_ORIGIN, collectFirmsFeed, validateFirmsFeedConfig } from "../packages/gatekeeper-shared/src/sources/firms";
import { NASA_POWER_API_ORIGIN, collectNasaPowerFeed, validateNasaPowerFeedConfig } from "../packages/gatekeeper-shared/src/sources/nasapower";
import { USGS_API_ORIGIN, collectUsgsFeed, validateUsgsFeedConfig } from "../packages/gatekeeper-shared/src/sources/usgs";
import { collectWfsFeed, validateWfsFeedConfig } from "../packages/gatekeeper-shared/src/formats/wfs";

function fixture(path: string): Uint8Array {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url));
}

function body(bytes: Uint8Array, type = "application/json"): Response {
  return new Response(bytes, { headers: { "content-type": type } });
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
  dateFields: "data_aprovacao_publicacao",
};

const now = new Date("2026-09-18T20:00:00Z");

describe("global hazard source boundaries", () => {
  it("normalizes fixed configurations and rejects caller-controlled sources", () => {
    expect(validateAnepcFeedConfig({ feed: "active-occurrences" })).toEqual({ feed: "active-occurrences" });
    expect(validateFirmsFeedConfig({ feed: "hotspots", region: "mainland", product: "VIIRS_SNPP_NRT" })).toEqual({
      feed: "hotspots",
      region: "mainland",
      product: "VIIRS_SNPP_NRT",
    });
    expect(validateUsgsFeedConfig({ feed: "earthquakes", region: "azores", days: "030", minMagnitude: "1.0" })).toEqual({
      feed: "earthquakes",
      region: "azores",
      days: "30",
      minMagnitude: "1",
    });
    expect(validateNasaPowerFeedConfig({ feed: "daily-region", region: "madeira", parameter: "ALLSKY_SFC_SW_DWN", days: "030" })).toEqual({
      feed: "daily-region",
      region: "madeira",
      parameter: "ALLSKY_SFC_SW_DWN",
      days: "30",
    });
    expect(() => validateAnepcFeedConfig({ feed: "active-occurrences", host: "evil.example" })).toThrow(expect.objectContaining({ code: "source-denied" }));
    expect(() => validateWfsFeedConfig({ ...wfsConfig, host: "evil.example" }, new Set(["maps.effis.emergency.copernicus.eu"]))).toThrow(
      expect.objectContaining({ code: "source-denied" }),
    );
    expect(() => validateWfsFeedConfig({ ...wfsConfig, path: "//evil.example/effis" }, new Set(["maps.effis.emergency.copernicus.eu"]))).toThrow(
      expect.objectContaining({ code: "invalid-config" }),
    );
  });

  it("collects the ANEPC authoritative snapshot without treating its wrapper clock as a record change", async () => {
    let requests = 0;
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.origin).toBe(ANEPC_API_ORIGIN);
      expect(url.searchParams.get("where")).toBe("1=1");
      expect(url.searchParams.get("resultRecordCount")).toBe("2000");
      const original = new TextDecoder().decode(fixture("anepc/active-occurrences.json"));
      requests += 1;
      const response = requests === 1 ? original : original.replaceAll("1789755840000", "1789755900000");
      return new Response(response, { headers: { "content-type": "application/geo+json" } });
    });
    const fetched = await collectAnepcFeed({ feed: "active-occurrences" }, undefined, ANEPC_API_ORIGIN, fetcher);
    expect(fetched).toMatchObject({
      kind: "body",
      completeness: "complete",
      provenance: { sourcePublishedAt: "2026-09-18T18:24:00.000Z" },
      validator: { etag: expect.stringMatching(/^"sha256-/u) },
    });
    if (fetched.kind !== "body") throw new Error("Expected ANEPC source body");
    await expect(collectAnepcFeed({ feed: "active-occurrences" }, fetched.validator, ANEPC_API_ORIGIN, fetcher)).resolves.toEqual({
      kind: "not-modified",
      validator: fetched.validator,
    });
  });

  it("keeps the FIRMS map key out of provenance", async () => {
    const mapKey = "test_map_key_1234";
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      expect(input.toString()).toContain(`/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/-9.6,36.8,-6.1,42.2/5`);
      return body(fixture("firms/hotspots.csv"), "text/csv");
    });
    const fetched = await collectFirmsFeed({ feed: "hotspots", region: "mainland", product: "VIIRS_SNPP_NRT" }, FIRMS_API_ORIGIN, mapKey, fetcher);
    expect(fetched).toMatchObject({ kind: "body", completeness: "complete", provenance: { sourceUrl: `${FIRMS_API_ORIGIN}/api/area/` }, state: {} });
    if (fetched.kind !== "body") throw new Error("Expected FIRMS source body");
    expect(fetched.provenance.sourceUrl).not.toContain(mapKey);
  });

  it("builds bounded rolling USGS and NASA POWER requests", async () => {
    const usgsFetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.searchParams.get("starttime")).toBe("2026-08-19T20:00:00.000Z");
      expect(url.searchParams.get("endtime")).toBe("2026-09-18T20:00:00.000Z");
      expect(url.searchParams.get("minlatitude")).toBe("36.8");
      return body(fixture("usgs/earthquakes.json"), "application/geo+json");
    });
    await expect(collectUsgsFeed({ feed: "earthquakes", region: "mainland", days: "30", minMagnitude: "1" }, undefined, USGS_API_ORIGIN, usgsFetcher, now)).resolves.toMatchObject({
      kind: "body",
      completeness: "complete",
    });

    const powerFetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.searchParams.get("start")).toBe("20260522");
      expect(url.searchParams.get("end")).toBe("20260620");
      expect(url.searchParams.get("time-standard")).toBe("UTC");
      return body(fixture("nasapower/daily-region.json"));
    });
    await expect(
      collectNasaPowerFeed({ feed: "daily-region", region: "mainland", parameter: "ALLSKY_SFC_SW_DWN", days: "30" }, undefined, NASA_POWER_API_ORIGIN, powerFetcher, now),
    ).resolves.toMatchObject({ kind: "body", completeness: "complete" });
  });

  it("rejects truncated, malformed and failed upstream responses", async () => {
    await expect(
      collectAnepcFeed(
        { feed: "active-occurrences" },
        undefined,
        ANEPC_API_ORIGIN,
        async () => new Response(JSON.stringify({ type: "FeatureCollection", properties: { exceededTransferLimit: true }, features: [] })),
      ),
    ).rejects.toMatchObject({ code: "upstream-error" });
    await expect(
      collectFirmsFeed(
        { feed: "hotspots", region: "mainland", product: "VIIRS_SNPP_NRT" },
        FIRMS_API_ORIGIN,
        "test_map_key_1234",
        async () => new Response("unavailable", { status: 503, headers: { "retry-after": "60" } }),
      ),
    ).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 60 });
    await expect(
      collectUsgsFeed({ feed: "earthquakes", region: "mainland", days: "30", minMagnitude: "1" }, undefined, USGS_API_ORIGIN, async () => new Response("not-json"), now),
    ).rejects.toMatchObject({ code: "invalid-response" });
    await expect(
      collectNasaPowerFeed(
        { feed: "daily-region", region: "mainland", parameter: "ALLSKY_SFC_SW_DWN", days: "30" },
        undefined,
        NASA_POWER_API_ORIGIN,
        async () => new Response("not-json"),
        now,
      ),
    ).rejects.toMatchObject({ code: "invalid-response" });
    await expect(collectWfsFeed(wfsConfig, undefined, new Set(["maps.effis.emergency.copernicus.eu"]), async () => new Response("<invalid/>"), now)).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it("filters and pages an OGC WFS collection before normalizing it", async () => {
    const features = JSON.parse(new TextDecoder().decode(fixture("wfs/effis-burnt-areas.json"))).features;
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.origin).toBe("https://maps.effis.emergency.copernicus.eu");
      const filter = url.searchParams.get("FILTER") ?? "";
      expect(filter).toContain("<ogc:Literal>PT</ogc:Literal>");
      expect(filter).toContain("<ogc:Literal>2026-03-22</ogc:Literal>");
      if (url.searchParams.get("resultType") === "hits") return new Response('<wfs:FeatureCollection numberOfFeatures="1"></wfs:FeatureCollection>');
      expect(url.searchParams.get("startIndex")).toBe("0");
      expect(url.searchParams.get("maxFeatures")).toBe("1");
      return new Response(JSON.stringify({ type: "FeatureCollection", features }));
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
      dateFields: "data_aprovacao_publicacao",
    });
    // A reference layer has no window to filter, so the event fields are not its to carry.
    expect(() => validateWfsFeedConfig({ ...wfsReferenceConfig, days: "180" }, SGIFR_HOSTS)).toThrow("Unsupported WFS field: days");
    expect(() => validateWfsFeedConfig({ ...wfsReferenceConfig, host: "evil.example" }, SGIFR_HOSTS)).toThrow("The WFS host is not allowed");
    expect(() => validateWfsFeedConfig({ ...wfsReferenceConfig, url: "https://evil.example" }, SGIFR_HOSTS)).toThrow("Unsupported WFS field: url");
  });

  it("walks a whole reference layer, asking only for the attributes it keeps", async () => {
    const features = JSON.parse(new TextDecoder().decode(fixture("wfs/sgifr-apps-subregionais.json"))).features;
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
      return new Response(JSON.stringify({ type: "FeatureCollection", features }));
    });
    const fetched = await collectWfsFeed(wfsReferenceConfig, undefined, SGIFR_HOSTS, fetcher, now);
    expect(fetched).toMatchObject({ kind: "body", completeness: "complete", validator: { etag: expect.stringMatching(/^"sha256-/u) } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops a reference page that comes back short rather than publishing a hole", async () => {
    const features = JSON.parse(new TextDecoder().decode(fixture("wfs/sgifr-apps-subregionais.json"))).features;
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      if (url.searchParams.get("resultType") === "hits") return new Response('<wfs:FeatureCollection numberOfFeatures="9"></wfs:FeatureCollection>');
      return new Response(JSON.stringify({ type: "FeatureCollection", features }));
    });
    await expect(collectWfsFeed(wfsReferenceConfig, undefined, SGIFR_HOSTS, fetcher, now)).rejects.toMatchObject({ code: "upstream-error" });
  });
});
