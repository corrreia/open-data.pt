import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { carriedLibraries, datasetOf, feedsOf } from "./catalog";
import { RUNNABLE } from "@open-data-pt/gatekeeper/catalog";
import {
  GatekeeperError,
  NORMALIZED_PROTOCOL,
  collectNormalized,
  feedCollector,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  libraryConfig,
  parseJson,
  resolveLibraryFeed,
  type CollectionRequest,
  type JsonObject,
  type JsonValue,
  type NormalizedCollector,
  type ResolvedFeed,
  type SourceBody,
  type SourceConfig,
  type SourceFetch,
} from "@open-data-pt/gatekeeper";
import { OgcTransformer, collectOgcFeed, itemsUrl, resolveOgcFeed, validateOgcFeedConfig } from "../apps/gatekeeper/src/formats/ogc";
import { boundingBox } from "../apps/gatekeeper/src/formats/ogc/geometry";

const DGT_HOST = "ogcapi.dgterritorio.gov.pt";
const AZORES_HOST = "ambiente.azores.gov.pt";
const LNEG_HOST = "ogcapi.lneg.pt";
const hosts = new Set([DGT_HOST, AZORES_HOST, LNEG_HOST]);

const config = { host: DGT_HOST, collection: "municipios", geometry: "skip", pageSize: "1000", maxPages: "5" };

/**
 * A DGT layer's own feed file, run on a configuration no feed has: the way the
 * Worker runs an OGC feed, through its functions and its library's identity.
 */
function ogcCollector(feedConfig: SourceConfig, fetcher: typeof fetch): NormalizedCollector {
  const feed = RUNNABLE.get("dgt-caop-municipios-feed");
  if (!feed) throw new Error("dgt-caop-municipios-feed is not defined");
  return feedCollector(feed, { ...feedConfig, source: "ogc" }, carriedLibraries("ogc"), { fetcher });
}

/** A configuration resolved the way the Worker resolves it, routing key and all, which is what a collection request carries. */
function resolveThroughLibrary(feedConfig: SourceConfig): Promise<ResolvedFeed> {
  return resolveLibraryFeed({ ...feedConfig, source: "ogc" }, carriedLibraries("ogc"));
}

function fixture(name: string): JsonValue {
  return parseJson(readFileSync(new URL(`./fixtures/ogc/${name}`, import.meta.url), "utf8"));
}

const municipiosCollection = fixture("dgt-municipios-collection.json");
const municipiosSchema = fixture("dgt-municipios-schema.json");
const municipiosPage = fixture("dgt-municipios-page.json");
const airCollection = fixture("azores-air-collection.json");
const airSchema = fixture("azores-air-schema.json");
const airStations = fixture("azores-air-stations.json");
const lagoasPage = fixture("azores-lagoas-page.json");

/** One synthetic feature, so a test can build pages of any length without a fixture per size. */
function feature(id: number): JsonObject {
  return {
    type: "Feature",
    id: `m${id}`,
    properties: { dtmn: `m${id}`, municipio: `Municipality ${id}`, area_ha: id * 1.5 },
    geometry: { type: "Point", coordinates: [-9.1 + id / 1000, 38.7] },
  };
}

interface PageOptions {
  count: number;
  matched: number;
  /** The offset the page's `next` link carries; no link when absent. */
  next?: number;
  /** What the page claims it returned, when a test wants that to disagree with reality. */
  returned?: number;
  first?: number;
  host?: string;
  collection?: string;
}

function itemsPage(options: PageOptions): JsonObject {
  const host = options.host ?? DGT_HOST;
  const collection = options.collection ?? "municipios";
  const first = options.first ?? 0;
  const links: JsonObject[] = [{ rel: "self", type: "application/geo+json", href: `https://${host}/collections/${collection}/items?f=json` }];
  if (options.next !== undefined) {
    links.push({ rel: "next", type: "application/geo+json", href: `https://${host}/collections/${collection}/items?f=json&offset=${options.next}` });
  }
  return {
    type: "FeatureCollection",
    features: Array.from({ length: options.count }, (_, index) => feature(first + index)),
    numberReturned: options.returned ?? options.count,
    numberMatched: options.matched,
    links,
  };
}

/** The collection description, the schema, the count query and the item pages of one service. */
function serviceFetcher(pages: (offset: number) => JsonValue, matched: number, overrides: Partial<ServiceOverrides> = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    if (overrides.onRequest) {
      const answer = overrides.onRequest(url, init);
      if (answer) return answer;
    }
    if (url.pathname.endsWith("/schema")) return Response.json(overrides.schema ?? municipiosSchema);
    if (!url.pathname.endsWith("/items")) return Response.json(overrides.collection ?? municipiosCollection);
    if (url.searchParams.get("resulttype") === "hits") {
      return Response.json({ type: "FeatureCollection", features: [], numberReturned: 0, numberMatched: matched, links: [] });
    }
    return Response.json(pages(Number(url.searchParams.get("offset") ?? "0")));
  });
}

interface ServiceOverrides {
  collection: JsonValue;
  schema: JsonValue;
  onRequest: (url: URL, init?: RequestInit) => Response | undefined;
}

function bodyOf(fetched: SourceFetch): SourceBody {
  if (fetched.kind !== "body") throw new Error(`Expected a source body, got ${fetched.kind}`);
  return fetched;
}

async function readText(body: ReadableStream<Uint8Array> | Uint8Array): Promise<string> {
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const part = await reader.read();
    if (part.done) return text + decoder.decode();
    text += decoder.decode(part.value, { stream: true });
  }
}

async function readDocument(fetched: SourceFetch): Promise<JsonObject> {
  const parsed = parseJson(await readText(bodyOf(fetched).body));
  if (!isJsonObject(parsed)) throw new Error("The collected document is a JSON object");
  return parsed;
}

function featureIds(document: JsonObject): string[] {
  if (!Array.isArray(document.features)) throw new Error("The collected document carries features");
  return document.features.map((item) => (isJsonObject(item) && isJsonString(item.id) ? item.id : ""));
}

async function request(overrides: Partial<CollectionRequest> = {}): Promise<CollectionRequest> {
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: "collection_1",
    feed: { id: "feed_1", slug: "dgt-caop-municipios-feed", title: "Municipalities", description: "test feed" },
    resolved: await resolveThroughLibrary(config),
    feedEpoch: "epoch-1",
    mode: { kind: "live" },
    limits: { sourceBytes: 4_194_304, outputBytes: 4_194_304, frameBytes: 262_144, recordBytes: 262_144, records: 10_000, products: 4 },
    deadline: new Date(Date.now() + 10_000).toISOString(),
    observedAt: "2026-09-15T10:00:00.000Z",
    ...overrides,
  };
}

async function frames(stream: ReadableStream<Uint8Array>): Promise<JsonObject[]> {
  return (await readText(stream))
    .trim()
    .split("\n")
    .map((line) => {
      const frame = parseJson(line);
      if (!isJsonObject(frame)) throw new Error("Every frame is a JSON object");
      return frame;
    });
}

