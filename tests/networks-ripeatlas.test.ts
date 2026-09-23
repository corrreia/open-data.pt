import { describe, expect, it } from "vitest";
import { collectNormalized, libraryConfig, type JsonObject, type JsonValue, type SourceFetch } from "../apps/gatekeeper/src/index";
import { collectRipeatlasFeed, RIPEATLAS_ORIGIN, RIPEATLAS_PROBE_FIELDS, validateRipeatlasFeedConfig } from "../apps/gatekeeper/src/publishers/ripe-ncc/ripeatlas/ripeatlas";
import { RipeatlasTransformer } from "../apps/gatekeeper/src/publishers/ripe-ncc/ripeatlas/transform";
import { networkBytes, networkContext, networkFixture, networkFrames, networkRequest, networkRows } from "./networks-support";
import { datasetOf, feedCollection, feedsOf } from "./catalog";

const PROBES = { feed: "country-probes", country: "PT" };
const ANCHORS = { feed: "country-anchors", country: "PT" };
const transformer = new RipeatlasTransformer();

/**
 * The fixtures are real Portuguese API responses with every identifying value
 * replaced by a synthetic one: a probe host's name, address and coordinates do
 * not belong in this repository any more than in a published product. The keys
 * stay, so these tests can prove none of them reaches a payload.
 */
function page(results: JsonValue[], next: string | null = null, count = results.length): JsonObject {
  return { count, next, previous: null, results };
}

function probe(id: number, status = 1): JsonObject {
  return {
    id,
    country_code: "PT",
    asn_v4: 1930,
    asn_v6: null,
    prefix_v4: "193.136.0.0/15",
    prefix_v6: null,
    is_anchor: false,
    is_public: true,
    status: { id: status, name: "Connected", since: "2026-09-08T17:38:57Z" },
    status_since: 1_788_889_137,
    first_connected: 1_311_208_016,
    tags: [
      { name: "Fibre", slug: "fibre" },
      { name: "system: IPv4 Works", slug: "system-ipv4-works" },
    ],
  };
}

async function transform(document: JsonObject, config = PROBES, observedAt?: string, chunk = 1) {
  return networkRows(await transformer.transform(networkBytes(document, chunk), networkContext(config, observedAt)));
}

async function drain(result: SourceFetch): Promise<string> {
  if (result.kind !== "body") throw new Error("Expected source body");
  return new Response(result.body).text();
}

