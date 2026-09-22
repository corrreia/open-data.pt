import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { datasetOf, feedsOf } from "./catalog";
import {
  GatekeeperError,
  NORMALIZED_PROTOCOL,
  collectNormalized,
  isJsonObject,
  libraryConfig,
  parseJson,
  runTransformer,
  type CanonicalRecord,
  type CollectionRequest,
  type JsonObject,
  type JsonValue,
  type SourceBody,
  type SourceFetch,
} from "@open-data-pt/gatekeeper";
import {
  SNIT_API_ORIGIN,
  SNIT_LANDING_PAGE,
  SNIT_TYPES,
  SnitTransformer,
  collectSnitFeed,
  resolveSnitFeed,
  snitCollector,
  validateSnitFeedConfig,
} from "../apps/gatekeeper/src/publishers/dgt/snit";

const config = { feed: "instruments", type: "prof" };

const instruments = parseJson(readFileSync(new URL("./fixtures/snit/prof-instruments.json", import.meta.url), "utf8"));

/** The register's own list of regions, cut to what the collector reads out of it. */
const regions: JsonValue = [
  { name: "NORTE", listMunicipalities: [{ dtcc: "1312", designation: "PORTO", region: "NORTE" }] },
  {
    name: "LISBOA E VALE DO TEJO",
    listMunicipalities: [
      { dtcc: "1106", designation: "LISBOA", region: "LISBOA E VALE DO TEJO" },
      { dtcc: "1401", designation: "ABRANTES", region: "LISBOA E VALE DO TEJO" },
    ],
  },
];

interface ServiceOptions {
  regions?: JsonValue;
  instruments?: JsonValue;
  onRequest?: (url: URL, init?: RequestInit) => Response | undefined;
}

