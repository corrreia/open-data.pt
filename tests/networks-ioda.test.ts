import { describe, expect, it } from "vitest";
import { collectNormalized, libraryConfig, type JsonObject, type SourceConfig } from "../apps/gatekeeper/src/index";
import { IODA_HOST, IODA_MAX_BYTES, collectIodaFeed, iodaUrl, validateIodaFeedConfig } from "../apps/gatekeeper/src/publishers/ioda/ioda/ioda";
import { IodaTransformer } from "../apps/gatekeeper/src/publishers/ioda/ioda/transform";
import { networkContext, networkFixture, networkFrames, networkRequest, object } from "./networks-support";
import { datasetOf, feedCollection, feedsOf } from "./catalog";

const EVENTS: SourceConfig = { feed: "outage-events", entityType: "country", entityCode: "PT", days: "7" };
const ALERTS: SourceConfig = { feed: "outage-alerts", entityType: "country", entityCode: "PT", days: "7" };
const ASN_SIGNALS: SourceConfig = { feed: "signals", entityType: "asn", entityCode: "3243", hours: "3" };
const COUNTRY_SIGNALS: SourceConfig = { feed: "signals", entityType: "country", entityCode: "PT", hours: "3" };
const HOSTS = new Set([IODA_HOST]);
/** 2026-09-18T01:00:37Z, deliberately off IODA's five-minute grid. */
const NOW = new Date("2026-09-18T01:00:37Z");
const transformer = new IodaTransformer();

function transform(config: SourceConfig, document: JsonObject) {
  return transformer.transform(new TextEncoder().encode(JSON.stringify(document)), networkContext(config));
}

/** The one product a feed builds, with its rows. */
function product(config: SourceConfig, fixture: string) {
  const result = transform(config, networkFixture(fixture));
  const only = result.products[0];
  if (!only) throw new Error("No product");
  return { product: only, quality: result.quality, records: only.records ?? [], points: only.points ?? [] };
}

describe("IODA configuration and boundaries", () => {
  it("accepts only named feeds, Portuguese entities and bounded windows", () => {
    expect(validateIodaFeedConfig({ feed: "outage-events", entityCode: "pt" })).toEqual({ feed: "outage-events", entityType: "country", entityCode: "PT", days: "7" });
    expect(validateIodaFeedConfig({ feed: "signals", entityType: "asn", entityCode: "AS12353" })).toEqual({ feed: "signals", entityType: "asn", entityCode: "12353", hours: "3" });
    for (const config of [
      { feed: "outages", entityCode: "PT" },
      { ...EVENTS, entityCode: "ES" },
      { ...EVENTS, entityType: "region" },
      { ...EVENTS, datasource: "bgp" },
      { ...EVENTS, hours: "3" },
      { ...EVENTS, days: "0" },
      { ...EVENTS, days: "31" },
      { ...EVENTS, days: "2.5" },
      { ...ASN_SIGNALS, hours: "25" },
      { ...ASN_SIGNALS, days: "1" },
      // Not Portuguese networks: Deutsche Telekom, Telefónica, a syntactic near-miss and an AS that is not a number.
      { ...ASN_SIGNALS, entityCode: "3320" },
      { ...ASN_SIGNALS, entityCode: "3352" },
      { ...ASN_SIGNALS, entityCode: "32430" },
      { ...ASN_SIGNALS, entityCode: "3243/path" },
      { ...ASN_SIGNALS, entityCode: "" },
    ])
      expect(() => validateIodaFeedConfig(config)).toThrow();
  });

  it("builds one aligned, bounded window per feed rather than IODA's widened default", () => {
    const events = iodaUrl(EVENTS, IODA_HOST, NOW);
    expect(events.origin).toBe(`https://${IODA_HOST}`);
    expect(events.pathname).toBe("/v2/outages/events");
    // 2026-09-18T01:00:37Z floored to the five-minute grid, and seven days before it.
    expect(events.searchParams.get("until")).toBe("1789693200");
    expect(events.searchParams.get("from")).toBe("1789088400");
    expect(events.searchParams.get("entityCode")).toBe("PT");
    expect(events.searchParams.get("extendWindow")).toBe("0");
    expect(events.searchParams.get("limit")).toBe("500");
    const signals = iodaUrl(ASN_SIGNALS, IODA_HOST, NOW);
    expect(signals.pathname).toBe("/v2/signals/raw/asn/3243");
    expect(signals.searchParams.get("from")).toBe("1789682400");
    expect(signals.searchParams.get("until")).toBe("1789693200");
    expect(signals.searchParams.has("extendWindow")).toBe(false);
  });

  it("refuses hosts it was not given, redirects and history walks", async () => {
    await expect(collectIodaFeed(EVENTS, new Set(["stat.ripe.net"]), fetch, { kind: "live" }, NOW)).rejects.toMatchObject({ code: "source-denied" });
    let requests = 0;
    const redirecting: typeof fetch = async (_input, init) => {
      requests += 1;
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { Location: "https://evil.test" } });
    };
    await expect(collectIodaFeed(EVENTS, HOSTS, redirecting, { kind: "live" }, NOW)).rejects.toMatchObject({ code: "source-denied" });
    expect(requests).toBe(1);
    await expect(collectIodaFeed(EVENTS, HOSTS, fetch, { kind: "history", cursor: { before: "2026-01-01T00:00:00Z" } }, NOW)).rejects.toMatchObject({ code: "invalid-config" });
  });

  it("preserves Retry-After, bounds declared bytes and carries no validators across a moving window", async () => {
    await expect(collectIodaFeed(EVENTS, HOSTS, async () => new Response("busy", { status: 429, headers: { "Retry-After": "120" } }), { kind: "live" }, NOW)).rejects.toMatchObject(
      { code: "upstream-error", retryAfterSeconds: 120 },
    );
    await expect(
      collectIodaFeed(EVENTS, HOSTS, async () => new Response("{}", { headers: { "Content-Length": String(IODA_MAX_BYTES + 1) } }), { kind: "live" }, NOW),
    ).rejects.toMatchObject({ code: "response-too-large" });
    const fetcher: typeof fetch = async (_input, init) => {
      expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
      return Response.json(networkFixture("ioda-events"));
    };
    expect(await collectIodaFeed(EVENTS, HOSTS, fetcher, { kind: "live" }, NOW)).toMatchObject({ kind: "body", completeness: "complete", state: {} });
  });

  it("rejects an error envelope, a foreign entity and a missing copyright", () => {
    const document = networkFixture("ioda-events");
    expect(() => transform(EVENTS, { ...document, error: "boom" })).toThrow();
    expect(() => transform(EVENTS, { ...document, type: "outages.alerts" })).toThrow();
    expect(() => transform(EVENTS, { ...document, copyright: "" })).toThrow();
    expect(() => transform(ALERTS, networkFixture("ioda-events"))).toThrow();
    const alerts = networkFixture("ioda-alerts");
    const rows = Array.isArray(alerts.data) ? alerts.data : [];
    const first = object(rows[0]);
    expect(() => transform(ALERTS, { ...alerts, data: [{ ...first, entity: { ...object(first.entity), code: "ES" } }] })).toThrow();
  });
});

