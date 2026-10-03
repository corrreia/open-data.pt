import { readFixture } from "#/tests/support";
import { describe, expect, it } from "vitest";
import { collectNormalized, isJsonArray, isJsonObject, parseJson, runTransformer, type JsonValue, type SourceConfig } from "#/index";
import { PICASSO_ORIGIN, PicassoTransformer, collectPicassoFeed, picassoUrl, validatePicassoFeedConfig } from "#/publishers/fccn/picasso/index";
import { networkFrames, networkRequest } from "#/tests/networks-support";
import { feedCollection } from "#/tests/catalog";

const YEARLY: SourceConfig = { mode: "yearly" };
const DAILY: SourceConfig = { mode: "daily" };
/** Both charts as Picasso answered them on 3 October 2026, a little after 10:02 UTC. */
const saved = (name: "yearly" | "daily"): string => readFixture(new URL(`./fixtures/gigapix-${name}-2026-10-03.json`, import.meta.url));
const ANSWERED = "2026-10-03T10:02:09.000Z";

async function transform(config: SourceConfig, body: string, observedAt = ANSWERED) {
  const context = {
    feed: {
      slug: "fccn-gigapix-test-feed",
      title: "Test",
      description: "test feed",
      config,
      semantics: { domainSubject: "observation" as const, defaultProductRole: "time-series" as const },
    },
    observedAt,
  };
  const result = await runTransformer(new PicassoTransformer(), new TextEncoder().encode(body), context);
  const product = result.products[0];
  if (product?.kind !== "series") throw new Error("Picasso builds a series");
  return { product, points: product.points, quality: result.quality };
}

/** The saved answer with its rows replaced. */
function withValues(name: "yearly" | "daily", values: JsonValue[]): string {
  const root = parseJson(saved(name));
  if (!isJsonObject(root) || !isJsonArray(root.series) || !isJsonObject(root.series[0])) throw new Error("The fixture has its series");
  return JSON.stringify({ ...root, series: [{ ...root.series[0], values }] });
}

describe("Picasso configuration", () => {
  it("reads only the yearly and daily GigaPIX charts, by the query their own script makes", () => {
    expect(validatePicassoFeedConfig({ mode: " daily " })).toEqual(DAILY);
    for (const config of [{}, { mode: "weekly" }, { mode: "hourly" }, { ...DAILY, q: "rcts" }, { ...DAILY, host: "evil.test" }])
      expect(() => validatePicassoFeedConfig(config)).toThrow();
    expect(picassoUrl(YEARLY, PICASSO_ORIGIN).href).toBe("https://picasso.netop.fccn.pt/api/data/query?db=ixp-hist&q=gigapix&m=yearly&p=");
    expect(picassoUrl(DAILY, PICASSO_ORIGIN).href).toBe("https://picasso.netop.fccn.pt/api/data/query?db=ixp&q=gigapix&m=daily&p=");
    expect(() => picassoUrl(DAILY, "https://picasso.netop.fccn.pt.evil.test")).toThrow();
  });

  it("passes on Retry-After, and keeps no validators the source never states", async () => {
    await expect(collectPicassoFeed(DAILY, PICASSO_ORIGIN, async () => new Response("busy", { status: 503, headers: { "Retry-After": "60" } }))).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: 60,
    });
    await expect(collectPicassoFeed(DAILY, PICASSO_ORIGIN, async () => new Response("{}", { headers: { "Content-Length": String(1024 * 1024) } }))).rejects.toMatchObject({
      code: "response-too-large",
    });
    expect(await collectPicassoFeed(DAILY, PICASSO_ORIGIN, async () => new Response(saved("daily")))).toMatchObject({
      kind: "body",
      completeness: "complete",
      state: {},
      provenance: { sourceUrl: "https://gigapix.pt/en/technical/estatisticas-de-trafego/" },
    });
  });
});