function chunked(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

const transformContext = {
  feed: {
    slug: "dgt-caop-municipios-feed",
    title: "Mainland Portugal municipality reference table (CAOP 2025)",
    description: "test feed",
    config,
    semantics: { domainSubject: "feature" as const, defaultProductRole: "reference" as const },
  },
  observedAt: "2026-09-15T10:00:00.000Z",
};

describe("OGC API Features configuration", () => {
  it("canonicalizes a configuration and fills in its defaults", () => {
    expect(validateOgcFeedConfig({ host: `  ${DGT_HOST.toUpperCase()} `, collection: "municipios" }, hosts)).toEqual({
      host: DGT_HOST,
      collection: "municipios",
      geometry: "include",
      pageSize: "500",
      maxPages: "100",
    });
  });

  it("keeps a base path and a requested property list", () => {
    expect(validateOgcFeedConfig({ host: AZORES_HOST, basePath: "/idea-api/", collection: "Farois", properties: " unique_id , designacao ,unique_id" }, hosts)).toEqual({
      host: AZORES_HOST,
      basePath: "idea-api",
      collection: "Farois",
      geometry: "include",
      properties: "unique_id,designacao",
      pageSize: "500",
      maxPages: "100",
    });
  });

  it("keeps an attribute the collection is cut by", () => {
    expect(validateOgcFeedConfig({ host: DGT_HOST, collection: "crus", filterField: " municipio ", filterValue: " LISBOA " }, hosts)).toEqual({
      host: DGT_HOST,
      collection: "crus",
      geometry: "include",
      filterField: "municipio",
      filterValue: "LISBOA",
      pageSize: "500",
      maxPages: "100",
    });
  });

  it.each([
    ["an unknown field", { host: DGT_HOST, collection: "municipios", bbox: "-9,38,-8,39" }],
    ["a filter attribute without a value", { host: DGT_HOST, collection: "crus", filterField: "municipio" }],
    ["a filter value without an attribute", { host: DGT_HOST, collection: "crus", filterValue: "LISBOA" }],
    ["a filter attribute with a quote", { host: DGT_HOST, collection: "crus", filterField: "municipio','x", filterValue: "LISBOA" }],
    ["a filter value carrying a newline", { host: DGT_HOST, collection: "crus", filterField: "municipio", filterValue: "LISBOA\nPORTO" }],
    ["a filter value that is only spaces", { host: DGT_HOST, collection: "crus", filterField: "municipio", filterValue: "   " }],
    ["a filter on the parameter that bounds the page", { host: DGT_HOST, collection: "crus", filterField: "limit", filterValue: "999999" }],
    ["a filter on the parameter that walks the pages", { host: DGT_HOST, collection: "crus", filterField: "offset", filterValue: "0" }],
    ["a filter on the parameter that drops the outlines", { host: DGT_HOST, collection: "crus", filterField: "skipGeometry", filterValue: "false" }],
    ["a filter on the parameter that names the format", { host: DGT_HOST, collection: "crus", filterField: "f", filterValue: "html" }],
    ["a filter on the parameter that counts instead of returning", { host: DGT_HOST, collection: "crus", filterField: "resulttype", filterValue: "hits" }],
    ["a collection with a slash", { host: DGT_HOST, collection: "municipios/items" }],
    ["a collection that escapes its path", { host: DGT_HOST, collection: ".." }],
    ["a base path that escapes its service", { host: DGT_HOST, basePath: "a/../..", collection: "municipios" }],
    ["a host carrying a path", { host: `${DGT_HOST}/collections`, collection: "municipios" }],
    ["a host carrying credentials", { host: `user:pass@${DGT_HOST}`, collection: "municipios" }],
    ["a host carrying a port", { host: `${DGT_HOST}:8443`, collection: "municipios" }],
    ["a geometry option that is neither", { host: DGT_HOST, collection: "municipios", geometry: "simplify" }],
    ["a page size of zero", { host: DGT_HOST, collection: "municipios", pageSize: "0" }],
    ["a page size past the cap", { host: DGT_HOST, collection: "municipios", pageSize: "50000" }],
    ["a page count past the cap", { host: DGT_HOST, collection: "municipios", maxPages: "5000" }],
    ["a property name with a quote", { host: DGT_HOST, collection: "municipios", properties: "dtmn','x" }],
  ])("refuses %s", (_label, candidate) => {
    expect(() => validateOgcFeedConfig(candidate, hosts)).toThrow(GatekeeperError);
  });

  it("refuses a host outside the allowlist", () => {
    expect(() => validateOgcFeedConfig({ host: "attacker.example", collection: "municipios" }, hosts)).toThrow(/not allowed/);
  });

  it.each(feedsOf("ogc"))("validates the curated $slug example", (example) => {
    const candidate = libraryConfig(example.config);
    expect(validateOgcFeedConfig(candidate, hosts)).toEqual(candidate);
  });

  it("builds every resource URL from validated identifiers alone", () => {
    expect(itemsUrl(config).toString()).toBe(`https://${DGT_HOST}/collections/municipios/items?f=json&limit=1000&skipGeometry=true`);
    expect(itemsUrl(config, 1000).toString()).toBe(`https://${DGT_HOST}/collections/municipios/items?f=json&limit=1000&offset=1000&skipGeometry=true`);
    // A geometry-bearing feed names CRS84 explicitly rather than trusting the service default.
    expect(itemsUrl({ host: AZORES_HOST, basePath: "idea-api", collection: "Farois", geometry: "include", properties: "unique_id,designacao" }).toString()).toBe(
      `https://${AZORES_HOST}/idea-api/collections/Farois/items?f=json&limit=500&crs=${encodeURIComponent("http://www.opengis.net/def/crs/OGC/1.3/CRS84")}&properties=unique_id%2Cdesignacao`,
    );
  });

  it("asks the service for one attribute's value, and counts that subset alone", async () => {
    const filtered = { ...config, collection: "crus", filterField: "municipio", filterValue: "LISBOA" };
    expect(itemsUrl(filtered).toString()).toBe(`https://${DGT_HOST}/collections/crus/items?f=json&limit=1000&skipGeometry=true&municipio=LISBOA`);
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1, collection: "crus" }), 1, { collection: { id: "crus", itemType: "feature", title: "CRUS" } });
    await readDocument(await collectOgcFeed(filtered, undefined, hosts, fetcher));
    // The count query decides completeness, so it must be cut the same way the
    // pages are: counting the whole collection would call the subset partial.
    const hits = fetcher.mock.calls.map((call) => new URL(String(call[0]))).find((url) => url.searchParams.get("resulttype") === "hits");
    expect(hits?.searchParams.get("municipio")).toBe("LISBOA");
  });

  it("gives a feed cut by an attribute its own resource key", async () => {
    const lisboa = await resolveOgcFeed({ host: DGT_HOST, collection: "crus", filterField: "municipio", filterValue: "LISBOA" }, hosts);
    const porto = await resolveOgcFeed({ host: DGT_HOST, collection: "crus", filterField: "municipio", filterValue: "PORTO" }, hosts);
    const whole = await resolveOgcFeed({ host: DGT_HOST, collection: "crus" }, hosts);
    expect(new Set([lisboa.resourceKey, porto.resourceKey, whole.resourceKey]).size).toBe(3);
  });

  it("gives two feeds that differ only in how much they read the same resource key", async () => {
    const small = await resolveOgcFeed({ host: DGT_HOST, collection: "municipios", pageSize: "10" }, hosts);
    const large = await resolveOgcFeed({ host: DGT_HOST, collection: "municipios", pageSize: "500" }, hosts);
    expect(small.resourceKey).toBe(large.resourceKey);
    expect(small.configHash).not.toBe(large.configHash);
  });

  it("gives a geometry-bearing feed a different resource key from an attributes-only one", async () => {
    const withGeometry = await resolveOgcFeed({ host: DGT_HOST, collection: "municipios", geometry: "include" }, hosts);
    const without = await resolveOgcFeed({ host: DGT_HOST, collection: "municipios", geometry: "skip" }, hosts);
    expect(withGeometry.resourceKey).not.toBe(without.resourceKey);
  });

  it("declares no history, because neither service publishes an older edition", async () => {
    const resolved = await resolveOgcFeed(config, hosts);
    expect(resolved.history).toBeUndefined();
    const result = await collectNormalized(
      await request({ mode: { kind: "history", cursor: { before: "2026-01-01T00:00:00.000Z" } } }),
      ogcCollector(
        config,
        serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1),
      ),
    );
    expect(result).toEqual({ kind: "failure", code: "history-unsupported", retryable: false });
  });
});

