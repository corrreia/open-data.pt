import { readFixture } from "#/tests/support";
import { describe, expect, it } from "vitest";
import { isJsonArray, isJsonObject, parseJson, type JsonValue, type NormalizedRow } from "#/index";
import { RadioactivityTransformer } from "#/publishers/apa/radioactivity";

/** The gamma-in-air layer as SIRAD answered it: every station's latest reading. */
function savedFeatures(): JsonValue[] {
  const layer = parseJson(readFixture(new URL("./fixtures/sirad-gamma-air.geojson", import.meta.url)));
  if (!isJsonObject(layer) || !isJsonArray(layer.features)) throw new Error("The fixture is a feature collection");
  return layer.features;
}

/** The document the arcgis library hands a transform: the layer's description, then its features. */
function layerDocument(features: JsonValue[]): ReadableStream<Uint8Array> {
  const body = new Response(
    JSON.stringify({ type: "FeatureCollection", arcgis: { layerUrl: "https://sniambgeoogc.apambiente.pt/…/sirad/MapServer/1", name: "Radiação gama no ar" }, features }),
  ).body;
  if (!body) throw new Error("A response made from text has a body");
  return body;
}

describe("APA radioactivity readings", () => {
  it("puts each station's reading on its own series, dated by when it was measured, in the unit a person reads", async () => {
    const unknownUnit = { type: "Feature", properties: { id_estacao: 9999, nome_estacao: "Test", data_hora: 1790719200000, valor: 1, unidade: "rem" } };
    const impossibleTime = { type: "Feature", properties: { id_estacao: 9998, nome_estacao: "Test", data_hora: 1e20, valor: 1, unidade: "nsvh" } };
    const context = {
      feed: {
        slug: "apa-radioactivity-air-feed",
        title: "Test",
        description: "test feed",
        config: {},
        semantics: { domainSubject: "observation" as const, defaultProductRole: "time-series" as const },
      },
      observedAt: "2026-09-30T00:00:00.000Z",
    };
    const transform = await new RadioactivityTransformer().transform(layerDocument([...savedFeatures(), unknownUnit, impossibleTime]), context);
    const rows: NormalizedRow[] = [];
    for await (const row of transform.rows) rows.push(row);
    const points = rows.flatMap((row) => (row.point ? [row.point] : []));

    expect(points).toHaveLength(31);
    expect(new Set(points.map((point) => point.seriesKey)).size).toBe(31);
    // Meimoa, under maintenance, still shows its reading of 13 March 2025: the point keeps that time, not the poll's.
    expect(points).toContainEqual({ seriesKey: "1501", eventTime: "2025-03-13T15:00:00.000Z", value: 63, unit: "nSv/h", dimensions: { station: "1501", name: "Meimoa" } });
    // One reading in a unit it does not know and one at a time no date can hold cost only themselves.
    expect(transform.finish().quality).toEqual({ acceptedRecords: 31, rejectedRecords: 2 });
  });
});