describe("RIPE Atlas source boundaries", () => {
  it("requires Portugal and one of the two inventory capabilities", () => {
    expect(validateRipeatlasFeedConfig({ feed: "country-probes", country: "pt" })).toEqual(PROBES);
    for (const config of [
      { feed: "country-probes", country: "ES" },
      { feed: "measurements", country: "PT" },
      { feed: "country-probes" },
      { feed: "country-probes", country: "PT", key: "secret" },
      { feed: "country-probes", country: "PT", fields: "address_v4" },
    ])
      expect(() => validateRipeatlasFeedConfig(config)).toThrow();
    expect(feedsOf("ripeatlas")).toHaveLength(2);
    for (const example of feedsOf("ripeatlas")) {
      expect(validateRipeatlasFeedConfig(libraryConfig(example.config)).country).toBe("PT");
      expect(datasetOf(example).topics).toEqual(["telecom"]);
      expect(example.policy.collection.cadenceSeconds).toBeGreaterThanOrEqual(86_400);
      expect(datasetOf(example).licence).toBe("ripe-atlas-terms");
    }
  });

  it("asks only for the country, the standing fleet and the non-identifying fields", async () => {
    const seen: URL[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      seen.push(new URL(String(input)));
      expect(init?.redirect).toBe("manual");
      return Response.json(page([probe(1)]));
    };
    await drain(await collectRipeatlasFeed(PROBES, RIPEATLAS_ORIGIN, fetcher));
    const url = seen[0]!;
    expect(url.origin).toBe(RIPEATLAS_ORIGIN);
    expect(url.pathname).toBe("/api/v2/probes/");
    expect(url.searchParams.get("country_code")).toBe("PT");
    expect(url.searchParams.get("is_public")).toBe("true");
    expect(url.searchParams.get("status__in")).toBe("0,1,2");
    expect(url.searchParams.get("page_size")).toBe("500");
    expect(url.searchParams.get("fields")).toBe(RIPEATLAS_PROBE_FIELDS);
    expect(url.searchParams.get("fields")).not.toMatch(/address|description|geometry|last_connected/);
    seen.length = 0;
    await drain(await collectRipeatlasFeed(ANCHORS, RIPEATLAS_ORIGIN, fetcher));
    // Anchors honour `country`, not `country_code`, and ignore `fields` altogether.
    expect(seen[0]!.pathname).toBe("/api/v2/anchors/");
    expect(seen[0]!.searchParams.get("country")).toBe("PT");
    expect(seen[0]!.searchParams.get("country_code")).toBeNull();
  });

  it("walks pages by number until the source drops its continuation", async () => {
    const seen: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      seen.push(url.searchParams.get("page") ?? "");
      const last = seen.length === 3;
      return Response.json(page([probe(seen.length)], last ? null : `${RIPEATLAS_ORIGIN}/api/v2/probes/?page=${seen.length + 1}`, 3));
    };
    const source = await collectRipeatlasFeed(PROBES, RIPEATLAS_ORIGIN, fetcher);
    const body = await drain(source);
    expect(seen).toEqual(["1", "2", "3"]);
    expect(JSON.parse(body).pages).toHaveLength(3);
    expect(source).toMatchObject({ completeness: "complete", state: {} });
  });

  it("refuses a foreign origin, a redirect and a continuation that leaves the API", async () => {
    for (const origin of ["http://atlas.ripe.net", "https://private.test", "https://user@atlas.ripe.net", "https://atlas.ripe.net/api"])
      await expect(collectRipeatlasFeed(PROBES, origin, fetch)).rejects.toMatchObject({ code: "source-denied" });
    const redirect: typeof fetch = async () => new Response(null, { status: 302, headers: { Location: "https://private.test" } });
    await expect(drain(await collectRipeatlasFeed(PROBES, RIPEATLAS_ORIGIN, redirect))).rejects.toMatchObject({ code: "source-denied" });
    const elsewhere: typeof fetch = async () => Response.json(page([probe(1)], "https://private.test/api/v2/probes/?page=2"));
    await expect(drain(await collectRipeatlasFeed(PROBES, RIPEATLAS_ORIGIN, elsewhere))).rejects.toMatchObject({ code: "source-denied" });
  });

  it("enforces retry timing, byte caps, malformed envelopes, history and pagination bounds", async () => {
    const throttled: typeof fetch = async () => new Response("slow down", { status: 429, headers: { "Retry-After": "120" } });
    await expect(drain(await collectRipeatlasFeed(PROBES, RIPEATLAS_ORIGIN, throttled))).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 120 });
    const tooLarge: typeof fetch = async () => new Response("{}", { headers: { "Content-Length": "99999999" } });
    await expect(drain(await collectRipeatlasFeed(PROBES, RIPEATLAS_ORIGIN, tooLarge))).rejects.toMatchObject({ code: "response-too-large" });
    const notJson: typeof fetch = async () => new Response("<html></html>");
    await expect(drain(await collectRipeatlasFeed(PROBES, RIPEATLAS_ORIGIN, notJson))).rejects.toMatchObject({ code: "invalid-response" });
    const broken: typeof fetch = async () => Response.json({ error: { detail: "Invalid page.", status: 404 }, count: 0, results: [] });
    await expect(drain(await collectRipeatlasFeed(PROBES, RIPEATLAS_ORIGIN, broken))).rejects.toMatchObject({ code: "invalid-response" });
    await expect(collectRipeatlasFeed(PROBES, RIPEATLAS_ORIGIN, fetch, { kind: "history", cursor: { before: "2026-01-01T00:00:00.000Z" } })).rejects.toMatchObject({
      code: "invalid-config",
    });
    let requests = 0;
    const forever: typeof fetch = async () => {
      requests += 1;
      return Response.json(page([probe(requests)], `${RIPEATLAS_ORIGIN}/api/v2/probes/?page=${requests + 1}`, 5000));
    };
    await expect(drain(await collectRipeatlasFeed(PROBES, RIPEATLAS_ORIGIN, forever))).rejects.toMatchObject({ code: "response-too-large" });
    expect(requests).toBe(4);
  });
});