function serviceFetcher(options: ServiceOptions = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    const answer = options.onRequest?.(url, init);
    if (answer) return answer;
    if (url.pathname.endsWith("GetRegionsAndMunicipalitiesAsync")) return Response.json(options.regions ?? regions);
    return Response.json(options.instruments ?? instruments);
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

async function collected(options: ServiceOptions = {}): Promise<Uint8Array> {
  const fetched = await collectSnitFeed(config, undefined, SNIT_API_ORIGIN, serviceFetcher(options));
  const body = bodyOf(fetched).body;
  return body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
}

const transformContext = {
  feed: {
    slug: "snit-prof-feed",
    title: "Regional forest programmes",
    description: "test feed",
    config,
    semantics: { domainSubject: "document" as const, defaultProductRole: "reference" as const },
  },
  observedAt: "2026-09-21T09:00:00.000Z",
};

async function products(): Promise<Map<string, { records: CanonicalRecord[]; product: JsonObject }>> {
  const result = await runTransformer(new SnitTransformer(), await collected(), transformContext);
  const map = new Map<string, { records: CanonicalRecord[]; product: JsonObject }>();
  for (const product of result.products) {
    // SAFETY: a product build is a plain object of JSON values, so a round trip
    // through JSON.stringify gives back exactly that and nothing wider.
    const asJson = JSON.parse(JSON.stringify(product)) as JsonObject;
    map.set(product.productKey, { records: product.records ?? [], product: asJson });
  }
  return map;
}

describe("SNIT configuration", () => {
  it("canonicalizes a configuration to its feed and its type", () => {
    expect(validateSnitFeedConfig({ feed: "instruments", type: " prof " })).toEqual({ feed: "instruments", type: "prof" });
  });

  it.each([
    ["an unknown field", { feed: "instruments", type: "prof", municipality: "1106" }],
    ["a feed that is not the register", { feed: "acts", type: "prof" }],
    ["a type outside the register's own list", { feed: "instruments", type: "pdm-2026" }],
    ["no type at all", { feed: "instruments" }],
  ])("refuses %s", (_label, candidate) => {
    expect(() => validateSnitFeedConfig(candidate)).toThrow(GatekeeperError);
  });

  it("refuses a configuration that tries to name its own host", () => {
    expect(() => validateSnitFeedConfig({ feed: "instruments", type: "prof", host: "attacker.example" })).toThrow(/Unsupported SNIT field/);
  });

  it("keeps the two regional types apart, though the register calls both PROT", () => {
    expect(SNIT_TYPES["prot-plano"].id).not.toBe(SNIT_TYPES["prot-programa"].id);
    expect(SNIT_TYPES["prot-plano"].abbreviation).toBe(SNIT_TYPES["prot-programa"].abbreviation);
  });

  it.each(feedsOf("snit"))("validates the curated $slug example", (example) => {
    const candidate = libraryConfig(example.config);
    expect(validateSnitFeedConfig(candidate)).toEqual(candidate);
  });

  it("gives each type its own resource key", async () => {
    const forest = await resolveSnitFeed({ feed: "instruments", type: "prof" });
    const master = await resolveSnitFeed({ feed: "instruments", type: "pdm" });
    expect(forest.resourceKey).not.toBe(master.resourceKey);
  });
});

describe("SNIT collection", () => {
  it("names every municipality the register lists, because the all-flag alone answers empty", async () => {
    const fetcher = serviceFetcher();
    await collectSnitFeed(config, undefined, SNIT_API_ORIGIN, fetcher);
    const post = fetcher.mock.calls.find((call) => call[1]?.method === "POST");
    expect(post).toBeDefined();
    // SAFETY: the collector builds this body with JSON.stringify on an object literal,
    // so what comes back out of JSON.parse is that same object.
    const sent = JSON.parse(String(post?.[1]?.body)) as JsonObject;
    expect(sent.regionsMunicipalitiesSelected).toEqual(["1312", "1106", "1401"]);
    expect(sent.typesSelected).toEqual([SNIT_TYPES.prof.id]);
    expect(sent.statusSelected).toBe(1);
  });

  it("shows the register a browser can open, because the API answers only POSTs", async () => {
    const fetched = await collectSnitFeed(config, undefined, SNIT_API_ORIGIN, serviceFetcher());
    expect(bodyOf(fetched).provenance.sourceUrl).toBe(SNIT_LANDING_PAGE);
    expect(bodyOf(fetched).completeness).toBe("complete");
  });

  it("answers not-modified when the register returns what it returned last time", async () => {
    const first = await collectSnitFeed(config, undefined, SNIT_API_ORIGIN, serviceFetcher());
    const etag = bodyOf(first).validator?.etag;
    expect(etag).toBeDefined();
    const second = await collectSnitFeed(config, { etag }, SNIT_API_ORIGIN, serviceFetcher());
    expect(second.kind).toBe("not-modified");
  });

  it("refuses an origin it was not given", async () => {
    await expect(collectSnitFeed(config, undefined, "https://attacker.example", serviceFetcher())).rejects.toThrow(/origin is not allowed/);
  });

  it("refuses a redirect rather than following it", async () => {
    const fetcher = serviceFetcher({
      onRequest: (url) => (url.pathname.endsWith("GetInstrumentsAsync") ? new Response(null, { status: 302, headers: { location: "https://attacker.example/" } }) : undefined),
    });
    await expect(collectSnitFeed(config, undefined, SNIT_API_ORIGIN, fetcher)).rejects.toThrow(/redirects are not allowed/);
  });

  it("reports an upstream failure rather than publishing an empty register", async () => {
    const fetcher = serviceFetcher({ onRequest: (url) => (url.pathname.endsWith("GetInstrumentsAsync") ? new Response("", { status: 500 }) : undefined) });
    await expect(collectSnitFeed(config, undefined, SNIT_API_ORIGIN, fetcher)).rejects.toThrow(/HTTP 500/);
  });

  it("refuses a register answer that is not a list of identified instruments", async () => {
    await expect(collectSnitFeed(config, undefined, SNIT_API_ORIGIN, serviceFetcher({ instruments: [{ name: "no identifier" }] }))).rejects.toThrow(/without an identifier/);
  });

  it("refuses to query when the register lists no municipalities", async () => {
    await expect(collectSnitFeed(config, undefined, SNIT_API_ORIGIN, serviceFetcher({ regions: [] }))).rejects.toThrow(/carried no municipalities/);
  });
});

describe("SNIT normalization", () => {
  it("publishes the instruments and the acts behind them as two products", async () => {
    const built = await products();
    expect([...built.keys()]).toEqual(["instruments", "acts"]);
    expect(built.get("instruments")?.records).toHaveLength(7);
    expect(built.get("acts")?.records).toHaveLength(27);
  });

  it("dates every act by the day the Diário da República published it, never by the poll", async () => {
    const acts = (await products()).get("acts")?.records ?? [];
    expect(acts.length).toBeGreaterThan(0);
    for (const act of acts) {
      const day = act.payload.publishedOn;
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(act.eventTime).toBeDefined();
      expect(act.eventTime).not.toBe(transformContext.observedAt);
      // Midnight in Lisbon is the instant the day names, an hour before UTC midnight in summer.
      expect(act.eventTime?.slice(0, 4)).toBe(String(day).slice(0, 4));
    }
  });

  it("carries the act's own reference, its gazette issue and the document it links to", async () => {
    const acts = (await products()).get("acts")?.records ?? [];
    const rectification = acts.find((act) => act.entityKey === "ato-6910");
    expect(rectification?.payload).toMatchObject({
      instrumentId: "2949",
      change: "2ª RETIFICAÇÃO",
      act: "DECL RET 7-A/2022",
      gazette: "45 IS",
      publishedOn: "2022-03-04",
      document: "https://snit-mais.dgterritorio.gov.pt/SNIT/Diplomas/DECL%20RET%207-A_2022.pdf",
    });
  });

  it("summarises each instrument by where it applies and how far its paper trail reaches", async () => {
    const instrument = (await products()).get("instruments")?.records.find((record) => record.entityKey === "igt-2949");
    expect(instrument?.payload).toMatchObject({ id: "2949", regions: "LISBOA E VALE DO TEJO" });
    // The kind of instrument is the feed, and the register answers only with what
    // is in force: neither belongs in a column that would hold one value throughout.
    expect(instrument?.payload).not.toHaveProperty("type");
    expect(instrument?.payload).not.toHaveProperty("state");
    // An act's own reference and wording live on the act, and are not copied here.
    expect(instrument?.payload).not.toHaveProperty("latestAct");
    expect(Number(instrument?.payload.municipalityCount)).toBeGreaterThan(50);
    expect(Number(instrument?.payload.acts)).toBeGreaterThan(0);
    // The register gives each instrument a bounding box in degrees, so a plan can be placed on a map.
    expect(Number(instrument?.payload.latitude)).toBeGreaterThan(36);
    expect(Number(instrument?.payload.latitude)).toBeLessThan(43);
    expect(Number(instrument?.payload.longitude)).toBeLessThan(-6);
  });

  it("keys an act by the register's own act identifier, so a republication is not a new row", async () => {
    const acts = (await products()).get("acts")?.records ?? [];
    expect(new Set(acts.map((act) => act.entityKey)).size).toBe(acts.length);
    expect(acts.every((act) => act.entityKey.startsWith("ato-"))).toBe(true);
  });
});

describe("SNIT through the shared collector", () => {
  it("streams a normalized batch carrying both products", async () => {
    const result = await collectNormalized(await request(), snitCollector({ config, apiOrigin: SNIT_API_ORIGIN, fetcher: serviceFetcher() }));
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
    const header = frames[0];
    expect(header?.type).toBe("header");
    expect(Array.isArray(header?.products) ? header.products.length : 0).toBe(2);
    const complete = frames.at(-1);
    expect(complete?.type).toBe("complete");
    expect(isJsonObject(complete?.counts) ? complete.counts.records : 0).toBe(34);
  });

  it("refuses a history walk, because the register publishes no older edition", async () => {
    const result = await collectNormalized(
      await request({ mode: { kind: "history", cursor: { before: "2026-01-01T00:00:00.000Z" } } }),
      snitCollector({ config, apiOrigin: SNIT_API_ORIGIN, fetcher: serviceFetcher() }),
    );
    expect(result).toEqual({ kind: "failure", code: "history-unsupported", retryable: false });
  });
});

describe("SNIT examples", () => {
  it("ships one feed per kind of instrument the register holds", () => {
    expect(feedsOf("snit")).toHaveLength(Object.keys(SNIT_TYPES).length);
    expect(new Set(feedsOf("snit").map((example) => example.slug)).size).toBe(feedsOf("snit").length);
    expect(feedsOf("snit").every((example) => example.config.source === "snit" && datasetOf(example).publisher === "dgt")).toBe(true);
  });

  it("polls the register weekly at most, and gives the slow types room to answer", () => {
    for (const example of feedsOf("snit")) {
      expect(example.policy.collection.cadenceSeconds).toBeGreaterThanOrEqual(604_800);
      expect(example.staleAfterSeconds).toBeGreaterThanOrEqual(example.policy.collection.cadenceSeconds);
      expect(example.policy.collection.historyMode).toBe("changes");
      expect(example.policy.collection.timeoutSeconds).toBeGreaterThanOrEqual(120);
    }
  });

  it("serves the register under the licence DGT states for it", () => {
    for (const example of feedsOf("snit")) {
      expect(datasetOf(example).licence).toBe("cc-by");
      expect(datasetOf(example).attribution ?? "").not.toBe("");
    }
  });
});

async function request(overrides: Partial<CollectionRequest> = {}): Promise<CollectionRequest> {
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: "collection_1",
    feed: { id: "feed_1", slug: "snit-prof-feed", title: "Regional forest programmes", description: "test feed" },
    resolved: await resolveSnitFeed(config),
    feedEpoch: "epoch-1",
    mode: { kind: "live" },
    limits: { sourceBytes: 25_165_824, outputBytes: 25_165_824, frameBytes: 262_144, recordBytes: 262_144, records: 50_000, products: 4 },
    deadline: new Date(Date.now() + 30_000).toISOString(),
    observedAt: "2026-09-21T09:00:00.000Z",
    ...overrides,
  };
}
