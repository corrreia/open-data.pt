import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  GatekeeperError,
  NORMALIZED_PROTOCOL,
  collectNormalized,
  isJsonObject,
  isJsonString,
  libraryConfig,
  parseJson,
  type CollectionRequest,
  type JsonObject,
  type JsonValue,
  type NormalizedRow,
  type SourceBody,
  type SourceFetch,
} from "@open-data-pt/gatekeeper-shared";
import { STAC_EXAMPLES, StacTransformer, collectStacFeed, itemsUrl, resolveStacFeed, stacCollector, validateStacFeedConfig } from "../packages/gatekeeper-shared/src/formats/stac";

const CDD_HOST = "cdd.dgterritorio.gov.pt";
const hosts = new Set([CDD_HOST]);
const allowedHosts = [...hosts].join(",");

const config = { host: CDD_HOST, basePath: "dgt-be/v1", collection: "ORTOS-2025", pageSize: "200", maxPages: "16" };

function fixture(name: string): JsonValue {
  return parseJson(readFileSync(new URL(`./fixtures/stac/${name}`, import.meta.url), "utf8"));
}

const collection = fixture("ortos-2025-collection.json");
const itemsPage = fixture("ortos-2025-items.json");

/** One synthetic item, so a test can build pages of any length. */
function item(id: number): JsonObject {
  return {
    type: "Feature",
    id: `ORTOS-2025-cog-25cm-${id}`,
    collection: "ORTOS-2025",
    bbox: [-8.13, 37.05, -8.04, 37.1],
    geometry: { type: "Polygon", coordinates: [] },
    properties: { size: [32000, 20000], pixelSize: [0.25, -0.25], "proj:epsg": 3763, datetime: "2026-08-07T15:18:07.393926Z" },
    assets: { visual: { href: `https://stratus.example/orto/${id}.tif`, type: "image/tiff", "eo:bands": [{ common_name: "red" }, { common_name: "nir" }] } },
  };
}

interface PageOptions {
  count: number;
  first?: number;
  /** The token the page's `next` link carries; no link when absent. */
  next?: string;
}

function page(options: PageOptions): JsonObject {
  const first = options.first ?? 0;
  const links: JsonObject[] = [{ rel: "self", href: `https://${CDD_HOST}/dgt-be/v1/collections/ORTOS-2025/items?limit=200` }];
  if (options.next !== undefined) {
    links.push({ rel: "next", href: `https://${CDD_HOST}/dgt-be/v1/collections/ORTOS-2025/items?limit=200&token=${options.next}` });
  }
  return { data: { type: "FeatureCollection", features: Array.from({ length: options.count }, (_, index) => item(first + index)), links } };
}

function serviceFetcher(pages: (token: string | null) => JsonValue, overrides: { collection?: JsonValue; onRequest?: (url: URL) => Response | undefined } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input.toString());
    const answer = overrides.onRequest?.(url);
    if (answer) return answer;
    if (!url.pathname.endsWith("/items")) return Response.json(overrides.collection ?? collection);
    return Response.json(pages(url.searchParams.get("token")));
  });
}

function bodyOf(fetched: SourceFetch): SourceBody {
  if (fetched.kind !== "body") throw new Error(`Expected a source body, got ${fetched.kind}`);
  return fetched;
}

async function readText(body: ReadableStream<Uint8Array> | Uint8Array): Promise<string> {
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return new Response(body).text();
}

async function readDocument(fetched: SourceFetch): Promise<JsonObject> {
  const parsed = parseJson(await readText(bodyOf(fetched).body));
  if (!isJsonObject(parsed)) throw new Error("The collected document is a JSON object");
  return parsed;
}

function itemIds(document: JsonObject): string[] {
  if (!Array.isArray(document.features)) throw new Error("The collected document carries features");
  return document.features.map((member) => (isJsonObject(member) && isJsonString(member.id) ? member.id : ""));
}

const transformContext = {
  feed: {
    slug: "dgt-ortofotos-2025-feed",
    title: "Orthophoto tile index 2025 (25 cm)",
    description: "test feed",
    config,
    semantics: { domainSubject: "reference" as const, defaultProductRole: "reference" as const },
  },
  observedAt: "2026-09-21T09:00:00.000Z",
};

async function rowsOf(document: JsonObject): Promise<NormalizedRow[]> {
  const stream = new Response(JSON.stringify(document)).body;
  if (!stream) throw new Error("no stream");
  const built = new StacTransformer().transform(stream, transformContext);
  const rows: NormalizedRow[] = [];
  for await (const row of built.rows) rows.push(row);
  return rows;
}