describe("RIPE Atlas probe inventory normalization", () => {
  it("publishes network placement and never a host, an address or a location", async () => {
    const document = networkFixture("ripeatlas-probes");
    const first = await transform(document);
    const second = await transform(document, PROBES, undefined, 53);
    expect(first).toEqual(second);
    expect(first.products.map((product) => product.productKey)).toEqual(["probes", "probe-counts"]);
    const records = first.rows.filter((row) => row.record);
    expect(records).toHaveLength(3);
    expect(records[0]?.record).toMatchObject({
      entityKey: "724",
      eventTime: "2026-09-08T17:38:57.000Z",
      payload: { id: "724", countryCode: "PT", asnV4: "AS1930", prefixV4: "193.136.0.0/15", isAnchor: false, status: "connected", firstConnected: "2011-07-21T00:26:56.000Z" },
    });
    // Host-chosen tags describe the connection; RIPE's own system flags churn and are dropped.
    expect(records[0]?.record?.payload.tags).toEqual(["academic", "core", "datacentre", "fibre", "ipv4", "ipv6", "nat", "native-ipv6", "office"]);
    for (const row of records)
      for (const key of [
        "address_v4",
        "address_v6",
        "addressV4",
        "description",
        "geometry",
        "latitude",
        "longitude",
        "last_connected",
        "lastConnected",
        "firmware_version",
        "total_uptime",
      ])
        expect(row.record?.payload).not.toHaveProperty(key);
  });

  it("counts the standing fleet once per collection, by state, beside the inventory", async () => {
    const result = await transform({ pages: [page([probe(1), probe(2), probe(3, 2), probe(4, 0)])] }, PROBES, "2026-09-17T06:00:00Z");
    const points = result.rows.flatMap((row) => (row.point ? [row.point] : []));
    expect(points.map((point) => [point.seriesKey, point.value])).toEqual([
      ["probes-never-connected", 1],
      ["probes-connected", 2],
      ["probes-disconnected", 1],
      ["probes-all", 4],
    ]);
    for (const point of points) {
      expect(point.eventTime).toBe("2026-09-17T06:00:00Z");
      expect(point.unit).toBe("probes");
    }
    expect(result.products[1]?.slug).toBe("network-test-count-series");
    expect(result.summary.quality).toEqual({ acceptedRecords: 4, rejectedRecords: 0 });
  });

  it("accepts an empty country and still states its fleet counts", async () => {
    const result = await transform({ pages: [page([])] });
    expect(result.rows.filter((row) => row.record)).toHaveLength(0);
    expect(result.rows.filter((row) => row.point)).toHaveLength(4);
    expect(result.rows.every((row) => !row.point || row.point.value === 0)).toBe(true);
    expect(result.summary.products?.[0]).toMatchObject({ productKey: "probes", completeness: "complete" });
    expect(result.products[0]?.updateMode).toBe("authoritative-snapshot");
  });

  it("will not let a multi-page read retract, because page pagination is not a snapshot", async () => {
    const result = await transform({ pages: [page([probe(1)], "https://atlas.ripe.net/api/v2/probes/?page=2", 2), page([probe(2)], null, 2)] });
    expect(result.rows.filter((row) => row.record)).toHaveLength(2);
    expect(result.summary.products?.[0]?.completeness).toBe("partial");
  });

  it("rejects foreign countries, opted-out hosts, retired states, repeats and malformed pages", async () => {
    for (const pages of [
      [page([{ ...probe(1), country_code: "ES" }])],
      [page([{ ...probe(1), is_public: false }])],
      [page([probe(1, 3)])],
      [page([probe(1), probe(1)])],
      [page([{ ...probe(1), status: { id: 1, since: "2026-02-31T00:00:00Z" } }])],
      [page([{ ...probe(1), asn_v4: -1 }])],
      [page([{ ...probe(1), prefix_v4: "not-a-prefix" }])],
      [{ count: 1, results: [probe(1)] }],
    ])
      await expect(transform({ pages })).rejects.toMatchObject({ code: "invalid-response" });
    await expect(transform({ pages: [] })).rejects.toThrow("omitted its pages");
  });

  it("emits protocol-v4 frames with one header, its records and its points", async () => {
    const fetcher: typeof fetch = async () => Response.json(page([probe(1), probe(2, 2)]));
    const { resolved, collector } = await feedCollection("ripe-atlas-portugal-probes-feed", { fetcher });
    const frames = await networkFrames(await collectNormalized(await networkRequest(collector, resolved.config), collector));
    expect(frames[0]?.type).toBe("header");
    expect(frames.filter((frame) => frame.type === "header")).toHaveLength(1);
    expect(frames.at(-1)).toMatchObject({ counts: { records: 2, points: 4 }, quality: { acceptedRecords: 2, rejectedRecords: 0 } });
  });
});

describe("RIPE Atlas anchor inventory normalization", () => {
  it("publishes the hostname RIPE already puts in DNS and no host, address or coordinate", async () => {
    const document = networkFixture("ripeatlas-anchors");
    const first = await transform(document, ANCHORS);
    expect(first).toEqual(await transform(document, ANCHORS, "2040-01-01T00:00:00Z", 97));
    expect(first.products.map((product) => product.productKey)).toEqual(["anchors"]);
    expect(first.rows[1]?.record).toMatchObject({
      entityKey: "953",
      eventTime: "2017-02-27T08:44:50.000Z",
      payload: { hostname: "pt-lis-as199993", fqdn: "pt-lis-as199993.anchors.atlas.ripe.net", city: "Lisboa", countryCode: "PT", asnV4: "AS199993", isDisabled: true },
    });
    for (const row of first.rows)
      for (const key of ["company", "nic_handle", "ip_v4", "ip_v6", "ipV4", "geometry", "latitude", "longitude", "tlsa_record", "ip_v4_gateway"])
        expect(row.record?.payload).not.toHaveProperty(key);
  });

  it("rejects anchors outside Portugal and accepts an empty country", async () => {
    await expect(transform({ pages: [page([{ id: 1, hostname: "es-mad-as1", fqdn: "es-mad-as1.anchors.atlas.ripe.net", country: "ES" }])] }, ANCHORS)).rejects.toMatchObject({
      code: "invalid-response",
    });
    const empty = await transform({ pages: [page([])] }, ANCHORS);
    expect(empty.rows).toHaveLength(0);
    expect(empty.summary.products?.[0]).toMatchObject({ productKey: "anchors", completeness: "complete" });
  });
});
