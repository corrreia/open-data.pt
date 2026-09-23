import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { NORMALIZED_PROTOCOL, collectNormalized, isNormalizedFrame, parseJson, type CollectionRequest, type NormalizedRow, type TransformContext } from "@open-data-pt/gatekeeper";
import { collectIpmaFeed, IPMA_FEEDS, validateIpmaFeedConfig } from "../apps/gatekeeper/src/publishers/ipma/ipma/ipma";
import { resolveIpmaFeed } from "../apps/gatekeeper/src/publishers/ipma/ipma/collector";
import { IpmaDatasetTransformer, type IpmaDatasetFeed } from "../apps/gatekeeper/src/publishers/ipma/ipma/datasets";
import { feedCollection } from "./catalog";

const transformer = new IpmaDatasetTransformer();
const ORIGIN = "https://api.ipma.pt";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

function bytes(text: string, chunkSize = 1000): ReadableStream<Uint8Array> {
  const data = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= data.length) {
        controller.close();
        return;
      }
      controller.enqueue(data.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

function context(feed: IpmaDatasetFeed, observedAt = "2026-09-15T12:00:00Z"): TransformContext {
  return { observedAt, feed: { slug: `ipma-${feed}-feed`, title: feed, description: feed, config: { feed }, semantics: IPMA_FEEDS[feed].semantics } };
}

async function transformed(text: string, feed: IpmaDatasetFeed, chunkSize = 1000, observedAt?: string) {
  const result = await transformer.transform(bytes(text, chunkSize), context(feed, observedAt));
  const rows: NormalizedRow[] = [];
  for await (const row of result.rows) rows.push(row);
  return { products: result.products, rows, summary: result.finish() };
}

async function request(feed: IpmaDatasetFeed): Promise<CollectionRequest> {
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: "test-ipma",
    feed: { id: "test", slug: `ipma-${feed}-feed`, title: feed, description: feed },
    feedEpoch: "test",
    resolved: await resolveIpmaFeed({ feed }),
    mode: { kind: "live" },
    limits: { sourceBytes: 2_000_000, outputBytes: 4_000_000, frameBytes: 2_000_000, recordBytes: 1_000_000, records: 20_000, products: 10 },
    deadline: new Date(Date.now() + 60_000).toISOString(),
    observedAt: "2026-09-15T12:00:00Z",
  };
}