describe("STAC configuration", () => {
  it("canonicalizes a configuration and fills in its defaults", () => {
    expect(validateStacFeedConfig({ host: ` ${CDD_HOST.toUpperCase()} `, basePath: "/dgt-be/v1/", collection: "ORTOS-2025" }, hosts)).toEqual({
      host: CDD_HOST,
      basePath: "dgt-be/v1",
      collection: "ORTOS-2025",
      pageSize: "200",
      maxPages: "100",
    });
  });

  it.each([
    ["an unknown field", { host: CDD_HOST, collection: "ORTOS-2025", bbox: "-9,38,-8,39" }],
    ["a collection with a slash", { host: CDD_HOST, collection: "ORTOS-2025/items" }],
    ["a collection that escapes its path", { host: CDD_HOST, collection: ".." }],
    ["a base path that escapes its service", { host: CDD_HOST, basePath: "a/../..", collection: "ORTOS-2025" }],
    ["a host carrying credentials", { host: `user:pass@${CDD_HOST}`, collection: "ORTOS-2025" }],
    ["a page size past the cap", { host: CDD_HOST, collection: "ORTOS-2025", pageSize: "5000" }],
  ])("refuses %s", (_label, candidate) => {
    expect(() => validateStacFeedConfig(candidate, hosts)).toThrow(GatekeeperError);
  });

  it("refuses a host outside the allowlist", () => {
    expect(() => validateStacFeedConfig({ host: "attacker.example", collection: "ORTOS-2025" }, hosts)).toThrow(/not allowed/);
  });

  it.each(STAC_EXAMPLES)("validates the curated $slug example", (example) => {
    const candidate = libraryConfig(example.config);
    expect(validateStacFeedConfig(candidate, hosts)).toEqual(candidate);
  });

  it("builds every resource URL from validated identifiers alone", () => {
    expect(itemsUrl(config).toString()).toBe(`https://${CDD_HOST}/dgt-be/v1/collections/ORTOS-2025/items?limit=200`);
    expect(itemsUrl(config, "next:abc").toString()).toBe(`https://${CDD_HOST}/dgt-be/v1/collections/ORTOS-2025/items?limit=200&token=next%3Aabc`);
  });

  it("gives each coverage its own resource key, whatever the page size", async () => {
    const small = await resolveStacFeed({ ...config, pageSize: "10" }, hosts);
    const large = await resolveStacFeed({ ...config, pageSize: "200" }, hosts);
    const other = await resolveStacFeed({ ...config, collection: "ORTOS-2018" }, hosts);
    expect(small.resourceKey).toBe(large.resourceKey);
    expect(other.resourceKey).not.toBe(small.resourceKey);
  });
});

describe("STAC collection", () => {
  it("walks the pages the service links, rebuilding each URL from its token", async () => {
    const fetcher = serviceFetcher((token) => (token === null ? page({ count: 2, next: "t1" }) : page({ count: 1, first: 2 })));
    const document = await readDocument(await collectStacFeed(config, undefined, hosts, fetcher));
    expect(itemIds(document)).toEqual(["ORTOS-2025-cog-25cm-0", "ORTOS-2025-cog-25cm-1", "ORTOS-2025-cog-25cm-2"]);
    const tokens = fetcher.mock.calls.map((call) => new URL(String(call[0])).searchParams.get("token")).filter((value) => value !== null);
    expect(tokens).toEqual(["t1"]);
  });

  it("reads the collection through the proxy envelope the service wraps it in", async () => {
    const fetched = await collectStacFeed(
      config,
      undefined,
      hosts,
      serviceFetcher(() => page({ count: 1 })),
    );
    const document = await readDocument(fetched);
    const described = isJsonObject(document.stac) ? document.stac : {};
    expect(described.collectionId).toBe("ORTOS-2025");
    // The acquisition window belongs to the coverage, and is read from its extent.
    expect(isJsonString(described.start) ? described.start.slice(0, 4) : "").toBe("2025");
  });

  it("shows the items URL a browser can open", async () => {
    const fetched = await collectStacFeed(
      config,
      undefined,
      hosts,
      serviceFetcher(() => page({ count: 1 })),
    );
    expect(bodyOf(fetched).provenance.sourceUrl).toBe(`https://${CDD_HOST}/dgt-be/v1/collections/ORTOS-2025/items?limit=200`);
  });

  it("refuses a next link that points off its own resource", async () => {
    const fetcher = serviceFetcher(() => ({
      data: { type: "FeatureCollection", features: [item(0)], links: [{ rel: "next", href: "https://attacker.example/collections/ORTOS-2025/items?token=x" }] },
    }));
    await expect(readDocument(await collectStacFeed(config, undefined, hosts, fetcher))).rejects.toThrow(/points at attacker.example/);
  });

  it("refuses a next link carrying no token to move on with", async () => {
    const looping = serviceFetcher(() => page({ count: 1, next: "" }));
    await expect(readDocument(await collectStacFeed(config, undefined, hosts, looping))).rejects.toThrow(/no usable token/);
  });

  it("refuses a next link that hands back the token it was already on", async () => {
    const fetcher = serviceFetcher((token) => page({ count: 1, first: token === null ? 0 : 1, next: "t1" }));
    await expect(readDocument(await collectStacFeed(config, undefined, hosts, fetcher))).rejects.toThrow(/did not move forwards/);
  });

  it("refuses an item the service sent twice", async () => {
    const fetcher = serviceFetcher((token) => (token === null ? page({ count: 1, next: "t1" }) : page({ count: 1 })));
    await expect(readDocument(await collectStacFeed(config, undefined, hosts, fetcher))).rejects.toThrow(/more than once/);
  });

  it("reports an upstream failure rather than publishing an empty coverage", async () => {
    const fetcher = serviceFetcher(() => page({ count: 1 }), { onRequest: (url) => (url.pathname.endsWith("/items") ? new Response("", { status: 502 }) : undefined) });
    await expect(collectStacFeed(config, undefined, hosts, fetcher)).rejects.toThrow(/HTTP 502/);
  });
});