describe("OGC API Features collection", () => {
  it("walks pages the service links, rebuilding every URL from its offset", async () => {
    const fetcher = serviceFetcher((offset) => itemsPage({ count: offset < 4 ? 2 : 1, matched: 5, first: offset, next: offset + 2 <= 4 ? offset + 2 : undefined }), 5);
    const fetched = await collectOgcFeed({ ...config, pageSize: "2", maxPages: "5" }, undefined, hosts, fetcher);
    const document = await readDocument(fetched);
    expect(featureIds(document)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(bodyOf(fetched).completeness).toBe("complete");
    const requested = fetcher.mock.calls.map((call) => new URL(String(call[0])).search);
    expect(requested.filter((search) => search.includes("limit=2"))).toEqual([
      "?f=json&limit=2&skipGeometry=true",
      "?f=json&limit=2&offset=2&skipGeometry=true",
      "?f=json&limit=2&offset=4&skipGeometry=true",
    ]);
  });

  it("stops at the page cap and says the snapshot is partial before any feature is read", async () => {
    const fetcher = serviceFetcher((offset) => itemsPage({ count: 2, matched: 100, first: offset, next: offset + 2 }), 100);
    const fetched = await collectOgcFeed({ ...config, pageSize: "2", maxPages: "3" }, undefined, hosts, fetcher);
    expect(bodyOf(fetched).completeness).toBe("partial");
    expect(featureIds(await readDocument(fetched))).toHaveLength(6);
  });

  it("calls a collection whose size the service will not state unknown, never complete", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/schema")) return Response.json(municipiosSchema);
      if (!url.pathname.endsWith("/items")) return Response.json(municipiosCollection);
      if (url.searchParams.get("resulttype") === "hits") return new Response("no", { status: 400 });
      return Response.json(itemsPage({ count: 2, matched: 2 }));
    });
    const fetched = await collectOgcFeed(config, undefined, hosts, fetcher);
    expect(bodyOf(fetched).completeness).toBe("unknown");
  });

  it("ignores a count query the service answered with real features", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/schema")) return Response.json(municipiosSchema);
      if (!url.pathname.endsWith("/items")) return Response.json(municipiosCollection);
      // A service that ignores `resulttype` answers a normal first page.
      if (url.searchParams.get("resulttype") === "hits") return Response.json(itemsPage({ count: 2, matched: 2 }));
      return Response.json(itemsPage({ count: 2, matched: 2 }));
    });
    expect(bodyOf(await collectOgcFeed(config, undefined, hosts, fetcher)).completeness).toBe("unknown");
  });

  it("refuses a next link that points at another host", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 2, matched: 10, next: 2, host: "attacker.example" }), 10);
    const fetched = await collectOgcFeed({ ...config, pageSize: "2" }, undefined, hosts, fetcher);
    await expect(readDocument(fetched)).rejects.toThrow(/attacker\.example/);
  });

  it("refuses a next link that points at another resource on the same host", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 2, matched: 10, next: 2, collection: "crus" }), 10);
    const fetched = await collectOgcFeed({ ...config, pageSize: "2" }, undefined, hosts, fetcher);
    await expect(readDocument(fetched)).rejects.toThrow(/another resource/);
  });

  it.each([
    ["a plain-HTTP link", "http://ogcapi.dgterritorio.gov.pt/collections/municipios/items?offset=2"],
    ["a credentialled link", "https://user:pass@ogcapi.dgterritorio.gov.pt/collections/municipios/items?offset=2"],
    ["a ported link", "https://ogcapi.dgterritorio.gov.pt:8443/collections/municipios/items?offset=2"],
    ["a file link", "file:///etc/passwd"],
  ])("refuses %s as a continuation", async (_label, href) => {
    const page = itemsPage({ count: 2, matched: 10 });
    page.links = [{ rel: "next", href }];
    const fetcher = serviceFetcher(() => page, 10);
    const fetched = await collectOgcFeed({ ...config, pageSize: "2" }, undefined, hosts, fetcher);
    await expect(readDocument(fetched)).rejects.toThrow(GatekeeperError);
  });

  it("refuses a next link whose offset does not move forwards", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 2, matched: 10, next: 0 }), 10);
    const fetched = await collectOgcFeed({ ...config, pageSize: "2" }, undefined, hosts, fetcher);
    await expect(readDocument(fetched)).rejects.toThrow(/did not move forwards/);
  });

  it("refuses an empty page that still promises another", async () => {
    const fetcher = serviceFetcher((offset) => itemsPage({ count: offset === 0 ? 2 : 0, matched: 10, first: offset, next: offset + 2 }), 10);
    const fetched = await collectOgcFeed({ ...config, pageSize: "2" }, undefined, hosts, fetcher);
    await expect(readDocument(fetched)).rejects.toThrow(/after returning no features/);
  });

  it("refuses a page whose stated count disagrees with what it carried", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 2, returned: 5, matched: 10, next: 2 }), 10);
    const fetched = await collectOgcFeed({ ...config, pageSize: "2" }, undefined, hosts, fetcher);
    await expect(readDocument(fetched)).rejects.toThrow(/reported 5 features and returned 2/);
  });

  it("follows a redirect that stays inside its own collection", async () => {
    let redirected = false;
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, {
      onRequest: (url) => {
        if (!redirected && url.pathname.endsWith("/items") && url.searchParams.get("resulttype") === null) {
          redirected = true;
          return new Response(null, { status: 308, headers: { location: `${url.toString()}&lang=pt` } });
        }
        return undefined;
      },
    });
    expect(featureIds(await readDocument(await collectOgcFeed(config, undefined, hosts, fetcher)))).toEqual(["m0"]);
  });

  it.each([
    ["another host", "https://attacker.example/collections/municipios/items"],
    ["another collection", `https://${DGT_HOST}/collections/crus/items`],
    ["a plain-HTTP origin", `http://${DGT_HOST}/collections/municipios/items`],
    // A bare prefix test would let these through: they are siblings whose names
    // merely begin with this collection's name, not parts of it.
    ["a sibling whose name extends this one", `https://${DGT_HOST}/collections/municipios2/items`],
    ["a sibling with a suffixed name", `https://${DGT_HOST}/collections/municipios-antigos/items`],
  ])("refuses a redirect to %s", async (_label, location) => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, {
      onRequest: (url) => (url.pathname.endsWith("/items") && url.searchParams.get("resulttype") === null ? new Response(null, { status: 302, headers: { location } }) : undefined),
    });
    await expect(collectOgcFeed(config, undefined, hosts, fetcher)).rejects.toThrow(GatekeeperError);
  });

  it("stops after a few redirects rather than following a loop", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, {
      onRequest: (url) =>
        url.pathname.endsWith("/items") && url.searchParams.get("resulttype") === null
          ? new Response(null, { status: 302, headers: { location: `https://${DGT_HOST}/collections/municipios/items?f=json&hop=${Math.random()}` } })
          : undefined,
    });
    await expect(collectOgcFeed(config, undefined, hosts, fetcher)).rejects.toThrow(/redirected too many times/);
  });

  it("refuses features in a coordinate reference system that is not WGS 84", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, {
      onRequest: (url) =>
        url.pathname.endsWith("/items") && url.searchParams.get("resulttype") === null
          ? Response.json(itemsPage({ count: 1, matched: 1 }), { headers: { "content-crs": "<http://www.opengis.net/def/crs/EPSG/0/3763>" } })
          : undefined,
    });
    await expect(collectOgcFeed({ ...config, geometry: "include" }, undefined, hosts, fetcher)).rejects.toThrow(/not WGS 84/);
  });

  it("refuses a collection that holds something other than features", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, {
      collection: { id: "municipios", itemType: "record", title: "Records" },
    });
    await expect(collectOgcFeed(config, undefined, hosts, fetcher)).rejects.toThrow(/not features/);
  });

  it("refuses a service that answered with a different collection", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, {
      collection: { id: "crus", itemType: "feature", title: "Land use" },
    });
    await expect(collectOgcFeed(config, undefined, hosts, fetcher)).rejects.toThrow(/returned collection crus/);
  });

  it("turns an upstream failure into a retryable error carrying its Retry-After", async () => {
    const fetcher = vi.fn(async () => new Response("slow down", { status: 429, headers: { "retry-after": "42" } }));
    await expect(collectOgcFeed(config, undefined, hosts, fetcher)).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: 42,
    });
  });

  it("keeps collecting when the service publishes no schema", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, {
      onRequest: (url) => (url.pathname.endsWith("/schema") ? new Response("not found", { status: 404 }) : undefined),
    });
    const document = await readDocument(await collectOgcFeed(config, undefined, hosts, fetcher));
    expect(isJsonObject(document.ogc) && document.ogc.schema).toBeUndefined();
  });
});

describe("OGC API Features freshness", () => {
  it("never makes a conditional request, so no page can be skipped unseen", async () => {
    const conditional: string[] = [];
    const fetcher = serviceFetcher((offset) => itemsPage({ count: 2, matched: 4, first: offset, next: offset === 0 ? 2 : undefined }), 4, {
      onRequest: (url, init) => {
        const headers = new Headers(init?.headers);
        const sent = headers.get("if-none-match") ?? headers.get("if-modified-since");
        if (sent) conditional.push(`${url.pathname} ${sent}`);
        return undefined;
      },
    });
    // Even handed a checkpoint that looks like a usable validator, nothing is sent.
    const fetched = await collectOgcFeed(
      { ...config, pageSize: "2" },
      { singlePage: true, validators: { default: { etag: '"page-one"', lastModified: "Mon, 07 Sep 2026 16:44:09 GMT" } } },
      hosts,
      fetcher,
    );
    expect(fetched.kind).toBe("body");
    expect(conditional).toEqual([]);
    expect(featureIds(await readDocument(fetched))).toEqual(["m0", "m1", "m2", "m3"]);
  });

  it("keeps no transport state, so a grown collection can never be suppressed by a stale ETag", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 2, matched: 2 }), 2, {
      onRequest: (url) =>
        url.pathname.endsWith("/items") && url.searchParams.get("resulttype") === null
          ? Response.json(itemsPage({ count: 2, matched: 2 }), { headers: { etag: '"page-one"' } })
          : undefined,
    });
    expect(bodyOf(await collectOgcFeed({ ...config, pageSize: "10" }, undefined, hosts, fetcher)).state).toEqual({});
  });

  it("refuses a 304, which it never asked for", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, {
      onRequest: (url) => (url.pathname.endsWith("/items") && url.searchParams.get("resulttype") === null ? new Response(null, { status: 304 }) : undefined),
    });
    await expect(collectOgcFeed(config, undefined, hosts, fetcher)).rejects.toThrow(/304 to an unconditional request/);
  });

  it("collects the same document twice from the same source, with no clock of its own", async () => {
    const first = await readDocument(
      await collectOgcFeed(
        config,
        undefined,
        hosts,
        serviceFetcher(() => municipiosPage, 278),
      ),
    );
    const second = await readDocument(
      await collectOgcFeed(
        config,
        undefined,
        hosts,
        serviceFetcher(() => municipiosPage, 278),
      ),
    );
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/2026-09-1[56]T\d\d:\d\d/);
  });

  it("dates no row, because neither service publishes a modification time", async () => {
    const fetched = bodyOf(
      await collectOgcFeed(
        config,
        undefined,
        hosts,
        serviceFetcher(() => municipiosPage, 278),
      ),
    );
    expect(fetched.provenance.sourcePublishedAt).toBeUndefined();
    expect(fetched.provenance.sourceUrl).toBe(`https://${DGT_HOST}/collections/municipios/items?f=json&limit=1000&skipGeometry=true`);
  });
});

