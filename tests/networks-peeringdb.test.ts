import { describe, expect, it } from "vitest";
import { collectNormalized, libraryConfig, type JsonObject, type SourceFetch } from "../apps/gatekeeper/src/index";
import { collectPeeringdbFeed, PEERINGDB_ORIGIN, PEERINGDB_PUBLIC_FIELDS, validatePeeringdbFeedConfig } from "../apps/gatekeeper/src/publishers/peeringdb/peeringdb/peeringdb";
import { peeringdbCollector } from "../apps/gatekeeper/src/publishers/peeringdb/peeringdb/collector";
import { PeeringdbTransformer } from "../apps/gatekeeper/src/publishers/peeringdb/peeringdb/transform";
import { networkBytes, networkContext, networkFixture, networkFrames, networkRequest, networkRows, object } from "./networks-support";
import { datasetOf, feedsOf } from "./catalog";

const CONFIG = { feed: "exchanges", country: "PT" };
const transformer = new PeeringdbTransformer();

function exchange(id: number): JsonObject {
  return { id, name: `Synthetic exchange ${id}`, name_long: "", city: "Lisboa", country: "PT", status: "ok", website: "https://example.test/", updated: "2026-09-01T00:00:00Z" };
}

async function transform(document: JsonObject, observedAt?: string, chunk = 1) {
  return networkRows(await transformer.transform(networkBytes(document, chunk), networkContext(CONFIG, observedAt)));
}

async function drain(result: SourceFetch): Promise<string> {
  if (result.kind !== "body") throw new Error("Expected source body");
  return new Response(result.body).text();
}

describe("PeeringDB source boundaries", () => {
  it("requires Portugal and only the public exchange capability", () => {
    expect(validatePeeringdbFeedConfig({ country: "pt" })).toEqual(CONFIG);
    for (const config of [
      { ...CONFIG, country: "ES" },
      { ...CONFIG, feed: "contacts" },
      { ...CONFIG, host: "private.test" },
      { ...CONFIG, fields: "tech_email" },
    ])
      expect(() => validatePeeringdbFeedConfig(config)).toThrow();
    expect(feedsOf("peeringdb")).toHaveLength(1);
    const example = feedsOf("peeringdb")[0]!;
    expect(validatePeeringdbFeedConfig(libraryConfig(example.config))).toEqual(CONFIG);
    expect(example.policy.collection.cadenceSeconds).toBe(604_800);
    expect(datasetOf(example).licence).toBe("peeringdb-aup");
  });

  it("requests only non-contact fields and drains short pages until an explicit empty page", async () => {
    const seen: URL[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      seen.push(url);
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
      return Response.json({ data: seen.length === 1 ? [exchange(1), exchange(2)] : seen.length === 2 ? [exchange(3)] : [], meta: {} });
    };
    const source = await collectPeeringdbFeed(CONFIG, PEERINGDB_ORIGIN, fetcher);
    await drain(source);
    expect(seen.map((url) => url.searchParams.get("skip"))).toEqual(["0", "2", "3"]);
    for (const url of seen) {
      expect(url.origin).toBe(PEERINGDB_ORIGIN);
      expect(url.searchParams.get("country")).toBe("PT");
      expect(url.searchParams.get("status")).toBe("ok");
      expect(url.searchParams.get("depth")).toBe("0");
      expect(url.searchParams.get("fields")).toBe(PEERINGDB_PUBLIC_FIELDS);
      expect(url.searchParams.get("fields")).not.toMatch(/email|phone|address|notes/);
    }
    expect(source).toMatchObject({ completeness: "complete", state: {} });
  });

  it("rejects outbound-origin substitutions and redirects", async () => {
    for (const origin of ["http://www.peeringdb.com", "https://private.test", "https://user@www.peeringdb.com", "https://www.peeringdb.com/api"])
      await expect(collectPeeringdbFeed(CONFIG, origin, fetch)).rejects.toMatchObject({ code: "source-denied" });
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests += 1;
      return new Response(null, { status: 302, headers: { Location: "https://private.test" } });
    };
    await expect(drain(await collectPeeringdbFeed(CONFIG, PEERINGDB_ORIGIN, fetcher))).rejects.toMatchObject({ code: "source-denied" });
    expect(requests).toBe(1);
  });

  it("does not accept a first-page 304 as proof of an unchanged directory", async () => {
    const collector = peeringdbCollector({
      config: CONFIG,
      apiOrigin: PEERINGDB_ORIGIN,
      fetcher: async (_input, init) => {
        expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
        return new Response(null, { status: 304 });
      },
    });
    const state = { validators: { default: { etag: '"one-page-only"' } } };
    const source = await collector.source(state, { kind: "live" }, new AbortController().signal);
    await expect(drain(source)).rejects.toMatchObject({ code: "source-denied" });
  });

  it("enforces HTTP retries, page-byte caps, API error envelopes and pagination request bounds", async () => {
    const throttled: typeof fetch = async () => new Response("busy", { status: 429, headers: { "Retry-After": "60" } });
    await expect(drain(await collectPeeringdbFeed(CONFIG, PEERINGDB_ORIGIN, throttled))).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 60 });
    const tooLarge: typeof fetch = async () => new Response("{}", { headers: { "Content-Length": "9999999" } });
    await expect(drain(await collectPeeringdbFeed(CONFIG, PEERINGDB_ORIGIN, tooLarge))).rejects.toMatchObject({ code: "response-too-large" });
    const error: typeof fetch = async () => Response.json({ data: [], meta: { error: "Unavailable" } });
    await expect(drain(await collectPeeringdbFeed(CONFIG, PEERINGDB_ORIGIN, error))).rejects.toMatchObject({ code: "invalid-response" });
    const continuation: typeof fetch = async () => Response.json({ data: [], meta: { next: "https://private.test/" } });
    await expect(drain(await collectPeeringdbFeed(CONFIG, PEERINGDB_ORIGIN, continuation))).rejects.toMatchObject({ code: "invalid-response" });
    let requests = 0;
    const forever: typeof fetch = async () => Response.json({ data: [exchange(++requests)], meta: {} });
    await expect(drain(await collectPeeringdbFeed(CONFIG, PEERINGDB_ORIGIN, forever))).rejects.toMatchObject({ code: "response-too-large" });
    expect(requests).toBe(11);
  });
});