describe("STAC normalization", () => {
  it("publishes one row per tile, keyed by the catalogue's own item identifier", async () => {
    const document = await readDocument(
      await collectStacFeed(
        config,
        undefined,
        hosts,
        serviceFetcher(() => page({ count: 3 })),
      ),
    );
    const rows = await rowsOf(document);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.record?.entityKey)).toEqual(["ORTOS-2025-cog-25cm-0", "ORTOS-2025-cog-25cm-1", "ORTOS-2025-cog-25cm-2"]);
  });

  it("says what a tile covers, how finely, and where its file is", async () => {
    const document = await readDocument(
      await collectStacFeed(
        config,
        undefined,
        hosts,
        serviceFetcher(() => page({ count: 1 })),
      ),
    );
    const payload = (await rowsOf(document))[0]?.record?.payload ?? {};
    expect(payload).toMatchObject({
      collection: "ORTOS-2025",
      west: -8.13,
      north: 37.1,
      resolution: 0.25,
      widthPixels: 32000,
      heightPixels: 20000,
      bands: 2,
      bandNames: "red, nir",
      crs: "EPSG:3763",
      file: "https://stratus.example/orto/0.tif",
    });
    // The middle of the tile, so a coverage can be drawn on a map.
    expect(Number(payload.latitude)).toBeCloseTo(37.075, 3);
  });

  it("never dates a tile by the catalogue's loading clock", async () => {
    const document = await readDocument(
      await collectStacFeed(
        config,
        undefined,
        hosts,
        serviceFetcher(() => page({ count: 1 })),
      ),
    );
    const record = (await rowsOf(document))[0]?.record;
    // The item's `datetime` is when the tile was loaded into the catalogue — a
    // 2026 stamp on a 2025 flight — so it is published as that, and never as an
    // event time that would make a decade-old photograph look like news.
    expect(record?.payload.catalogued).toBe("2026-08-07T15:18:07.393926Z");
    expect(record?.eventTime).toBeUndefined();
    expect(record?.validFrom).toBeUndefined();
  });

  it("carries none of the coordinate-system boilerplate the catalogue stamps on every tile", async () => {
    const real = isJsonObject(itemsPage) && isJsonObject(itemsPage.data) ? itemsPage.data : {};
    const rows = await rowsOf({ type: "FeatureCollection", features: Array.isArray(real.features) ? real.features : [] });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const payload = row.record?.payload ?? {};
      for (const noise of ["proj:wkt2", "proj:projjson", "coordinateSystem", "cornerCoordinates", "image_metadata", "proj:transform", "driver"]) {
        expect(payload).not.toHaveProperty(noise);
      }
    }
  });

  it("calls a walk its own page cap ended partial, so it retracts nothing", async () => {
    const fetcher = serviceFetcher((token) => page({ count: 1, first: token === null ? 0 : 1, next: token === null ? "t1" : "t2" }));
    const document = await readDocument(await collectStacFeed({ ...config, maxPages: "2" }, undefined, hosts, fetcher));
    expect(document.truncated).toBe(true);
    const stream = new Response(JSON.stringify(document)).body;
    if (!stream) throw new Error("no stream");
    const built = new StacTransformer().transform(stream, transformContext);
    for await (const _row of built.rows) void _row;
    expect(built.finish().products?.[0]?.completeness).toBe("partial");
  });
});