describe("OGC API Features sharded reads", () => {
  const sharded = {
    host: DGT_HOST,
    collection: "crus",
    geometry: "include",
    shardField: "dtcc",
    shardSource: "municipios",
    shardSourceField: "dtmn",
    shardsPerRun: "2",
    pageSize: "10",
    maxPages: "5",
  };

  /** The listing collection, then one page per shard the run asks for. */
  function shardFetcher(codes: string[], counts: Record<string, number> = {}) {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/schema")) return Response.json(municipiosSchema);
      if (url.pathname.includes("/municipios/items")) {
        if (url.searchParams.get("resulttype") === "hits") {
          return Response.json({ type: "FeatureCollection", features: [], numberReturned: 0, numberMatched: codes.length, links: [] });
        }
        // The listing is handed over a page at a time, so a reader that stops
        // after the first page is missing shards rather than failing.
        const size = Number(url.searchParams.get("limit") ?? "1000");
        const from = Number(url.searchParams.get("offset") ?? "0");
        const slice = codes.slice(from, from + size);
        const links = from + size < codes.length ? [{ rel: "next", href: `https://${DGT_HOST}/collections/municipios/items?f=json&limit=${size}&offset=${from + size}` }] : [];
        return Response.json({
          type: "FeatureCollection",
          features: slice.map((code, index) => ({ type: "Feature", id: from + index, properties: { dtmn: code }, geometry: null })),
          numberReturned: slice.length,
          numberMatched: codes.length,
          links,
        });
      }
      if (!url.pathname.endsWith("/items")) return Response.json({ id: "crus", itemType: "feature", title: "CRUS" });
      const code = url.searchParams.get("dtcc") ?? "";
      const count = counts[code] ?? 1;
      if (url.searchParams.get("resulttype") === "hits") {
        return Response.json({ type: "FeatureCollection", features: [], numberReturned: 0, numberMatched: count, links: [] });
      }
      return Response.json({
        type: "FeatureCollection",
        features: Array.from({ length: count }, (_, index) => ({ ...feature(index), id: `${code}-${index}` })),
        numberReturned: count,
        numberMatched: count,
        links: [],
      });
    });
  }

  it("takes the next shards after where the last run stopped, and says where it got to", async () => {
    const fetcher = shardFetcher(["0101", "0102", "0103"]);
    const first = await collectOgcFeed(sharded, undefined, hosts, fetcher);
    expect(featureIds(await readDocument(first))).toEqual(["0101-0", "0102-0"]);
    expect(bodyOf(first).state).toMatchObject({ cursor: 2, shards: 3, covered: ["0101", "0102"] });

    const second = await collectOgcFeed(sharded, bodyOf(first).state, hosts, shardFetcher(["0101", "0102", "0103"]));
    // The list is worked round in turn, so the third shard comes next and the
    // rotation wraps back to the first.
    expect(featureIds(await readDocument(second))).toEqual(["0103-0", "0101-0"]);
  });

  it("is always a part of the collection, so nothing is retracted for being unasked", async () => {
    const fetched = await collectOgcFeed(sharded, undefined, hosts, shardFetcher(["0101", "0102"]));
    expect(bodyOf(fetched).completeness).toBe("partial");
  });

  it("reads the shard values from the collection that lists them", async () => {
    const fetcher = shardFetcher(["0101", "0102"]);
    await readDocument(await collectOgcFeed(sharded, undefined, hosts, fetcher));
    const listing = fetcher.mock.calls
      .map((call) => new URL(String(call[0])))
      .find((url) => url.pathname.includes("/municipios/items") && url.searchParams.get("resulttype") !== "hits");
    expect(listing?.searchParams.get("properties")).toBe("dtmn");
    // The parcels are asked for by that value, not by the name beside it.
    const asked = fetcher.mock.calls.map((call) => new URL(String(call[0])).searchParams.get("dtcc")).filter((value) => value !== null);
    expect(new Set(asked)).toEqual(new Set(["0101", "0102"]));
  });

  it("reads a shard listing that runs past one page, so no shard is left unread", async () => {
    // Twelve values at four to a page: a reader that took the first page alone
    // would never ask for the last eight municipalities at all.
    const codes = ["0101", "0102", "0103", "0104", "0105", "0106", "0107", "0108", "0109", "0110", "0111", "0112"];
    const fetcher = shardFetcher(codes);
    const fetched = await collectOgcFeed({ ...sharded, shardsPerRun: "12" }, { cursor: 8, shards: 12, covered: [] }, hosts, fetcher);
    // Starting at the ninth, the rotation must reach values that only a later page carries.
    expect(featureIds(await readDocument(fetched))).toContain("0112-0");
    expect(bodyOf(fetched).state).toMatchObject({ shards: 12 });
  });

  it("starts again when the list of shards has shrunk under the cursor", async () => {
    const fetched = await collectOgcFeed(sharded, { cursor: 99, shards: 100, covered: [] }, hosts, shardFetcher(["0101", "0102"]));
    expect(featureIds(await readDocument(fetched))).toEqual(["0101-0", "0102-0"]);
  });

  it("walks a shard that runs to several pages, whole", async () => {
    const fetcher = shardFetcher(["0101"], { "0101": 25 });
    const document = await readDocument(await collectOgcFeed({ ...sharded, shardsPerRun: "1" }, undefined, hosts, fetcher));
    expect(featureIds(document)).toHaveLength(25);
  });

  it.each([
    ["a shard field that names a query parameter", { ...sharded, shardField: "limit" }],
    ["a shard listing without the field holding its values", { ...sharded, shardSourceField: "" }],
    ["a shard read that also cuts by a fixed value", { ...sharded, filterField: "municipio", filterValue: "LISBOA" }],
  ])("refuses %s", (_label, candidate) => {
    expect(() => validateOgcFeedConfig(candidate, hosts)).toThrow(GatekeeperError);
  });

  it("reads the same resource whether or not it is sharded, and says the configuration differs", async () => {
    // Sharding is how much of a collection one run reads, not which collection
    // it is — the same distinction page size already draws. What it must not do
    // is quietly reuse a checkpoint: the configuration hash differs, and that is
    // what decides whether the shard cursor from an unsharded run is handed back.
    const whole = { host: DGT_HOST, collection: "crus", geometry: "include", pageSize: "10", maxPages: "5" };
    const inShards = { ...whole, shardField: "dtcc", shardSource: "municipios", shardSourceField: "dtmn", shardsPerRun: "2" };
    const one = await resolveOgcFeed(whole, hosts);
    const other = await resolveOgcFeed(inShards, hosts);
    expect(other.resourceKey).toBe(one.resourceKey);
    expect(other.configHash).not.toBe(one.configHash);
  });
});

