import { describe, expect, it } from "vitest";
import { collectNormalized, libraryConfig, type JsonObject, type SourceConfig } from "../apps/gatekeeper/src/index";
import { collectRipestatFeed, RIPESTAT_MAX_BYTES, RIPESTAT_ORIGIN, validateRipestatFeedConfig } from "../apps/gatekeeper/src/sources/ripestat/ripestat";
import { RipestatTransformer } from "../apps/gatekeeper/src/sources/ripestat/transform";
import { ripestatCollector } from "../apps/gatekeeper/src/sources/ripestat/collector";
import { RIPESTAT_EXAMPLES } from "../apps/gatekeeper/src/sources/ripestat/examples";
import { networkBytes, networkContext, networkFixture, networkFrames, networkRequest, networkRows, object } from "./networks-support";

const STATUS = { feed: "routing-status", asn: "64496" };
const RESOURCES = { feed: "country-resources", country: "PT" };
const ROUTING = { feed: "country-routing", country: "PT", days: "3" };
const NOW = new Date("2026-09-16T12:00:00Z");
const transformer = new RipestatTransformer();

function transform(config: SourceConfig, document: JsonObject, observedAt?: string, chunk = 1) {
  return transformer.transform(networkBytes(document, chunk), networkContext(config, observedAt)).then(networkRows);
}

function historyResponse(url: URL, earliest = "2004-01-01T00:00:00"): JsonObject {
  const root = networkFixture("ripestat-routing");
  const data = object(root.data);
  data.query_starttime = url.searchParams.get("starttime");
  data.query_endtime = url.searchParams.get("endtime");
  data.earliest_time = earliest;
  data.stats = [];
  return root;
}

describe("RIPEstat capabilities and boundaries", () => {
  it("accepts only named capabilities, PT country scopes and bounded AS numbers/windows", () => {
    expect(validateRipestatFeedConfig({ feed: "routing-status", asn: " AS64496 " })).toEqual(STATUS);
    expect(validateRipestatFeedConfig({ feed: "country-routing", country: "pt" })).toEqual({ ...ROUTING, days: "30" });
    for (const config of [
      { feed: "arbitrary", country: "PT" },
      { ...RESOURCES, country: "ES" },
      { ...STATUS, asn: "0" },
      { ...STATUS, asn: "4294967296" },
      { ...STATUS, asn: "64496/path" },
      { ...STATUS, host: "internal.test" },
      { ...ROUTING, days: "0" },
      { ...ROUTING, days: "91" },
      { ...ROUTING, days: "2.5" },
      { ...RESOURCES, asn: "64496" },
    ])
      expect(() => validateRipestatFeedConfig(config)).toThrow();
  });

  it("ships seven verified, honestly labelled examples with source-appropriate cadence and permission warnings", () => {
    expect(RIPESTAT_EXAMPLES).toHaveLength(7);
    const asns = RIPESTAT_EXAMPLES.filter((example) => example.config.asn).map((example) => example.config.asn);
    expect(asns).toEqual(["3243", "2860", "12353", "20879", "15457"]);
    expect(asns).not.toContain("12542"); // This is NOS, not the research brief's proposed NOWO.
    for (const example of RIPESTAT_EXAMPLES) {
      expect(() => validateRipestatFeedConfig(libraryConfig(example.config))).not.toThrow();
      expect(example.policy.serving.licence).toBe("ripe-ncc-terms");
      expect(example.publisher).toBe("ripe-ncc");
      expect(example.policy.collection.cadenceSeconds).toBe(example.config.asn ? 28_800 : 86_400);
    }
  });

  it("constructs one bounded daily query rather than the endpoint's all-history default", async () => {
    let observed: URL | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      observed = new URL(String(input));
      expect(init?.redirect).toBe("manual");
      return Response.json(networkFixture("ripestat-routing"));
    };
    const result = await collectRipestatFeed(ROUTING, undefined, RIPESTAT_ORIGIN, fetcher, { kind: "live" }, NOW);
    expect(result.kind).toBe("body");
    expect(observed?.searchParams.get("resource")).toBe("PT");
    expect(observed?.searchParams.get("resolution")).toBe("1d");
    expect(observed?.searchParams.get("starttime")).toBe("2026-09-13T00:00:00");
    expect(observed?.searchParams.get("endtime")).toBe("2026-09-16T00:00:00");
  });

  it("rejects alternate origins, credentials, paths, and redirects without following them", async () => {
    for (const origin of ["http://stat.ripe.net", "https://evil.test", "https://user@stat.ripe.net", "https://stat.ripe.net/path"]) {
      await expect(collectRipestatFeed(STATUS, undefined, origin, fetch)).rejects.toMatchObject({ code: "source-denied" });
    }
    let requests = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      requests += 1;
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { Location: "https://evil.test" } });
    };
    await expect(collectRipestatFeed(STATUS, undefined, RIPESTAT_ORIGIN, fetcher)).rejects.toMatchObject({ code: "source-denied" });
    expect(requests).toBe(1);
  });

  it("preserves Retry-After and bounds declared source bytes", async () => {
    await expect(
      collectRipestatFeed(STATUS, undefined, RIPESTAT_ORIGIN, async () => new Response("busy", { status: 429, headers: { "Retry-After": "600" } })),
    ).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 600 });
    await expect(
      collectRipestatFeed(STATUS, undefined, RIPESTAT_ORIGIN, async () => new Response("{}", { headers: { "Content-Length": String(RIPESTAT_MAX_BYTES + 1) } })),
    ).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("binds validators to the exact URL and never uses a prior window's validators", async () => {
    const url = `${RIPESTAT_ORIGIN}/data/routing-status/data.json?resource=AS64496&min_peers_seeing=10`;
    const state = { url, validators: { default: { etag: '"source"' } } };
    const fetcher: typeof fetch = async (_input, init) => {
      expect(new Headers(init?.headers).get("if-none-match")).toBe('"source"');
      return new Response(null, { status: 304 });
    };
    expect(await collectRipestatFeed(STATUS, state, RIPESTAT_ORIGIN, fetcher)).toMatchObject({ kind: "not-modified" });
    const changed: typeof fetch = async (_input, init) => {
      expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
      return Response.json(networkFixture("ripestat-routing"));
    };
    await collectRipestatFeed(ROUTING, state, RIPESTAT_ORIGIN, changed, { kind: "live" }, NOW);
    await expect(collectRipestatFeed(STATUS, undefined, RIPESTAT_ORIGIN, async () => new Response(null, { status: 304 }))).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("walks real availability bounds, advancing empty gaps without inventing exhaustion", async () => {
    const fetcher: typeof fetch = async (input) => Response.json(historyResponse(new URL(String(input))));
    const result = await collectRipestatFeed(ROUTING, undefined, RIPESTAT_ORIGIN, fetcher, { kind: "history", cursor: { before: "2026-09-13T00:00:00Z" } }, NOW);
    expect(result).toMatchObject({ kind: "body", next: { before: "2026-09-10T00:00:00.000Z" } });
    const exhausted = await collectRipestatFeed(ROUTING, undefined, RIPESTAT_ORIGIN, fetcher, { kind: "history", cursor: { before: "2004-01-01T00:00:00Z" } }, NOW);
    expect(exhausted).toEqual({ kind: "exhausted" });
    const last = await collectRipestatFeed(ROUTING, undefined, RIPESTAT_ORIGIN, fetcher, { kind: "history", cursor: { before: "2004-01-03T00:00:00Z" } }, NOW);
    expect(last).toMatchObject({ kind: "body", exhausted: true });
    await expect(collectRipestatFeed(ROUTING, undefined, RIPESTAT_ORIGIN, fetcher, { kind: "history", cursor: { before: "bad" } }, NOW)).rejects.toMatchObject({
      code: "invalid-config",
    });
    await expect(collectRipestatFeed(ROUTING, undefined, RIPESTAT_ORIGIN, fetcher, { kind: "history", cursor: { before: "2026-02-31T00:00:00Z" } }, NOW)).rejects.toMatchObject({
      code: "invalid-config",
    });
  });
});

