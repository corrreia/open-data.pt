import { readFixture } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import { isJsonArray, isJsonObject, parseJson, runTransformer, type JsonObject, type SourceBody } from "#/index";
import { QUALAR_ORIGIN, QualarTransformer, collectQualarFeed } from "#/publishers/apa/qualar/index";

const AIR = { feed: "air-quality" };
const saved = (name: string): string => readFixture(new URL(`./fixtures/${name}`, import.meta.url));

/**
 * QualAr as it answered: the 29th while it was under way (`medicoes`), and Entrecampos's 24 hours of the 28th
 * (`dados`). Every other station's day fails, as one that does not answer.
 */
function qualar(answers: { latest?: string } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const query = new URL(input.toString()).searchParams;
    if (query.get("type") === "medicoes") return new Response(answers.latest ?? saved("medicoes-2026-09-29.json"));
    if (query.get("type") === "dados" && query.get("estacao_id") === "3072") return new Response(saved("dados-3072-2026-09-28.json"));
    return new Response("down", { status: 502 });
  });
}

const asked = (fetcher: ReturnType<typeof qualar>): string[] =>
  fetcher.mock.calls.map(([input]) => {
    const query = new URL(input.toString()).searchParams;
    return [query.get("type"), query.get("data"), query.get("estacao_id")].filter((part) => part !== null).join(" ");
  });

async function collect(fetcher: ReturnType<typeof qualar>, now: string, state?: JsonObject) {
  const fetched = await collectQualarFeed(AIR, state, QUALAR_ORIGIN, fetcher, new Date(now));
  if (fetched.kind !== "body" || !(fetched.body instanceof Uint8Array)) throw new Error("QualAr hands over a buffered body");
  const body: SourceBody = fetched;
  const context = {
    feed: {
      slug: "qualar-air-quality-feed",
      title: "Test",
      description: "test feed",
      config: AIR,
      semantics: { domainSubject: "observation" as const, defaultProductRole: "time-series" as const },
    },
    observedAt: now,
  };
  const result = await runTransformer(new QualarTransformer(), fetched.body, context);
  const product = result.products[0];
  if (product?.kind !== "series") throw new Error("Air quality is a series");
  return { fetched: body, points: product.points, quality: result.quality };
}

describe("QualAr air quality", () => {
  it("reads, every hour, each station's latest hour of the day under way by the UTC calendar", async () => {
    const fetcher = qualar();
    // At 23:30 UTC it is already the 30th in Lisbon; QualAr's days are UTC's. The 28th was read whole earlier.
    const { points, quality } = await collect(fetcher, "2026-09-29T23:30:00.000Z", { sweptDay: "2026-09-28" });

    expect(asked(fetcher)).toEqual(["medicoes 2026-09-29"]);
    // Entrecampos's hour 21 of the 29th, which starts at 21:00 UTC.
    expect(points).toContainEqual({
      seriesKey: "3072:NO2",
      eventTime: "2026-09-29T21:00:00.000Z",
      value: 18,
      unit: "µg/m3",
      dimensions: { station: "3072", name: "Entrecampos", pollutant: "NO2", averaging: "1 h", index: "1" },
    });
    expect(points).toContainEqual(expect.objectContaining({ seriesKey: "3072:CO", value: 0.381, unit: "mg/m3", dimensions: expect.objectContaining({ averaging: "8 h" }) }));
    // Its benzene had no value that hour ("N.D."): nothing is published for it, and nothing is counted as rejected.
    expect(points.some((point) => point.seriesKey === "3072:C6H6")).toBe(false);
    expect(quality.rejectedRecords).toBe(0);
  });

  it("reads the day before whole, station by station, once it has settled, and remembers having done so", async () => {
    // The last hours of a day reach QualAr about two hours late: at 01:00 the day before is not read yet.
    const early = qualar();
    await collect(early, "2026-09-29T01:00:00.000Z");
    expect(asked(early)).toEqual(["medicoes 2026-09-29"]);

    const fetcher = qualar();
    const { fetched, points } = await collect(fetcher, "2026-09-29T03:10:00.000Z");
    expect(asked(fetcher)).toHaveLength(73);
    expect(asked(fetcher)).toContain("dados 2026-09-28 3072");
    // Entrecampos's morning rush of the 28th, and its every hour; the 71 stations that did not answer cost only themselves.
    expect(points).toContainEqual({
      seriesKey: "3072:NO2",
      eventTime: "2026-09-28T07:00:00.000Z",
      value: 69,
      unit: "µg/m3",
      dimensions: { station: "3072", name: "Entrecampos", pollutant: "NO2", averaging: "1 h", index: "2" },
    });
    expect(points.filter((point) => point.seriesKey === "3072:NO2" && point.eventTime.startsWith("2026-09-28"))).toHaveLength(24);
    expect(fetched.completeness).toBe("partial");
    expect(fetched.state).toMatchObject({ sweptDay: "2026-09-28" });

    const later = qualar();
    await collect(later, "2026-09-29T04:10:00.000Z", fetched.state);
    expect(asked(later)).toEqual(["medicoes 2026-09-29"]);
  });

  it("takes nothing from a day QualAr has closed, which it answers with maxima and daily means", async () => {
    // The 28th as QualAr answered it on the 30th: each pollutant's maximum, and particles' daily mean under hour 0.
    const { points, quality } = await collect(qualar({ latest: saved("medicoes-2026-09-28.json") }), "2026-09-29T23:30:00.000Z", { sweptDay: "2026-09-28" });

    expect(points).toEqual([]);
    expect(quality.rejectedRecords).toBe(0);
  });

  it("publishes nothing under the wrong pollutant when the columns change order", async () => {
    const day = parseJson(saved("medicoes-2026-09-29.json"));
    if (!isJsonObject(day) || !isJsonArray(day.colunas)) throw new Error("The fixture has its columns");
    const reordered = JSON.stringify({ ...day, colunas: day.colunas.toReversed() });
    const { points, quality } = await collect(qualar({ latest: reordered }), "2026-09-29T23:30:00.000Z", { sweptDay: "2026-09-28" });

    // Only a column that stays in its place (the fourth of seven, SO2) still matches its readings.
    expect(new Set(points.map((point) => point.dimensions?.pollutant))).toEqual(new Set(["SO2"]));
    expect(quality.rejectedRecords).toBeGreaterThan(0);
  });
});