describe("OGC API Features page retries", () => {
  it("tries a page again when the service answers 502, rather than failing a long walk", async () => {
    // Walking a national collection takes tens of pages, and this service fails
    // about one page in fifty. Without a retry a long walk almost never ends.
    let attempts = 0;
    const fetcher = serviceFetcher((offset) => itemsPage({ count: 2, matched: 4, first: offset, next: offset === 0 ? 2 : undefined }), 4, {
      onRequest: (url) => {
        if (url.searchParams.get("offset") !== "2") return undefined;
        attempts += 1;
        return attempts === 1 ? new Response("", { status: 502 }) : undefined;
      },
    });
    const document = await readDocument(await collectOgcFeed({ ...config, pageSize: "2", maxPages: "5" }, undefined, hosts, fetcher, async () => undefined));
    expect(featureIds(document)).toEqual(["m0", "m1", "m2", "m3"]);
    expect(attempts).toBe(2);
  });

  it("tries a page again when the connection itself fails", async () => {
    let attempts = 0;
    const answers = serviceFetcher((offset) => itemsPage({ count: 2, matched: 4, first: offset, next: offset === 0 ? 2 : undefined }), 4);
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (url.searchParams.get("offset") === "2") {
        attempts += 1;
        if (attempts === 1) throw new TypeError("fetch failed");
      }
      return answers(input, init);
    });
    const document = await readDocument(await collectOgcFeed({ ...config, pageSize: "2", maxPages: "5" }, undefined, hosts, fetcher, async () => undefined));
    expect(featureIds(document)).toEqual(["m0", "m1", "m2", "m3"]);
    expect(attempts).toBe(2);
  });

  it("raises its own refusal without trying again, because the answer would not change", async () => {
    let attempts = 0;
    const fetcher = serviceFetcher((offset) => itemsPage({ count: 1, matched: 2, first: offset, next: offset === 0 ? 1 : undefined }), 2, {
      onRequest: (url) => {
        if (url.searchParams.get("offset") !== "1") return undefined;
        attempts += 1;
        return new Response(null, { status: 302, headers: { location: "https://attacker.example/collections/municipios/items" } });
      },
    });
    await expect(readDocument(await collectOgcFeed({ ...config, pageSize: "1", maxPages: "5" }, undefined, hosts, fetcher, async () => undefined))).rejects.toThrow(/not allowed/);
    expect(attempts).toBe(1);
  });

  it("gives up on a page the service keeps refusing, rather than publishing a short collection", async () => {
    const fetcher = serviceFetcher((offset) => itemsPage({ count: 2, matched: 4, first: offset, next: offset === 0 ? 2 : undefined }), 4, {
      onRequest: (url) => (url.searchParams.get("offset") === "2" ? new Response("", { status: 502 }) : undefined),
    });
    await expect(readDocument(await collectOgcFeed({ ...config, pageSize: "2", maxPages: "5" }, undefined, hosts, fetcher, async () => undefined))).rejects.toThrow(/HTTP 502/);
  });

  it("does not retry a refusal the service means, such as one it will repeat", async () => {
    let attempts = 0;
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, {
      onRequest: (url) => {
        if (!url.pathname.endsWith("/items") || url.searchParams.get("resulttype") === "hits") return undefined;
        attempts += 1;
        return new Response("", { status: 404 });
      },
    });
    await expect(collectOgcFeed(config, undefined, hosts, fetcher, async () => undefined)).rejects.toThrow(/HTTP 404/);
    expect(attempts).toBe(1);
  });
});

describe("OGC API Features membership safety", () => {
  it("fails rather than truncating when the collection grew after it was counted", async () => {
    // Counted 2, serves 4: silently cutting to 2 would publish a complete
    // snapshot that is missing members it never saw.
    const fetcher = serviceFetcher(() => itemsPage({ count: 4, matched: 4 }), 2);
    const fetched = await collectOgcFeed({ ...config, pageSize: "10" }, undefined, hosts, fetcher);
    expect(bodyOf(fetched).completeness).toBe("complete");
    await expect(readDocument(fetched)).rejects.toThrow(/more features than the 2 it counted/);
  });

  it("fails when a page offers a continuation the reported count cannot justify", async () => {
    // Counted 4 with room for 6, but keeps offering pages: the count was wrong,
    // so the "complete" header this body already promised cannot be honoured.
    // Six features counted, room for six, but a seventh page is still offered:
    // the count cannot be trusted, so the promised complete membership fails.
    const fetcher = serviceFetcher((offset) => itemsPage({ count: 2, matched: 6, first: offset, next: offset + 2 }), 6);
    const fetched = await collectOgcFeed({ ...config, pageSize: "2", maxPages: "3" }, undefined, hosts, fetcher);
    await expect(readDocument(fetched)).rejects.toThrow(/more pages than the count it reported allows/);
  });

  it("ends cleanly on the empty page pygeoapi links after the last full one", async () => {
    // 192 features read 12 at a time: the service links a next page from offset
    // 180, and that page is empty. Every DGT layer whose count divides evenly by
    // its page size does this, and a walk that called it a violation collected
    // nothing at all.
    const fetcher = serviceFetcher((offset) => itemsPage({ count: offset < 24 ? 12 : 0, matched: 24, first: offset, next: offset + 12 <= 24 ? offset + 12 : undefined }), 24);
    const fetched = await collectOgcFeed({ ...config, pageSize: "12", maxPages: "4" }, undefined, hosts, fetcher);
    expect(bodyOf(fetched).completeness).toBe("complete");
    expect(featureIds(await readDocument(fetched))).toHaveLength(24);
  });

  it("refuses the page after the count when it carries features, rather than truncating to a stale count", async () => {
    // The same shape, except the page past the count is not empty: the
    // collection grew while it was being read, and that must not pass as whole.
    const fetcher = serviceFetcher((offset) => itemsPage({ count: 12, matched: 24, first: offset, next: offset + 12 }), 36);
    const fetched = await collectOgcFeed({ ...config, pageSize: "12", maxPages: "4" }, undefined, hosts, fetcher);
    await expect(readDocument(fetched)).rejects.toThrow(/the collection changed while it was being read/);
  });

  it("still stops cleanly at an explicit cap, which was declared partial up front", async () => {
    const fetcher = serviceFetcher((offset) => itemsPage({ count: 2, matched: 100, first: offset, next: offset + 2 }), 100);
    const fetched = await collectOgcFeed({ ...config, pageSize: "2", maxPages: "3" }, undefined, hosts, fetcher);
    expect(bodyOf(fetched).completeness).toBe("partial");
    expect(featureIds(await readDocument(fetched))).toHaveLength(6);
  });

  it("validates the last page's envelope, not only the pages before it", async () => {
    // The final page lies about its count; nothing follows it to force the check.
    const fetcher = serviceFetcher(() => itemsPage({ count: 2, returned: 9, matched: 2 }), 2);
    const fetched = await collectOgcFeed({ ...config, pageSize: "10" }, undefined, hosts, fetcher);
    await expect(readDocument(fetched)).rejects.toThrow(/reported 9 features and returned 2/);
  });

  it("refuses a feature repeated across pages, which would mask a dropped member", async () => {
    // Both pages serve m0 and m1: the count reaches 4 while two members are missing.
    const fetcher = serviceFetcher((offset) => itemsPage({ count: 2, matched: 4, first: 0, next: offset === 0 ? 2 : undefined }), 4);
    const fetched = await collectOgcFeed({ ...config, pageSize: "2" }, undefined, hosts, fetcher);
    await expect(readDocument(fetched)).rejects.toThrow(/returned feature m0 more than once/);
  });

  it("downgrades, rather than failing, when the service serves fewer than it counted", async () => {
    // Short of its own count is survivable: the product is marked partial, so
    // the kernel cannot retract the members that did not arrive.
    const fetcher = serviceFetcher(() => itemsPage({ count: 2, matched: 2 }), 4);
    const fetched = await collectOgcFeed({ ...config, pageSize: "10" }, undefined, hosts, fetcher);
    const text = await readText(bodyOf(fetched).body);
    const transform = await new OgcTransformer().transform(chunked(text, text.length), transformContext);
    for await (const _row of transform.rows) {
      /* drained */
    }
    expect(transform.finish().products?.[0]?.completeness).toBe("partial");
  });
});

describe("OGC API Features coordinate reference systems", () => {
  it("asks for CRS84 by name when it will publish geometry", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1);
    await readDocument(await collectOgcFeed({ ...config, geometry: "include" }, undefined, hosts, fetcher));
    const items = fetcher.mock.calls.map((call) => new URL(String(call[0]))).filter((url) => url.pathname.endsWith("/items") && url.searchParams.get("resulttype") === null);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((url) => url.searchParams.get("crs") === "http://www.opengis.net/def/crs/OGC/1.3/CRS84")).toBe(true);
  });

  it("refuses ETRS89 geometry rather than calling it WGS 84", async () => {
    // EPSG:4258 is a different datum. It must not pass as WGS 84.
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, {
      onRequest: (url) =>
        url.pathname.endsWith("/items") && url.searchParams.get("resulttype") === null
          ? Response.json(itemsPage({ count: 1, matched: 1 }), { headers: { "content-crs": "<http://www.opengis.net/def/crs/EPSG/0/4258>" } })
          : undefined,
    });
    await expect(collectOgcFeed({ ...config, geometry: "include" }, undefined, hosts, fetcher)).rejects.toThrow(/not WGS 84/);
  });

  it("ignores the response CRS of an attributes-only feed, which publishes no coordinates", async () => {
    // DGT answers skipGeometry responses with its storage CRS; no geometry is emitted, so it does not matter.
    const fetcher = serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, {
      onRequest: (url) =>
        url.pathname.endsWith("/items") && url.searchParams.get("resulttype") === null
          ? Response.json(itemsPage({ count: 1, matched: 1 }), { headers: { "content-crs": "<http://www.opengis.net/def/crs/EPSG/0/3763>" } })
          : undefined,
    });
    expect(featureIds(await readDocument(await collectOgcFeed(config, undefined, hosts, fetcher)))).toEqual(["m0"]);
  });

  it("refuses a geometry collection that advertises no readable CRS, and accepts an attributes-only one", async () => {
    const onlyPortuguese = { id: "municipios", itemType: "feature", title: "Municipalities", crs: ["http://www.opengis.net/def/crs/EPSG/0/3763"] };
    await expect(
      collectOgcFeed(
        { ...config, geometry: "include" },
        undefined,
        hosts,
        serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, { collection: onlyPortuguese }),
      ),
    ).rejects.toThrow(/advertises no WGS 84/);
    const attributesOnly = await collectOgcFeed(
      config,
      undefined,
      hosts,
      serviceFetcher(() => itemsPage({ count: 1, matched: 1 }), 1, { collection: onlyPortuguese }),
    );
    expect(bodyOf(attributesOnly).kind).toBe("body");
  });
});