describe("IPMA published datasets", () => {
  it("streams source-dated rain totals and rates, preserving DICO codes and zero values", async () => {
    const text = fixture("ipma-municipal-rain.csv");
    const result = await transformed(text, "municipal-precipitation", 1);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ kind: "series", updateMode: "source-window" });
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]?.point).toMatchObject({
      seriesKey: "0101:total-precipitation",
      eventTime: "2026-09-13T00:00:00.000Z",
      value: 0.73,
      unit: "mm",
      dimensions: { municipalityCode: "0101", municipality: "Águeda", spatialStatistic: "mean" },
    });
    expect(result.rows[1]?.point).toMatchObject({ value: 8.59, unit: "mm/h" });
    expect(result.rows[2]?.point?.value).toBe(0);
    expect(result.summary.products?.[0]?.watermark).toBe("2026-09-14T00:00:00.000Z");
    expect(result).toEqual(await transformed(text, "municipal-precipitation", 500, "2026-10-01T00:00:00Z"));
  });

  it("emits only explicitly selected temperature measures and rejects missing readings", async () => {
    const result = await transformed(fixture("ipma-municipal-temperature.csv"), "municipal-temperature", 2);
    expect(result.rows).toHaveLength(5);
    expect(result.rows.every((row) => row.point?.unit === "°C")).toBe(true);
    expect(result.summary.quality).toEqual({ acceptedRecords: 5, rejectedRecords: 1 });
  });

  it("rejects missing CSV columns, impossible dates and duplicate municipality days", async () => {
    await expect(transformed("time,zid,zname\n", "municipal-temperature")).rejects.toThrow("missing mean_mint2m");
    const text = fixture("ipma-municipal-rain.csv");
    const invalid = await transformed(text.replace("2026-09-13", "2026-02-31"), "municipal-precipitation");
    expect(invalid.rows).toHaveLength(2);
    expect(invalid.summary.quality.rejectedRecords).toBe(1);
    await expect(transformed(text + text.split("\n")[1] + "\n", "municipal-precipitation")).rejects.toThrow("repeats a municipality/day");
  });

  it("keeps partial shellfish restrictions and trailing publication metadata without poll-time churn", async () => {
    const text = fixture("ipma-shellfish.geojson");
    const result = await transformed(text, "shellfish-restrictions", 1);
    expect(result.products).toHaveLength(1);
    expect(result.rows[0]?.record).toMatchObject({
      entityKey: "L1",
      payload: {
        status: "PARTIAL_OPEN",
        latitude: 41.5689535,
        openSpecies: [{ specie_s: "Spisula solida" }],
        closedSpecies: [{ specie_s: "Mytilus spp." }],
      },
    });
    expect(result.rows[0]?.record?.eventTime).toBeUndefined();
    expect(result.summary.products?.[0]?.watermark).toBe("2026-09-07T00:00:00.000Z");
    expect(result).toEqual(await transformed(text, "shellfish-restrictions", 1024, "2030-01-01T00:00:00Z"));
  });

  it("rejects malformed shellfish snapshots, truncated streams, and invalid metadata", async () => {
    const text = fixture("ipma-shellfish.geojson");
    await expect(transformed(text.replace('"code":"L1"', '"code":""'), "shellfish-restrictions")).rejects.toThrow("zone code");
    await expect(transformed(text.slice(0, -20), "shellfish-restrictions")).rejects.toThrow();
    await expect(transformed(text.replace('"publication_date":"2026-09-07"', '"publication_date":"2026-02-31"'), "shellfish-restrictions")).rejects.toThrow("publication date");
    await expect(transformed(text.replace('"FeatureCollection"', '"not-a-collection"'), "shellfish-restrictions")).rejects.toThrow("FeatureCollection");
  });

  it("accepts a complete empty zone snapshot without inventing observations", async () => {
    const result = await transformed('{"type":"FeatureCollection","features":[],"publication_date":"2026-09-07"}', "shellfish-restrictions", 1);
    expect(result.rows).toEqual([]);
    expect(result.summary.quality).toEqual({ acceptedRecords: 0, rejectedRecords: 0 });
  });

  it("uses validated conditional streaming requests and rejects unsolicited unchanged responses", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("if-none-match")).toBe('"climate-v1"');
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 304 });
    });
    expect(await collectIpmaFeed({ feed: "municipal-precipitation" }, { etag: '"climate-v1"' }, ORIGIN, fetcher)).toEqual({ kind: "not-modified" });
    await expect(collectIpmaFeed({ feed: "municipal-precipitation" }, undefined, ORIGIN, async () => new Response(null, { status: 304 }))).rejects.toMatchObject({
      code: "invalid-response",
    });
    expect(() => validateIpmaFeedConfig({ feed: "shellfish-restrictions", host: "evil.example" })).toThrow();
    await expect(collectIpmaFeed({ feed: "shellfish-restrictions" }, undefined, "https://evil.example", fetcher)).rejects.toMatchObject({ code: "source-denied" });
  });

  it("refuses redirects using the redirect mode supported by Workers", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "https://evil.example/data" } });
    });
    await expect(collectIpmaFeed({ feed: "municipal-temperature" }, undefined, ORIGIN, fetcher)).rejects.toMatchObject({ code: "upstream-error" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("drops obsolete validators, rejects provider errors and enforces declared source size", async () => {
    const fetched = await collectIpmaFeed({ feed: "municipal-temperature" }, { etag: '"old"' }, ORIGIN, async () => new Response(fixture("ipma-municipal-temperature.csv")));
    expect(fetched).toMatchObject({ kind: "body", state: {} });
    if (fetched.kind === "body") await new Response(fetched.body).text();
    await expect(collectIpmaFeed({ feed: "municipal-temperature" }, undefined, ORIGIN, async () => new Response("", { status: 503 }))).rejects.toMatchObject({
      code: "upstream-error",
    });
    await expect(
      collectIpmaFeed({ feed: "municipal-temperature" }, undefined, ORIGIN, async () => new Response("", { headers: { "content-length": "3000000" } })),
    ).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("passes the normalized protocol and keeps arbitrary history unsupported", async () => {
    const { resolved, collector } = await feedCollection("ipma-municipal-precipitation-feed", { fetcher: async () => new Response(fixture("ipma-municipal-rain.csv")) });
    const req = { ...(await request("municipal-precipitation")), resolved };
    const result = await collectNormalized(req, collector);
    if (result.kind !== "batch") throw new Error(`Expected batch, got ${result.kind}`);
    const lines = (await new Response(result.stream).text()).trim().split("\n");
    expect(lines.every((line) => isNormalizedFrame(parseJson(line)))).toBe(true);
    expect(parseJson(lines.at(-1)!)).toMatchObject({ type: "complete", counts: { records: 0, points: 4 } });
    expect(await collectNormalized({ ...req, mode: { kind: "history", cursor: { before: "2026-01-01T00:00:00Z" } } }, collector)).toMatchObject({
      kind: "failure",
      code: "history-unsupported",
    });
  });

  it("fails the byte stream without a completion frame if the kernel output budget is exhausted", async () => {
    const { resolved, collector } = await feedCollection("ipma-municipal-precipitation-feed", { fetcher: async () => new Response(fixture("ipma-municipal-rain.csv")) });
    const req = { ...(await request("municipal-precipitation")), resolved };
    req.limits = { ...req.limits, records: 1 };
    const result = await collectNormalized(req, collector);
    if (result.kind !== "batch") throw new Error("Expected stream");
    await expect(new Response(result.stream).text()).rejects.toThrow("exceeds 1 rows");
  });
});
