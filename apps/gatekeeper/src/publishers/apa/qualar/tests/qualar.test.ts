import { readFixture } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import { isJsonArray, isJsonObject, parseJson, runTransformer, type SourceFetch } from "#/index";
import { QUALAR_ORIGIN, QualarTransformer, collectQualarFeed } from "#/publishers/apa/qualar/index";

const AIR = { feed: "air-quality" };

/** QualAr's measurements as it answered them at 23:12 UTC on 29 September 2026; any other day is one with nothing yet. */
function qualar(answers: { "2026-09-29"?: string } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const date = new URL(input.toString()).searchParams.get("data") ?? "";
    if (date === "2026-09-29") return new Response(answers[date] ?? readFixture(new URL("./fixtures/medicoes-2026-09-29.json", import.meta.url)));
    return new Response(readFixture(new URL("./fixtures/medicoes-2026-09-30.json", import.meta.url)));
  });
}

async function collect(fetcher: ReturnType<typeof qualar>) {
  const fetched: SourceFetch = await collectQualarFeed(AIR, undefined, QUALAR_ORIGIN, fetcher, new Date("2026-09-29T23:30:00.000Z"));
  if (fetched.kind !== "body" || !(fetched.body instanceof Uint8Array)) throw new Error("QualAr hands over a buffered body");
  const context = {
    feed: {
      slug: "qualar-air-quality-feed",
      title: "Test",
      description: "test feed",
      config: AIR,
      semantics: { domainSubject: "observation" as const, defaultProductRole: "time-series" as const },
    },
    observedAt: "2026-09-29T23:30:00.000Z",
  };
  const result = await runTransformer(new QualarTransformer(), fetched.body, context);
  const product = result.products[0];
  if (product?.kind !== "series") throw new Error("Air quality is a series");
  return { points: product.points, quality: result.quality };
}

describe("QualAr air quality", () => {
  it("reads yesterday and today by the UTC calendar, and files each station's latest hour under station and pollutant", async () => {
    const fetcher = qualar();
    const { points, quality } = await collect(fetcher);

    // At 23:30 UTC it is already the 30th in Lisbon; QualAr's days are UTC's.
    expect(fetcher.mock.calls.map(([input]) => new URL(input.toString()).searchParams.get("data"))).toEqual(["2026-09-28", "2026-09-29"]);
    // Entrecampos's hour 21 of the 29th, which starts at 21:00 UTC.
    expect(points).toContainEqual({
      seriesKey: "3072:NO2",
      eventTime: "2026-09-29T21:00:00.000Z",
      value: 18,
      unit: "µg/m3",
      dimensions: { station: "3072", name: "Entrecampos", pollutant: "NO2", averaging: "1 h", validated: "yes", index: "1" },
    });
    expect(points).toContainEqual(expect.objectContaining({ seriesKey: "3072:CO", value: 0.381, unit: "mg/m3", dimensions: expect.objectContaining({ averaging: "8 h" }) }));
    // Its benzene had no value that hour ("N.D."): nothing is published for it, and nothing is counted as rejected.
    expect(points.some((point) => point.seriesKey === "3072:C6H6")).toBe(false);
    expect(quality).toEqual({ acceptedRecords: points.length, rejectedRecords: 0 });
  });

  it("publishes nothing under the wrong pollutant when the columns change order", async () => {
    const day = parseJson(readFixture(new URL("./fixtures/medicoes-2026-09-29.json", import.meta.url)));
    if (!isJsonObject(day) || !isJsonArray(day.colunas)) throw new Error("The fixture has its columns");
    const reordered = JSON.stringify({ ...day, colunas: day.colunas.toReversed() });
    const { points, quality } = await collect(qualar({ "2026-09-29": reordered }));

    // Only a column that stays in its place (the fourth of seven, SO2) still matches its readings.
    expect(new Set(points.map((point) => point.dimensions?.pollutant))).toEqual(new Set(["SO2"]));
    expect(quality.rejectedRecords).toBeGreaterThan(0);
  });
});