describe("RIPEstat normalized data", () => {
  it("streams all resource families in one-byte chunks without acquisition or query-time churn", async () => {
    const document = networkFixture("ripestat-resources");
    const first = await transform(RESOURCES, document);
    document.time = "2040-01-01T00:00:00";
    document.query_id = "another";
    object(document.data).query_time = "2039-12-31T00:00:00";
    const second = await transform(RESOURCES, document, "2040-01-01T00:00:00Z", 37);
    expect(first).toEqual(second);
    expect(first.rows).toHaveLength(5);
    expect(first.rows.map((row) => row.record?.entityKey)).toEqual(["ipv4:192.0.2.0/24", "ipv4:198.51.100.1-198.51.100.3", "asn:AS64496", "asn:AS64497", "ipv6:2001:db8::/32"]);
    for (const row of first.rows) {
      expect(row.record?.eventTime).toBeUndefined();
      expect(row.record?.sourcePublishedAt).toBeUndefined();
    }
    expect(first.products).toHaveLength(1);
  });

  it("uses RIS snapshot time and real IPv6 /48 units without claiming customer outages", async () => {
    const document = networkFixture("ripestat-status");
    const first = await transform(STATUS, document);
    document.time = "2040-01-01T00:00:00";
    document.query_id = "another";
    expect(await transform(STATUS, document, "2040-01-01T00:00:00Z")).toEqual(first);
    expect(first.rows[0]?.record).toMatchObject({ entityKey: "AS64496", eventTime: "2026-09-15T16:00:00.000Z", payload: { ipv4Addresses: 256, ipv6Slash48Units: 0.00390625 } });
    expect(first.products[0]?.schema.fields.find((field) => field.id === "ipv6Slash48Units")?.unit).toBe("IPv6 /48 subnet equivalents");
    expect(first.rows[0]?.record?.payload).not.toHaveProperty("outage");
    expect(first.products[0]?.kind).toBe("record");
  });

  it("dates routing points by source daily intervals and registrations by stats_date only", async () => {
    const result = await transform(ROUTING, networkFixture("ripestat-routing"));
    expect(result.rows).toHaveLength(11);
    const points = result.rows.flatMap((row) => (row.point ? [row.point] : []));
    expect(points.filter((point) => point.seriesKey === "asns_stats")).toHaveLength(2);
    expect(points.filter((point) => point.seriesKey === "v4_prefixes_ris")).toHaveLength(3);
    expect(points.every((point) => point.value >= 0)).toBe(true);
    expect(new Set(points.map((point) => point.unit))).toEqual(new Set(["prefixes", "ASNs"]));
    expect(points.some((point) => point.seriesKey.endsWith("prefixes_stats"))).toBe(false);
    expect(result.products[0]?.updateMode).toBe("source-window");
  });

  it("excludes the endpoint's inclusive upper boundary from the exclusive serving/history window", async () => {
    const root = networkFixture("ripestat-routing");
    const data = object(root.data);
    const sample: JsonObject = {
      timeline: [{ starttime: "2026-09-16T00:00:00", endtime: "2026-09-16T00:00:00" }],
      v4_prefixes_ris: 9,
      v6_prefixes_ris: 9,
      asns_ris: 9,
      asns_stats: 9,
      stats_date: "2026-09-16T00:00:00",
    };
    data.stats = [sample];
    const result = await transform(ROUTING, root);
    expect(result.rows).toHaveLength(0);
  });

  it("rejects API errors, foreign resources, wrong resolution, incomplete families and invalid source values", async () => {
    const error = networkFixture("ripestat-status");
    error.status = "error";
    await expect(transform(STATUS, error)).rejects.toMatchObject({ code: "invalid-response" });
    const wrongAs = networkFixture("ripestat-status");
    object(wrongAs.data).resource = "64497";
    await expect(transform(STATUS, wrongAs)).rejects.toMatchObject({ code: "invalid-response" });
    const wrongCountry = networkFixture("ripestat-routing");
    object(wrongCountry.data).resource = "ES";
    await expect(transform(ROUTING, wrongCountry)).rejects.toMatchObject({ code: "invalid-response" });
    const hourly = networkFixture("ripestat-routing");
    object(hourly.data).resolution = "1h";
    await expect(transform(ROUTING, hourly)).rejects.toMatchObject({ code: "invalid-response" });
    const absent = networkFixture("ripestat-resources");
    delete object(object(absent.data).resources).ipv6;
    await expect(transform(RESOURCES, absent)).rejects.toMatchObject({ code: "invalid-response" });
    const invalid = networkFixture("ripestat-resources");
    object(object(invalid.data).resources).ipv4 = ["999.1.1.1/24"];
    await expect(transform(RESOURCES, invalid)).rejects.toMatchObject({ code: "invalid-response" });
    const clock = networkFixture("ripestat-status");
    object(clock.data).query_time = "2026-02-31T16:00:00";
    await expect(transform(STATUS, clock)).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("enforces resource, status-document and configured timeline bounds", async () => {
    const allocations = networkFixture("ripestat-resources");
    object(object(allocations.data).resources).asn = Array.from({ length: 5001 }, (_, index) => String(64496 + index));
    await expect(transform(RESOURCES, allocations, undefined, 1024)).rejects.toMatchObject({ code: "response-too-large" });
    const oversized = networkFixture("ripestat-status");
    oversized.padding = "x".repeat(65 * 1024);
    await expect(transform(STATUS, oversized, undefined, 1024)).rejects.toMatchObject({ code: "response-too-large" });
    await expect(transform({ ...ROUTING, days: "1" }, networkFixture("ripestat-routing"))).rejects.toThrow("unbounded routing interval");
  });

  it("downgrades provider warnings instead of authorizing an empty authoritative retraction", async () => {
    const root = networkFixture("ripestat-resources");
    root.messages = [["warning", "partial source"]];
    const result = await transform(RESOURCES, root);
    expect(result.summary.products?.[0]?.completeness).toBe("partial");
  });

  it("emits protocol-v4 frames and converts HTTP-200 API failures to typed failures", async () => {
    const collector = ripestatCollector({ config: STATUS, apiOrigin: RIPESTAT_ORIGIN, fetcher: async () => Response.json(networkFixture("ripestat-status")) });
    const request = await networkRequest(collector, STATUS);
    const frames = await networkFrames(await collectNormalized(request, collector));
    expect(frames.map((frame) => frame.type)).toEqual(["header", "record", "complete"]);
    expect(frames.at(-1)).toMatchObject({ counts: { records: 1, points: 0 }, quality: { acceptedRecords: 1, rejectedRecords: 0 } });
    const failed = ripestatCollector({ config: STATUS, apiOrigin: RIPESTAT_ORIGIN, fetcher: async () => Response.json({ status: "error", status_code: 500, data: {} }) });
    expect(await collectNormalized(await networkRequest(failed, STATUS), failed)).toMatchObject({ kind: "failure", code: "invalid-response" });
  });
});
