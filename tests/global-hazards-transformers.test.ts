import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NormalizedRow, TransformContext } from "@open-data-pt/gatekeeper-shared";
import { AnepcTransformer } from "../packages/gatekeeper-shared/src/sources/anepc";
import { FirmsTransformer } from "../packages/gatekeeper-shared/src/sources/firms";
import { NasaPowerTransformer } from "../packages/gatekeeper-shared/src/sources/nasapower";
import { UsgsTransformer } from "../packages/gatekeeper-shared/src/sources/usgs";
import { WfsTransformer } from "../packages/gatekeeper-shared/src/formats/wfs";

function fixture(path: string): Uint8Array {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url));
}

function replacedFixture(path: string, from: string, to: string): Uint8Array {
  return new TextEncoder().encode(new TextDecoder().decode(fixture(path)).replaceAll(from, to));
}

function context(
  slug: string,
  config: Record<string, string>,
  domainSubject: "event" | "observation" | "feature",
  defaultProductRole: "event-log" | "time-series" | "reference",
): TransformContext {
  return {
    feed: { slug, title: `${slug} title`, description: `${slug} description`, config, semantics: { domainSubject, defaultProductRole } },
    observedAt: "2026-09-18T20:00:00Z",
  };
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

describe("global hazard normalizers", () => {
  it("normalizes ANEPC accidents and fires under their public occurrence numbers", () => {
    const result = new AnepcTransformer().transform(
      fixture("anepc/active-occurrences.json"),
      context("anepc-active-occurrences-feed", { feed: "active-occurrences" }, "event", "event-log"),
    );
    const records = result.products[0]?.records;
    expect(result.quality).toEqual({ acceptedRecords: 2, rejectedRecords: 0 });
    expect(result.products[0]).toMatchObject({ role: "event-log", updateMode: "authoritative-snapshot", watermark: "2026-09-18T17:12:00.000Z" });
    expect(records?.[0]).toMatchObject({
      entityKey: "20261330257",
      eventTime: "2026-09-18T17:07:00.000Z",
      payload: { natureCode: "2401", nature: "Atropelamento rodoviário", municipality: "Ponte de Lima", personnel: 2 },
    });
    expect(records?.[1]).toMatchObject({ entityKey: "20261330262", payload: { natureCode: "3103", classification: "Incêndios Rurais DECIR" } });
  });

  it("streams FIRMS pixels with acquisition clocks and stable source-local keys", async () => {
    const bytes = fixture("firms/hotspots.csv");
    const transform = await new FirmsTransformer().transform(
      new Response(bytes).body!,
      context("nasa-firms-mainland-thermal-anomalies-feed", { feed: "hotspots", region: "mainland", product: "VIIRS_SNPP_NRT" }, "event", "event-log"),
    );
    const rows: NormalizedRow[] = [];
    for await (const row of transform.rows) rows.push(row);
    const summary = transform.finish();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.record).toMatchObject({
      entityKey: "N|VIIRS|2026-09-18T13:25:00.000Z|40.12345|-8.54321",
      eventTime: "2026-09-18T13:25:00.000Z",
      payload: { brightness: 341.2, fireRadiativePower: 12.7, dayNight: "D" },
    });
    expect(summary).toEqual({
      quality: { acceptedRecords: 2, rejectedRecords: 0 },
      products: [{ productKey: "hotspots", watermark: "2026-09-18T13:25:00.000Z" }],
    });
  });

  it("normalizes USGS corrections and source clocks", () => {
    const result = new UsgsTransformer().transform(
      fixture("usgs/earthquakes.json"),
      context("usgs-mainland-portugal-earthquakes-feed", { feed: "earthquakes", region: "mainland", days: "30", minMagnitude: "1" }, "event", "event-log"),
    );
    expect(result.products[0]).toMatchObject({ role: "event-log", updateMode: "source-window" });
    expect(result.products[0]?.records?.[0]).toMatchObject({
      entityKey: "us7000pe8k",
      eventTime: "2025-02-17T13:24:04.559Z",
      sourcePublishedAt: "2025-05-02T16:26:20.040Z",
      payload: { magnitude: 4.8, depth: 10, latitude: 38.6301, longitude: -9.1842, status: "reviewed", tsunami: false },
    });
  });

  it("turns NASA POWER grid values into one series per source cell and omits fill values", () => {
    const result = new NasaPowerTransformer().transform(
      fixture("nasapower/daily-region.json"),
      context("nasa-power-mainland-solar-resource-feed", { feed: "daily-region", region: "mainland", parameter: "ALLSKY_SFC_SW_DWN", days: "30" }, "observation", "time-series"),
    );
    const product = result.products[0];
    expect(product).toMatchObject({ role: "time-series", updateMode: "source-window", watermark: "2026-09-16T00:00:00.000Z" });
    expect(product?.points).toHaveLength(5);
    expect(product?.points?.[0]).toEqual({
      seriesKey: "37.000,-9.375",
      eventTime: "2026-09-14T00:00:00.000Z",
      value: 5.12,
      unit: "kW-hr/m^2/day",
      dimensions: { parameter: "ALLSKY_SFC_SW_DWN", latitude: "37", longitude: "-9.375", elevationMetres: "1.46" },
    });
  });

  it("infers typed EFFIS attributes while retaining source geometry and clocks", () => {
    const transformer = new WfsTransformer();
    const transformContext = context("effis-portugal-recent-burnt-areas-feed", wfsConfig, "event", "event-log");
    const result = transformer.transform(fixture("wfs/effis-burnt-areas.json"), transformContext);
    const product = result.products[0];
    expect(product).toMatchObject({ role: "event-log", updateMode: "source-window", watermark: "2026-08-18T11:57:54.973Z" });
    expect(product?.schema.fields).toContainEqual(expect.objectContaining({ id: "AREA_HA", type: "number" }));
    expect(product?.schema.fields).toContainEqual(expect.objectContaining({ id: "FIREDATE", type: "datetime" }));
    expect(product?.records?.[0]).toMatchObject({
      entityKey: "888",
      eventTime: "2026-08-08T00:00:00.000Z",
      sourcePublishedAt: "2026-08-18T11:57:54.973Z",
      payload: { COUNTRY: "PT", AREA_HA: 26593, latitude: 40.85, longitude: -8.05 },
    });

    const blank = transformer.transform(replacedFixture("wfs/effis-burnt-areas.json", '"AREA_HA": "26593"', '"AREA_HA": "   "'), transformContext);
    expect(blank.products[0]?.records?.[0]?.payload.AREA_HA).toBeNull();
  });

  it("keeps a WFS reference layer whole and undated, with no outline to store", () => {
    const transformer = new WfsTransformer();
    const config = {
      feed: "reference",
      host: "api.sgifr.gov.pt",
      path: "/v1/wfs/AGIF/apps-subregionais",
      typeName: "apps:apps_adaptacao_subregional",
      idField: "id",
      numberFields: "area_ha,id_apps",
      dateFields: "data_aprovacao_publicacao",
    };
    const result = transformer.transform(fixture("wfs/sgifr-apps-subregionais.json"), context("sgifr-apps-subregionais-feed", config, "feature", "reference"));
    const product = result.products[0];
    // A standing inventory: every read replaces the last, and no feature carries an event time.
    expect(product).toMatchObject({ role: "reference", updateMode: "authoritative-snapshot" });
    expect(product?.watermark).toBeUndefined();
    expect(product?.records).toHaveLength(3);
    expect(product?.schema.fields).toContainEqual(expect.objectContaining({ id: "area_ha", type: "number" }));
    expect(product?.records?.[0]).toMatchObject({
      entityKey: "0104_1",
      // The source's own wording is kept verbatim, including where a column named for
      // one article carries the text of another: `art_60` here reads "Artigo 61.º".
      payload: { municipio: "Arouca", art_60: "Aplicam-se condicionamentos do Artigo 61.º", geometry: null },
    });
    expect(product?.records?.[0]?.eventTime).toBeUndefined();
    expect(result.quality).toMatchObject({ acceptedRecords: 3, rejectedRecords: 0 });
  });

  it("rejects out-of-range epochs and impossible source calendar dates", async () => {
    const anepc = new AnepcTransformer().transform(
      replacedFixture("anepc/active-occurrences.json", "1789751220000", "9007199254740991"),
      context("anepc-active-occurrences-feed", { feed: "active-occurrences" }, "event", "event-log"),
    );
    expect(anepc.quality).toEqual({ acceptedRecords: 1, rejectedRecords: 1 });

    const usgs = new UsgsTransformer().transform(
      replacedFixture("usgs/earthquakes.json", "1739798644559", "9007199254740991"),
      context("usgs-mainland-portugal-earthquakes-feed", { feed: "earthquakes", region: "mainland", days: "30", minMagnitude: "1" }, "event", "event-log"),
    );
    expect(usgs.quality).toEqual({ acceptedRecords: 0, rejectedRecords: 1 });

    const firms = await new FirmsTransformer().transform(
      new Response(replacedFixture("firms/hotspots.csv", "2026-09-18", "2026-02-30")).body!,
      context("nasa-firms-mainland-thermal-anomalies-feed", { feed: "hotspots", region: "mainland", product: "VIIRS_SNPP_NRT" }, "event", "event-log"),
    );
    const firmsRows: NormalizedRow[] = [];
    for await (const row of firms.rows) firmsRows.push(row);
    expect(firmsRows).toEqual([]);
    expect(firms.finish().quality).toEqual({ acceptedRecords: 0, rejectedRecords: 2 });

    const power = new NasaPowerTransformer().transform(
      replacedFixture("nasapower/daily-region.json", "20260914", "20260230"),
      context("nasa-power-mainland-solar-resource-feed", { feed: "daily-region", region: "mainland", parameter: "ALLSKY_SFC_SW_DWN", days: "30" }, "observation", "time-series"),
    );
    expect(power.products[0]?.points).toHaveLength(3);

    const wfs = new WfsTransformer().transform(
      replacedFixture("wfs/effis-burnt-areas.json", "2026-08-08 00:00:00", "2026-02-30 00:00:00"),
      context("effis-portugal-recent-burnt-areas-feed", wfsConfig, "event", "event-log"),
    );
    expect(wfs.quality).toEqual({ acceptedRecords: 0, rejectedRecords: 1 });
  });
});