describe("OGC API Features bounding boxes", () => {
  it("reads a box off a polygon", () => {
    const ring = {
      type: "Polygon",
      coordinates: [
        [
          [-9.2, 38.6],
          [-9.0, 38.6],
          [-9.0, 38.8],
          [-9.2, 38.8],
          [-9.2, 38.6],
        ],
      ],
    };
    expect(boundingBox(ring)).toEqual([-9.2, 38.6, -9.0, 38.8]);
  });

  it("drops the elevation of a three-dimensional position rather than reading it as a coordinate", () => {
    // DGT publishes heights on some geometry, and a height read as a longitude
    // puts a parish in the Pacific.
    const ring = {
      type: "Polygon",
      coordinates: [
        [
          [-7.97, 41.44, 159.7],
          [-7.95, 41.44, 360.7],
          [-7.95, 41.45, 360.7],
          [-7.97, 41.45, 159.7],
          [-7.97, 41.44, 159.7],
        ],
      ],
    };
    expect(boundingBox(ring)).toEqual([-7.97, 41.44, -7.95, 41.45]);
  });

  it("spans every member of a multipart geometry and of a collection", () => {
    const parts = {
      type: "MultiPoint",
      coordinates: [
        [-8.6, 41.1],
        [-7.9, 40.2],
        [-8.2, 41.9],
      ],
    };
    expect(boundingBox(parts)).toEqual([-8.6, 40.2, -7.9, 41.9]);
    const mixed = { type: "GeometryCollection", geometries: [{ type: "Point", coordinates: [-9.1, 38.7] }, parts] };
    expect(boundingBox(mixed)).toEqual([-9.1, 38.7, -7.9, 41.9]);
  });

  it("returns nothing for a geometry it cannot place", () => {
    expect(boundingBox(null)).toBeUndefined();
    expect(boundingBox({ type: "Polygon", coordinates: [] })).toBeUndefined();
    // Out of range is a projected coordinate that was never converted, not a place.
    expect(boundingBox({ type: "Point", coordinates: [-52_000, 220_000] })).toBeUndefined();
  });
});