describe("IODA products", () => {
  it("dates each outage by its own start and keys it by what IODA keys it by", () => {
    const built = product(EVENTS, "ioda-events");
    expect(built.product.kind).toBe("record");
    expect(built.product.role).toBe("event-log");
    expect(built.product.updateMode).toBe("source-window");
    expect(built.product.completeness).toBe("complete");
    expect(built.records).toHaveLength(2);
    expect(built.records[0]).toMatchObject({
      entityKey: "country/PT|ping-slash24|median|2026-09-13T23:40:00.000Z",
      eventTime: "2026-09-13T23:40:00.000Z",
      validFrom: "2026-09-13T23:40:00.000Z",
      validTo: "2026-09-14T01:50:00.000Z",
      payload: { location: "country/PT", locationName: "Portugal", durationSeconds: 7800, datasource: "ping-slash24", method: "median" },
    });
    // The newest event's start, not the moment of the poll.
    expect(built.product.watermark).toBe("2026-09-14T16:30:00.000Z");
    expect(built.quality).toEqual({ acceptedRecords: 2, rejectedRecords: 0 });
  });

  it("reports a quiet window as an empty complete snapshot rather than a failure", () => {
    const built = product(EVENTS, "ioda-events-empty");
    expect(built.records).toEqual([]);
    expect(built.product.completeness).toBe("complete");
    expect(built.product.watermark).toBeUndefined();
    expect(built.quality).toEqual({ acceptedRecords: 0, rejectedRecords: 0 });
  });

  it("keeps an alert's level, condition and the history value it was judged against", () => {
    const built = product(ALERTS, "ioda-alerts");
    expect(built.product.role).toBe("event-log");
    expect(built.records).toHaveLength(4);
    expect(built.records[0]).toMatchObject({
      entityKey: "country/PT|ping-slash24|median|2026-09-13T23:40:00.000Z",
      eventTime: "2026-09-13T23:40:00.000Z",
      payload: { level: "critical", condition: "< 0.8", value: 7560, historyValue: 10156, entityName: "Portugal", datasource: "ping-slash24" },
    });
    expect(built.records.map((record) => object(record.payload).level)).toEqual(["critical", "normal", "critical", "normal"]);
  });

  it("dates every signal point by its own bin and leaves an unmeasured bin out", () => {
    const built = product(ASN_SIGNALS, "ioda-signals-asn");
    expect(built.product.kind).toBe("series");
    expect(built.product.role).toBe("time-series");
    // bgp and merit-nt: 37 five-minute bins with 6 and 13 gaps; ping-slash24: 19 ten-minute bins with 3.
    expect(built.points).toHaveLength(37 - 6 + (37 - 13) + (19 - 3));
    expect(new Set(built.points.map((point) => point.seriesKey))).toEqual(new Set(["bgp", "merit-nt", "ping-slash24"]));
    const bgp = built.points.filter((point) => point.seriesKey === "bgp");
    expect(bgp[0]).toEqual({
      seriesKey: "bgp",
      eventTime: "2026-09-17T22:00:00.000Z",
      value: 7204,
      unit: "visible /24s",
      dimensions: { datasource: "bgp", entityType: "asn", entityCode: "3243" },
    });
    // Bins are exactly one native step apart, and every emitted value is a real number.
    for (const [index, point] of bgp.slice(1).entries()) expect(Date.parse(point.eventTime) - Date.parse(bgp[index]!.eventTime)).toBe(300_000);
    expect(built.points.every((point) => Number.isFinite(point.value))).toBe(true);
    expect(built.product.watermark).toBe(
      built.points
        .map((point) => point.eventTime)
        .toSorted()
        .at(-1),
    );
  });

  it("publishes the country's own normalized Google series and never the per-probe datasources", () => {
    const built = product(COUNTRY_SIGNALS, "ioda-signals-country");
    expect(new Set(built.points.map((point) => point.seriesKey))).toEqual(new Set(["bgp", "merit-nt", "ping-slash24", "gtr-norm.BLENDED"]));
    const google = built.points.filter((point) => point.seriesKey === "gtr-norm.BLENDED");
    expect(google).toHaveLength(4);
    expect(google[0]).toMatchObject({ unit: "normalized traffic", dimensions: { datasource: "gtr-norm", entityType: "country", entityCode: "PT", subtype: "BLENDED" } });
  });

  it("refuses a signal whose values do not fill its own window, or that is not a number", () => {
    const document = networkFixture("ioda-signals-asn");
    const groups = Array.isArray(document.data) ? document.data : [];
    const first = Array.isArray(groups[0]) ? groups[0] : [];
    const series = object(first[1]);
    const values = Array.isArray(series.values) ? series.values : [];
    expect(() => transform(ASN_SIGNALS, { ...document, data: [[{ ...series, values: values.slice(1) }]] })).toThrow();
    expect(() => transform(ASN_SIGNALS, { ...document, data: [[{ ...series, values: ["7204", ...values.slice(1)] }]] })).toThrow();
    expect(() => transform(ASN_SIGNALS, { ...document, data: [[{ ...series, entityCode: "2860" }]] })).toThrow();
  });
});