describe("STAC through the shared collector", () => {
  it("streams a normalized batch of tiles", async () => {
    const result = await collectNormalized(await request(), stacCollector({ config, hosts: allowedHosts, fetcher: serviceFetcher(() => page({ count: 2 })) }));
    expect(result.kind).toBe("batch");
    if (result.kind !== "batch") return;
    const frames = (await readText(result.stream))
      .trim()
      .split("\n")
      .map((line) => {
        const frame = parseJson(line);
        if (!isJsonObject(frame)) throw new Error("Every frame is a JSON object");
        return frame;
      });
    expect(frames[0]?.type).toBe("header");
    expect(frames.at(-1)?.type).toBe("complete");
    expect(isJsonObject(frames.at(-1)?.counts) ? frames.at(-1)?.counts : undefined).toMatchObject({ records: 2 });
  });

  it("refuses a history walk, because a catalogue publishes no older edition", async () => {
    const result = await collectNormalized(
      await request({ mode: { kind: "history", cursor: { before: "2026-01-01T00:00:00.000Z" } } }),
      stacCollector({ config, hosts: allowedHosts, fetcher: serviceFetcher(() => page({ count: 1 })) }),
    );
    expect(result).toEqual({ kind: "failure", code: "history-unsupported", retryable: false });
  });
});

describe("STAC examples", () => {
  it("ships one index per coverage the Centro de Dados publishes", () => {
    expect(STAC_EXAMPLES).toHaveLength(9);
    expect(new Set(STAC_EXAMPLES.map((example) => example.slug)).size).toBe(STAC_EXAMPLES.length);
    expect(STAC_EXAMPLES.every((example) => example.config.source === "stac" && example.publisher === "dgt")).toBe(true);
    expect(new Set(STAC_EXAMPLES.map((example) => example.config.collection)).size).toBe(STAC_EXAMPLES.length);
  });

  it("serves each coverage under the terms its own catalogue record states", () => {
    const byLicence = new Map(STAC_EXAMPLES.map((example) => [example.config.collection, example.policy.serving.licence]));
    // These three records say CC BY 4.0 outright.
    expect(byLicence.get("ORTOS-2025")).toBe("cc-by-4.0");
    expect(byLicence.get("ORTOS-2018")).toBe("cc-by-4.0");
    // The older coverages say the files are supplied against a quotation.
    for (const older of ["ORTOS-2021", "ORTOS-2015", "ORTOS-2012", "ORTOS-2010", "ORTOS-2007", "ORTOS-2004", "ORTOS-1995"]) {
      expect(byLicence.get(older)).toBe("dgt-imagery-quote");
    }
    expect(STAC_EXAMPLES.every((example) => (example.policy.serving.attribution ?? "").includes("Direção-Geral do Território"))).toBe(true);
  });

  it("says in every description that it publishes the index and not the imagery", () => {
    expect(STAC_EXAMPLES.every((example) => /index, not the imagery/i.test(example.description))).toBe(true);
  });

  it("walks a coverage monthly, with pages enough for every tile it promises", () => {
    for (const example of STAC_EXAMPLES) {
      expect(example.policy.collection.cadenceSeconds).toBe(2_592_000);
      expect(example.staleAfterSeconds).toBeGreaterThanOrEqual(example.policy.collection.cadenceSeconds);
      const promised = Number(/([\d,]{3,})\s+tiles/.exec(example.description)?.[1]?.replaceAll(",", "") ?? "0");
      expect(promised).toBeGreaterThan(0);
      expect(Number(example.config.maxPages) * Number(example.config.pageSize)).toBeGreaterThanOrEqual(promised);
    }
  });
});

async function request(overrides: Partial<CollectionRequest> = {}): Promise<CollectionRequest> {
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: "collection_1",
    feed: { id: "feed_1", slug: "dgt-ortofotos-2025-feed", title: "Orthophoto tile index 2025 (25 cm)", description: "test feed" },
    resolved: await resolveStacFeed(config, hosts),
    feedEpoch: "epoch-1",
    mode: { kind: "live" },
    limits: { sourceBytes: 33_554_432, outputBytes: 33_554_432, frameBytes: 262_144, recordBytes: 262_144, records: 50_000, products: 4 },
    deadline: new Date(Date.now() + 30_000).toISOString(),
    observedAt: "2026-09-21T09:00:00.000Z",
    ...overrides,
  };
}