describe("PeeringDB public directory normalization", () => {
  it("streams one-byte chunks, excludes contacts and ignores generation/acquisition clocks", async () => {
    const document = networkFixture("peeringdb-exchanges");
    const first = await transform(document);
    if (!Array.isArray(document.pages)) throw new Error("Missing fixture pages");
    object(document.pages[0]).meta = { generated: "2040-01-01T00:00:00Z" };
    const second = await transform(document, "2040-01-01T00:00:00Z", 37);
    expect(first).toEqual(second);
    expect(first.rows).toHaveLength(2);
    expect(first.products.map((product) => product.kind)).toEqual(["record"]);
    expect(first.rows[0]?.record).toMatchObject({ entityKey: "1", eventTime: "2026-06-03T12:00:00.000Z", payload: { country: "PT", supportsIpv6: true } });
    expect(first.rows[1]?.record?.eventTime).toBeUndefined();
    for (const row of first.rows) {
      expect(row.record?.payload).not.toHaveProperty("tech_email");
      expect(row.record?.payload).not.toHaveProperty("tech_phone");
      expect(row.record?.payload).not.toHaveProperty("notes");
      expect(row.record?.payload).not.toHaveProperty("generated");
    }
  });

  it("requires full pagination before authorizing an empty or nonempty authoritative snapshot", async () => {
    await expect(transform({ pages: [{ data: [exchange(1)], meta: {} }] })).rejects.toThrow("empty final page");
    const empty = await transform({ pages: [{ data: [], meta: {} }] });
    expect(empty.rows).toHaveLength(0);
    expect(empty.products[0]?.completeness).toBe("complete");
    expect(empty.products[0]?.updateMode).toBe("authoritative-snapshot");
  });

  it("downgrades multi-page mutable snapshots because offset pagination is not atomic", async () => {
    const result = await transform({ pages: [{ data: [exchange(1)] }, { data: [exchange(2)] }, { data: [] }] });
    expect(result.rows).toHaveLength(2);
    expect(result.summary.products?.[0]?.completeness).toBe("partial");
  });

  it("fails repeated IDs, foreign countries, non-public statuses and malformed API metadata", async () => {
    for (const pages of [
      [{ data: [exchange(1)] }, { data: [exchange(1)] }, { data: [] }],
      [{ data: [{ ...exchange(1), country: "ES" }] }, { data: [] }],
      [{ data: [{ ...exchange(1), status: "deleted" }] }, { data: [] }],
      [{ data: [], meta: { status: "error", message: "Incomplete result" } }],
      [{ data: [{ ...exchange(1), updated: "2026-02-31T00:00:00Z" }] }, { data: [] }],
    ])
      await expect(transform({ pages })).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("bounds the complete directory by record count, not just bytes", async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({ id: index + 1, name: "Synthetic", city: "Lisboa", country: "PT", status: "ok" }));
    await expect(transform({ pages: [{ data: rows }, { data: [] }] }, undefined, 1024)).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("emits protocol-v4 record frames and completion without any repeated series product", async () => {
    let request = 0;
    const fetcher: typeof fetch = async () => Response.json({ data: request++ === 0 ? [exchange(1)] : [], meta: {} });
    const collector = peeringdbCollector({ config: CONFIG, apiOrigin: PEERINGDB_ORIGIN, fetcher });
    const frames = await networkFrames(await collectNormalized(await networkRequest(collector, CONFIG), collector));
    expect(frames.map((frame) => frame.type)).toEqual(["header", "record", "complete"]);
    expect(frames.at(-1)).toMatchObject({ counts: { records: 1, points: 0 }, quality: { acceptedRecords: 1, rejectedRecords: 0 } });
  });
});