describe("IODA examples", () => {
  it("ships eight Portugal-scoped examples with cadences its own clocks justify", () => {
    expect(feedsOf("ioda")).toHaveLength(8);
    expect(
      feedsOf("ioda")
        .map((example) => example.config.entityCode)
        .toSorted(),
    ).toEqual(["12353", "15457", "20879", "2860", "3243", "PT", "PT", "PT"]);
    for (const example of feedsOf("ioda")) {
      expect(() => validateIodaFeedConfig(libraryConfig(example.config))).not.toThrow();
      expect(datasetOf(example).publisher).toBe("ioda");
      expect(datasetOf(example).topics).toEqual(["telecom"]);
      expect(datasetOf(example).licence).toBe("ioda-all-rights-reserved");
      expect(example.policy.collection.cadenceSeconds).toBe(example.config.feed === "signals" ? 3600 : 900);
      expect(example.staleAfterSeconds).toBe(example.policy.collection.cadenceSeconds * 3);
    }
  });

  it("frames a whole collection the way the kernel reads it", async () => {
    const { resolved, collector } = await feedCollection("ioda-meo-as3243-internet-signals-feed", {
      fetcher: async () => Response.json(networkFixture("ioda-signals-asn")),
      now: () => NOW,
    });
    const request = await networkRequest(collector, resolved.config);
    const frames = await networkFrames(await collectNormalized(request, collector));
    const header = frames[0];
    if (header?.type !== "header") throw new Error("No header");
    expect(header.products[0]?.updateMode).toBe("source-window");
    expect(header.provenance.sourceUrl).toContain("/v2/signals/raw/asn/3243");
    const complete = frames.at(-1);
    if (complete?.type !== "complete") throw new Error("No completion frame");
    expect(complete.counts.points).toBe(71);
    expect(complete.counts.records).toBe(0);
    expect(complete.quality.rejectedRecords).toBe(0);
  });
});