describe("OGC API Features normalization", () => {
  const transformer = new OgcTransformer();

  async function normalize(fetched: SourceFetch, chunkSize?: number) {
    const text = await readText(bodyOf(fetched).body);
    const body = chunkSize === undefined ? bodyOf(fetched).body : chunked(text, chunkSize);
    const source = chunkSize === undefined ? chunked(text, text.length) : body;
    const transform = await transformer.transform(source, transformContext);
    const rows: JsonObject[] = [];
    for await (const row of transform.rows) {
      if (row.record) rows.push(row.record.payload);
    }
    return { transform, rows, keys: rows.length };
  }

  it("publishes each municipality once, with the properties the service typed", async () => {
    const fetched = await collectOgcFeed(
      config,
      undefined,
      hosts,
      serviceFetcher(() => municipiosPage, 278),
    );
    const text = await readText(bodyOf(fetched).body);
    const transform = await transformer.transform(chunked(text, text.length), transformContext);
    const records: Array<{ entityKey: string; payload: JsonObject }> = [];
    for await (const row of transform.rows) {
      if (row.record) records.push({ entityKey: row.record.entityKey, payload: row.record.payload });
    }
    expect(records.map((record) => record.entityKey)).toEqual(["0101", "1106", "1824"]);
    expect(records[0]?.payload.municipio).toBe("Águeda");
    // `geometry: skip` was asked for, so no geometry columns are invented.
    expect(Object.keys(records[0]?.payload ?? {})).not.toContain("geometry");
    expect(transform.products[0]?.updateMode).toBe("authoritative-snapshot");
    expect(transform.products[0]?.slug).toBe("dgt-caop-municipios");
    expect(transform.finish().quality).toEqual({ acceptedRecords: 3, rejectedRecords: 0 });
  });

  it("gives every geometry-bearing feature a representative point", async () => {
    const azores = { host: AZORES_HOST, basePath: "idea-api", collection: "Lagoas", geometry: "include", pageSize: "100", maxPages: "6" };
    const lagoasCollection = { id: "Lagoas", itemType: "feature", title: "Lagoas - Região Autónoma dos Açores", description: "Lagoas existentes nas ilhas dos Açores." };
    const fetcher = serviceFetcher(() => lagoasPage, 97, { collection: lagoasCollection, schema: { type: "object", properties: {} } });
    const fetched = await collectOgcFeed(azores, undefined, hosts, fetcher);
    const { rows } = await normalize(fetched);
    expect(rows).toHaveLength(2);
    for (const payload of rows) {
      expect(payload.geometry).not.toBeNull();
      expect(isJsonNumber(payload.latitude)).toBe(true);
      expect(isJsonNumber(payload.longitude)).toBe(true);
      // The Azores sit west of the Greenwich meridian and north of the equator.
      expect(Number(payload.longitude)).toBeLessThan(-24);
      expect(Number(payload.latitude)).toBeGreaterThan(36);
    }
  });

  it("normalizes a real station inventory identically whether fed whole or one byte at a time", async () => {
    const azores = { host: AZORES_HOST, basePath: "idea-api", collection: "RedeMonitorizacao_QualidadeAr", geometry: "include", pageSize: "500", maxPages: "4" };
    const fetcher = () => serviceFetcher(() => airStations, 4, { collection: airCollection, schema: airSchema });
    const whole = await normalize(await collectOgcFeed(azores, undefined, hosts, fetcher()));
    const byByte = await normalize(await collectOgcFeed(azores, undefined, hosts, fetcher()), 1);
    expect(byByte.rows).toEqual(whole.rows);
    expect(whole.rows).toHaveLength(4);
    expect(whole.transform.finish().quality).toEqual({ acceptedRecords: 4, rejectedRecords: 0 });
  });

  it("refines a declared string into a category only once every feature was seen", async () => {
    const fetched = await collectOgcFeed(
      config,
      undefined,
      hosts,
      serviceFetcher(() => municipiosPage, 278),
    );
    const { transform } = await normalize(fetched);
    const declared = transform.products[0]?.schema.fields.find((field) => field.id === "nuts1");
    expect(declared?.type).toBe("string");
    const refined = transform.finish().products?.[0]?.schema?.fields.find((field) => field.id === "nuts1");
    expect(refined?.type).toBe("category");
  });

  it("types a property no schema mentioned from the values it carried", async () => {
    const page = itemsPage({ count: 2, matched: 2 });
    const features = Array.isArray(page.features) ? page.features : [];
    for (const item of features) {
      if (isJsonObject(item) && isJsonObject(item.properties)) {
        item.properties.site = "https://example.pt/a";
        item.properties.updated = "2026-02-01T09:00:00+00:00";
      }
    }
    const fetched = await collectOgcFeed(
      { ...config, geometry: "include" },
      undefined,
      hosts,
      serviceFetcher(() => page, 2),
    );
    const { transform } = await normalize(fetched);
    const fields = transform.finish().products?.[0]?.schema?.fields ?? [];
    expect(fields.find((field) => field.id === "site")?.type).toBe("url");
    expect(fields.find((field) => field.id === "updated")?.type).toBe("datetime");
  });

  it("keeps a property called latitude apart from the point derived from the geometry", async () => {
    const page = itemsPage({ count: 1, matched: 1 });
    const features = Array.isArray(page.features) ? page.features : [];
    const only = features[0];
    if (isJsonObject(only) && isJsonObject(only.properties)) only.properties.latitude = "38,7";
    const fetched = await collectOgcFeed(
      { ...config, geometry: "include" },
      undefined,
      hosts,
      serviceFetcher(() => page, 1),
    );
    const { transform, rows } = await normalize(fetched);
    const fields = transform.finish().products?.[0]?.schema?.fields ?? [];
    expect(fields.filter((field) => field.name === "latitude")).toHaveLength(1);
    expect(fields.some((field) => field.id === "latitude__source")).toBe(true);
    expect(rows[0]?.["latitude (2)"]).toBe("38,7");
    expect(isJsonNumber(rows[0]?.latitude)).toBe(true);
  });

  it("rejects a malformed feature instead of publishing it", async () => {
    const document = `{"type":"FeatureCollection","ogc":${JSON.stringify({
      itemsUrl: `https://${DGT_HOST}/collections/municipios/items?f=json`,
      collectionUrl: `https://${DGT_HOST}/collections/municipios`,
      collectionId: "municipios",
      title: "Municipalities",
      description: "",
      keywords: [],
      geometry: "include",
    })},"features":[{"type":"Feature","properties":{"dtmn":"0101"},"geometry":null,"id":"0101"},{"type":"Point","coordinates":[0,0]}]}`;
    const transform = await transformer.transform(chunked(document, 64), transformContext);
    await expect(
      (async () => {
        for await (const _row of transform.rows) {
          /* drained until it throws */
        }
      })(),
    ).rejects.toThrow(/malformed feature/);
  });

  it("leaves out a feature with no identity at all, counting it as rejected", async () => {
    const page = itemsPage({ count: 2, matched: 2 });
    const features = Array.isArray(page.features) ? page.features : [];
    const second = features[1];
    if (isJsonObject(second)) delete second.id;
    const fetched = await collectOgcFeed(
      { ...config, geometry: "include" },
      undefined,
      hosts,
      serviceFetcher(() => page, 2, { schema: { type: "object", properties: {} } }),
    );
    const { transform, rows } = await normalize(fetched);
    expect(rows).toHaveLength(1);
    expect(transform.finish().quality).toEqual({ acceptedRecords: 1, rejectedRecords: 1 });
  });

  it("downgrades a product that delivered fewer features than the service counted", async () => {
    const page = itemsPage({ count: 2, matched: 2 });
    const features = Array.isArray(page.features) ? page.features : [];
    const second = features[1];
    if (isJsonObject(second)) delete second.id;
    const fetched = await collectOgcFeed(
      { ...config, geometry: "include" },
      undefined,
      hosts,
      serviceFetcher(() => page, 2, { schema: { type: "object", properties: {} } }),
    );
    const { transform } = await normalize(fetched);
    expect(transform.finish().products?.[0]?.completeness).toBe("partial");
  });

  it("rejects a multi-byte feature whose UTF-8 size passes the cap though its character count does not", async () => {
    // 400,000 three-byte characters: 400k UTF-16 units, 1.2 MB of UTF-8. A check
    // that compared character count to the byte cap would let this through, and
    // the kernel would then refuse it mid-stream instead of it being one clean
    // rejected row.
    const page = itemsPage({ count: 2, matched: 2 });
    const features = Array.isArray(page.features) ? page.features : [];
    const first = features[0];
    if (isJsonObject(first) && isJsonObject(first.properties)) first.properties.notes = "\u3042".repeat(400_000);
    const fetched = await collectOgcFeed(
      { ...config, geometry: "include" },
      undefined,
      hosts,
      serviceFetcher(() => page, 2),
    );
    const text = await readText(bodyOf(fetched).body);
    const transform = await transformer.transform(chunked(text, 65_536), transformContext);
    const kept: string[] = [];
    for await (const row of transform.rows) {
      if (row.record) kept.push(row.record.entityKey);
    }
    expect(kept).toEqual(["m1"]);
    expect(transform.finish().quality).toEqual({ acceptedRecords: 1, rejectedRecords: 1 });
    expect(transform.finish().products?.[0]?.completeness).toBe("partial");
  });

  it("leaves a feature larger than the kernel can store out, rather than truncating it", async () => {
    const page = itemsPage({ count: 2, matched: 2 });
    const features = Array.isArray(page.features) ? page.features : [];
    const first = features[0];
    if (isJsonObject(first) && isJsonObject(first.properties)) first.properties.notes = "x".repeat(1_100_000);
    const fetched = await collectOgcFeed(
      { ...config, geometry: "include" },
      undefined,
      hosts,
      serviceFetcher(() => page, 2),
    );
    const text = await readText(bodyOf(fetched).body);
    const transform = await transformer.transform(chunked(text, 65_536), transformContext);
    const kept: string[] = [];
    for await (const row of transform.rows) {
      if (row.record) kept.push(row.record.entityKey);
    }
    expect(kept).toEqual(["m1"]);
    expect(transform.finish().quality).toEqual({ acceptedRecords: 1, rejectedRecords: 1 });
    expect(transform.finish().products?.[0]?.completeness).toBe("partial");
  });
});

describe("OGC API Features through the shared collector", () => {
  it("frames a complete collection and closes it with its counts", async () => {
    const collector = ogcCollector(
      config,
      serviceFetcher(() => municipiosPage, 278),
    );
    const result = await collectNormalized(await request(), collector);
    if (result.kind !== "batch") throw new Error(`Expected a batch, got ${result.kind}`);
    const [header, ...rest] = await frames(result.stream);
    expect(header?.type).toBe("header");
    expect(header?.completeness).toBe("complete");
    expect(header?.protocol).toBe(NORMALIZED_PROTOCOL);
    const complete = rest.at(-1);
    expect(complete).toMatchObject({ type: "complete", counts: { records: 3, points: 0 } });
    expect(rest.slice(0, -1).every((frame) => frame.type === "record")).toBe(true);
  });

  it("fails rather than trusting a 304 it never asked for", async () => {
    const fetcher = serviceFetcher(() => itemsPage({ count: 2, matched: 2 }), 2, {
      onRequest: (url) => (url.pathname.endsWith("/items") && url.searchParams.get("resulttype") === null ? new Response(null, { status: 304 }) : undefined),
    });
    const singlePage = { ...config, pageSize: "10" };
    const resolved = await resolveThroughLibrary(singlePage);
    const result = await collectNormalized(
      await request({
        resolved,
        checkpoint: {
          version: 2,
          resourceKey: resolved.resourceKey,
          configHash: resolved.configHash,
          feedEpoch: "epoch-1",
          normalizer: { id: "ogc-api-features", version: "1" },
          state: { singlePage: true, validators: { default: { etag: '"one"' } } },
        },
      }),
      ogcCollector(singlePage, fetcher),
    );
    // No conditional request is ever made, so an unchanged answer is a source fault.
    expect(result).toEqual({ kind: "failure", code: "invalid-response", retryable: false });
  });

  it("collects again, identically, when its checkpoint is for another normalizer", async () => {
    const collector = ogcCollector(
      config,
      serviceFetcher(() => municipiosPage, 278),
    );
    const resolved = await resolveThroughLibrary(config);
    const result = await collectNormalized(
      await request({
        resolved,
        checkpoint: {
          version: 2,
          resourceKey: resolved.resourceKey,
          configHash: resolved.configHash,
          feedEpoch: "epoch-1",
          normalizer: { id: "ogc-api-features", version: "0" },
          state: { singlePage: true, validators: { default: { etag: '"one"' } } },
        },
      }),
      collector,
    );
    expect(result.kind).toBe("batch");
  });

  it("fails the collection rather than completing a truncated stream", async () => {
    const collector = ogcCollector(
      { ...config, pageSize: "2" },
      serviceFetcher((offset) => itemsPage({ count: 2, matched: 10, first: offset, next: offset + 2, host: "attacker.example" }), 10),
    );
    const result = await collectNormalized(await request({ resolved: await resolveThroughLibrary({ ...config, pageSize: "2" }) }), collector);
    if (result.kind !== "batch") throw new Error(`Expected a batch, got ${result.kind}`);
    await expect(frames(result.stream)).rejects.toThrow(/attacker\.example/);
  });

  it("refuses a source body past the collection's byte budget", async () => {
    const wide = itemsPage({ count: 4, matched: 4 });
    const features = Array.isArray(wide.features) ? wide.features : [];
    for (const item of features) {
      if (isJsonObject(item) && isJsonObject(item.properties)) item.properties.notes = "y".repeat(20_000);
    }
    // Enough for the first two features and no more: the batch starts, then
    // truncates, which the kernel rejects. It never completes short.
    const sourceBytes = JSON.stringify(features[0]).length * 2 + 4_096;
    const truncating = await collectNormalized(
      await request({ limits: { sourceBytes, outputBytes: 1_048_576, frameBytes: 262_144, recordBytes: 262_144, records: 1_000, products: 4 } }),
      ogcCollector(
        config,
        serviceFetcher(() => wide, 4),
      ),
    );
    if (truncating.kind !== "batch") throw new Error(`Expected a batch, got ${truncating.kind}`);
    await expect(frames(truncating.stream)).rejects.toThrow(new RegExp(`exceeds ${sourceBytes} bytes`));

    // A budget too small for even one feature fails before a header is framed.
    const immediate = await collectNormalized(
      await request({ limits: { sourceBytes: 4_096, outputBytes: 1_048_576, frameBytes: 262_144, recordBytes: 262_144, records: 1_000, products: 4 } }),
      ogcCollector(
        config,
        serviceFetcher(() => wide, 4),
      ),
    );
    expect(immediate).toEqual({ kind: "failure", code: "response-too-large", retryable: false });
  });
});

describe("OGC API Features examples", () => {
  it("ships every curated collection under its own slug, each naming its own library", () => {
    expect(feedsOf("ogc").every((example) => example.config.source === "ogc")).toBe(true);
    expect(new Set(feedsOf("ogc").map((example) => example.slug)).size).toBe(feedsOf("ogc").length);
    // Six CAOP tables, eighteen SRUP registers plus the SGIFR points, and one
    // feed per municipality whose land-use regime DGT has published nationally.
    expect(feedsOf("ogc").filter((example) => example.slug.startsWith("dgt-caop-"))).toHaveLength(6);
    expect(feedsOf("ogc").filter((example) => example.slug.startsWith("dgt-srup-"))).toHaveLength(18);
    // The land-use regime is one dataset read two ways: the table whole, and
    // its boundaries a few municipalities at a time.
    expect(feedsOf("ogc").filter((example) => example.slug.startsWith("dgt-crus"))).toHaveLength(2);
  });

  it("reads each collection once, unless the second read is its boundaries", () => {
    const attributes = feedsOf("ogc")
      .filter((example) => example.config.geometry === "skip")
      .map((example) => `${example.config.host}/${example.config.collection}`);
    expect(attributes.filter((one, index) => attributes.indexOf(one) !== index)).toEqual([]);
    // Only the land-use charter is read twice, and the two reads differ in what
    // they are for: one is the table entire, the other the outlines it is too
    // large to carry, built up a few municipalities a run.
    const twice = feedsOf("ogc").filter((example) => example.config.collection === "crus");
    expect(twice).toHaveLength(2);
    expect(twice.filter((example) => example.config.geometry === "skip")).toHaveLength(1);
    expect(twice.filter((example) => example.config.shardField !== undefined)).toHaveLength(1);
    // Nothing is cut by a fixed attribute value any more.
    expect(feedsOf("ogc").filter((example) => example.config.filterField !== undefined)).toEqual([]);
  });

  it("reads only the two services it is allowed to read", () => {
    expect(new Set(feedsOf("ogc").map((example) => example.config.host))).toEqual(new Set([DGT_HOST, LNEG_HOST]));
  });

  it("says in every CAOP title that the charter covers the mainland only", () => {
    // These collections stop at the mainland and say so in their own
    // descriptions; the islands are read from the GeoServer by the `wfs`
    // library instead. The NUTS tables name the island regions without holding
    // their areas, and say that too.
    const bounded = feedsOf("ogc").filter((example) => /^dgt-caop-(distritos|municipios|freguesias|nuts[23])-feed$/.test(example.slug));
    expect(bounded).toHaveLength(5);
    for (const example of bounded) {
      expect(example.title, example.slug).toMatch(/mainland/i);
      // The NUTS tables list the island regions as rows without holding their
      // areas, so they say it differently; both say it.
      expect(example.description, example.slug).toMatch(/Azores and Madeira/);
      expect(example.description, example.slug).toMatch(/not part of this collection/);
    }
  });

  it("never calls a feed attributes-only when it publishes coordinates", () => {
    // A description that still says "attributes only" after the feed started
    // carrying its geometry is the one lie a reader cannot check for themselves.
    for (const example of feedsOf("ogc")) {
      if ((example.config.geometry ?? "include") === "skip") continue;
      // The words are the dataset's when the feed is the whole of it.
      expect(example.description ?? datasetOf(example).description, example.slug).not.toMatch(/attributes only|without boundary outlines/i);
    }
  });

  // The eight Azores collections that used to live here were removed in September 2026:
  // ambiente.azores.gov.pt answers our Workers with a Cloudflare challenge. The library
  // tests above still cover the basePath and outline paths those feeds exercised.
  // DGT states CC BY 4.0 on the service's HTML landing page, which pygeoapi
  // leaves out of the JSON this library reads; the same licence is on DGT's own
  // site and on its dados.gov.pt records.
  it("serves the CAOP under the licence DGT states", () => {
    for (const example of feedsOf("ogc")) {
      expect(datasetOf(example).licence).toBe("cc-by-4.0");
      expect(datasetOf(example).attribution ?? "").not.toBe("");
    }
  });

  it("polls reference layers weekly or monthly, never faster, and never calls one stale before it is due", () => {
    for (const example of feedsOf("ogc")) {
      const { cadenceSeconds } = example.policy.collection;
      // A sharded feed's runs do not repeat each other: each reads shards the
      // last did not, so what the source is asked for a given row is the
      // cadence times a whole rotation, not the cadence. That is the number
      // this rule is about, and it is still slower than a week.
      const rotation = example.config.shardsPerRun ? Math.ceil(278 / Number(example.config.shardsPerRun)) : 1;
      expect(cadenceSeconds * rotation, example.slug).toBeGreaterThanOrEqual(43_200);
      if (rotation === 1) expect(cadenceSeconds, example.slug).toBeGreaterThanOrEqual(604_800);
      expect(example.staleAfterSeconds, example.slug).toBeGreaterThanOrEqual(cadenceSeconds);
      expect(example.policy.collection.historyMode, example.slug).toBe("changes");
    }
  });

  it("gives every example room for the collection it reads", () => {
    for (const example of feedsOf("ogc")) {
      const pages = Number(example.config.maxPages ?? "0") * Number(example.config.pageSize ?? "0");
      expect(pages, example.slug).toBeGreaterThan(0);
      // A megabyte is the floor a 36-feature register needs; the layers read
      // with their outlines declare their own, measured, much larger.
      expect(example.policy.collection.maxBytes, example.slug).toBeGreaterThanOrEqual(1024 * 1024);
      // A record is stored whole in SQLite; no policy may ask for more than the kernel keeps.
      expect(example.policy.collection.maxRecordBytes ?? 256 * 1024, example.slug).toBeLessThanOrEqual(1024 * 1024);
      // A walk must be allowed to finish: the deadline has to cover the download
      // at the five mebibytes a second the service was measured to send.
      const seconds = example.policy.collection.maxBytes / (1024 * 1024) / 5;
      expect(example.policy.collection.timeoutSeconds, example.slug).toBeGreaterThanOrEqual(Math.min(seconds, 120));
    }
  });

  it("asks for at least as many pages as the collection it promises needs", () => {
    for (const example of feedsOf("ogc")) {
      const promised = /([\d,]{2,})\s/.exec(example.description ?? datasetOf(example).description)?.[1];
      if (promised === undefined) continue;
      const features = Number(promised.replaceAll(",", ""));
      const room = Number(example.config.maxPages ?? "0") * Number(example.config.pageSize ?? "0");
      expect(room, example.slug).toBeGreaterThanOrEqual(features);
    }
  });
});

describe("OGC final snapshot-boundary regressions", () => {
  it("does not fetch a page beyond an explicit partial cap", async () => {
    const fetcher = serviceFetcher((offset) => {
      expect(offset, "A capped walk must not make an unused next-page request").toBe(0);
      return itemsPage({ count: 1, matched: 2, next: 1 });
    }, 2);
    const fetched = await collectOgcFeed({ ...config, pageSize: "1", maxPages: "1" }, undefined, hosts, fetcher);
    expect(bodyOf(fetched).completeness).toBe("partial");
    expect(featureIds(await readDocument(fetched))).toEqual(["m0"]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it.each([false, true])("rejects duplicate schema-derived identities with native first ID=%s", async (nativeFirst) => {
    const first = feature(1);
    const second = feature(1);
    if (!nativeFirst) delete first.id;
    delete second.id;
    const fetcher = serviceFetcher(() => ({ type: "FeatureCollection", features: [first, second], numberReturned: 2, numberMatched: 2, links: [] }), 2);
    const collector = ogcCollector(config, fetcher);
    const result = await collectNormalized(await request(), collector);
    if (result.kind !== "batch") throw new Error("Expected streaming batch");
    await expect(readText(result.stream)).rejects.toThrow("repeats a normalized feature identity");
  });
});