describe("GigaPIX traffic", () => {
  it("publishes each ended day's peak, dated by the day, and leaves today and the days without a value out", async () => {
    const { product, points, quality } = await transform(YEARLY, saved("yearly"));
    // 366 days from 3 October 2025, today's left for tomorrow, and the 21st and 25th of October with no value.
    expect(points).toHaveLength(366 - 1 - 2);
    expect(points.at(-1)).toEqual({
      seriesKey: "gigapix",
      eventTime: "2026-10-02T00:00:00.000Z",
      value: 320404245079.004,
      unit: "bit/s",
      dimensions: { statistic: "daily maximum" },
    });
    expect(points.some((point) => point.eventTime === "2025-10-21T00:00:00.000Z")).toBe(false);
    expect(product).toMatchObject({
      productKey: "daily-peak",
      slug: "fccn-gigapix-test",
      updateMode: "source-window",
      completeness: "complete",
      watermark: "2026-10-02T00:00:00.000Z",
    });
    expect(quality).toEqual({ acceptedRecords: 363, rejectedRecords: 0 });
  });

  it("publishes each ended five minutes, and leaves the five under way for the next collection", async () => {
    const { product, points } = await transform(DAILY, saved("daily"));
    // 288 five-minute means from 10:05 the day before; the one from 10:00, two minutes old, is still being filled.
    expect(points).toHaveLength(287);
    expect(points[0]).toEqual({
      seriesKey: "gigapix",
      eventTime: "2026-10-02T10:05:00.000Z",
      value: 249713560382.33765,
      unit: "bit/s",
      dimensions: { statistic: "5-minute mean" },
    });
    expect(points.at(-1)?.eventTime).toBe("2026-10-03T09:55:00.000Z");
    expect(product.productKey).toBe("traffic");
    // Once the five minutes have ended, the same answer publishes them too.
    expect((await transform(DAILY, saved("daily"), "2026-10-03T10:05:00.000Z")).points).toHaveLength(288);
  });

  it("refuses an answer that is not the chart it asked for", async () => {
    await expect(transform(DAILY, saved("yearly"))).rejects.toMatchObject({ code: "invalid-response" });
    await expect(transform(DAILY, '{"statement_id":0}')).rejects.toMatchObject({ code: "invalid-response" });
    await expect(transform(DAILY, "<html>")).rejects.toMatchObject({ code: "invalid-response" });
    await expect(transform(DAILY, withValues("daily", [["2026-10-03T09:57:00Z", 1]]))).rejects.toMatchObject({ code: "invalid-response" });
    await expect(transform(DAILY, withValues("daily", [["2026-10-03T09:55:00Z", "1"]]))).rejects.toMatchObject({ code: "invalid-response" });
    await expect(transform(DAILY, withValues("daily", [["2026-10-03T09:55:00Z", -1]]))).rejects.toMatchObject({ code: "invalid-response" });
    const tooMany = Array.from({ length: 400 }, (_, index) => [new Date(Date.parse("2026-10-01T00:00:00Z") + index * 300_000).toISOString().replace(".000", ""), 1]);
    await expect(transform(DAILY, withValues("daily", tooMany))).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("frames a whole collection the way the kernel reads it", async () => {
    const asked: string[] = [];
    const { collector } = await feedCollection("fccn-gigapix-traffic-feed", {
      fetcher: async (input) => {
        asked.push(input.toString());
        return new Response(saved("daily"));
      },
    });
    const request = await networkRequest(collector);
    request.observedAt = ANSWERED;
    const frames = await networkFrames(await collectNormalized(request, collector));
    expect(asked).toEqual(["https://picasso.netop.fccn.pt/api/data/query?db=ixp&q=gigapix&m=daily&p="]);
    const header = frames[0];
    if (header?.type !== "header") throw new Error("No header");
    expect(header.products.map((product) => product.slug)).toEqual(["fccn-gigapix-traffic"]);
    expect(frames.filter((frame) => frame.type === "point")).toHaveLength(287);
    const complete = frames.at(-1);
    if (complete?.type !== "complete") throw new Error("No completion frame");
    expect(complete.quality.rejectedRecords).toBe(0);
  });
});
