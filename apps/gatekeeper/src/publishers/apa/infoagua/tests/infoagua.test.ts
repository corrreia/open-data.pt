import { readFixture } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import {
  GatekeeperError,
  NORMALIZED_PROTOCOL,
  collectNormalized,
  libraryConfig,
  runTransformer,
  type CanonicalRecord,
  type CollectionRequest,
  type SourceBody,
  type SourceConfig,
  type SourceFetch,
} from "#/index";
import { INFOAGUA_ORIGIN, InfoaguaTransformer, assignedJson, collectInfoaguaFeed, resolveInfoaguaFeed, validateInfoaguaFeedConfig } from "#/publishers/apa/infoagua/index";
import { feedCollection, feedsOf } from "#/tests/catalog";

const page = (name: string): string => readFixture(new URL(`./fixtures/${name}`, import.meta.url));
const FLOODS = { feed: "flood-alerts" };
const DROUGHT = { feed: "drought-index" };

function infoagua(pages: { floods?: string; drought?: string; answer?: () => Response } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (pages.answer) return pages.answer();
    const url = new URL(input.toString());
    if (url.pathname === "/pt/cheias/cheias-pesquisa") return new Response(pages.floods ?? page("flood-stations.html"));
    if (url.pathname === "/pt/seca") return new Response(pages.drought ?? page("drought.html"));
    return new Response("not found", { status: 404 });
  });
}

function bodyOf(fetched: SourceFetch): SourceBody {
  if (fetched.kind !== "body") throw new Error(`Expected a source body, got ${fetched.kind}`);
  return fetched;
}

async function records(config: SourceConfig, fetcher = infoagua()): Promise<CanonicalRecord[]> {
  const body = bodyOf(await collectInfoaguaFeed(config, undefined, INFOAGUA_ORIGIN, fetcher)).body;
  if (!(body instanceof Uint8Array)) throw new Error("InfoÁgua hands over a buffered body");
  const context = {
    feed: {
      slug: "infoagua-test-feed",
      title: "Test",
      description: "test feed",
      config,
      semantics: { domainSubject: "observation" as const, defaultProductRole: "summary" as const },
    },
    observedAt: "2026-09-22T02:00:00.000Z",
  };
  const product = (await runTransformer(new InfoaguaTransformer(), body, context)).products[0];
  if (product?.kind !== "record") throw new Error("InfoÁgua feeds are record products");
  return product.records;
}

describe("InfoÁgua configuration", () => {
  it.each(feedsOf("infoagua"))("validates the curated $slug example", (example) => {
    const candidate = libraryConfig(example.config);
    expect(validateInfoaguaFeedConfig(candidate)).toEqual(candidate);
  });

  it.each([
    ["an unknown feed", { feed: "beaches" }],
    ["an unknown field", { feed: "flood-alerts", station: "1" }],
  ])("refuses %s", (_label, candidate) => {
    expect(() => validateInfoaguaFeedConfig(candidate)).toThrow(GatekeeperError);
  });

  it("refuses a configuration that names its own host", () => {
    expect(() => validateInfoaguaFeedConfig({ feed: "flood-alerts", url: "https://attacker.example" })).toThrow(/Unsupported InfoÁgua field/);
  });

  it("declares no history, as the app keeps none", async () => {
    expect((await resolveInfoaguaFeed(FLOODS)).history).toBeUndefined();
  });
});

describe("InfoÁgua page data", () => {
  it("reads the value assigned to a variable up to its own closing bracket", () => {
    const html = `<script>var DATA_Things = [{"a": "] and }"}, {"b": [1, 2]}]; var DATA_Other = {"c": 1};</script>`;
    expect(assignedJson(html, "DATA_Things")).toEqual([{ a: "] and }" }, { b: [1, 2] }]);
    expect(assignedJson(html, "DATA_Other")).toEqual({ c: 1 });
  });

  it.each([
    ["a missing variable", "<script>var x = 1;</script>"],
    ["a value that never closes", "<script>DATA_Things = [1, 2"],
    ["a value that is not JSON", "<script>DATA_Things = [undefined]</script>"],
  ])("refuses %s", (_label, html) => {
    expect(() => assignedJson(html, "DATA_Things")).toThrow(GatekeeperError);
  });
});

describe("InfoÁgua flood alerts", () => {
  it("keeps one record per watched station with its alert, and none of its reading", async () => {
    const stations = await records(FLOODS);
    expect(stations).toHaveLength(3);
    const aguieira = stations.find((record) => record.entityKey === "1627743384");
    expect(aguieira?.payload).toMatchObject({ station: "1627743384", name: "Aguieira", type: "Reservoir Station", basin: "Mondego", alertLevel: 1, alert: "No active alerts" });
    for (const record of stations) {
      expect(record.payload).not.toHaveProperty("value");
      expect(record.payload).not.toHaveProperty("moment");
      expect(record.eventTime).toBeUndefined();
    }
  });

  it("answers unchanged when only the readings moved", async () => {
    const first = bodyOf(await collectInfoaguaFeed(FLOODS, undefined, INFOAGUA_ORIGIN, infoagua()));
    const later = page("flood-stations.html")
      .replaceAll(/"value": ?[\d.]+/gu, '"value": 99.9')
      .replaceAll(/"moment": ?"[^"]+"/gu, '"moment": "2026-09-22 03:00:00"');
    expect(later).not.toBe(page("flood-stations.html"));
    expect((await collectInfoaguaFeed(FLOODS, first.validator, INFOAGUA_ORIGIN, infoagua({ floods: later }))).kind).toBe("not-modified");
  });

  it("collects again when an alert changes", async () => {
    const first = bodyOf(await collectInfoaguaFeed(FLOODS, undefined, INFOAGUA_ORIGIN, infoagua()));
    const alert = page("flood-stations.html").replace('"pt": "Sem alertas ativos", "en": "No active alerts"', '"pt": "Situação de alerta", "en": "Alert Situation"');
    expect((await collectInfoaguaFeed(FLOODS, first.validator, INFOAGUA_ORIGIN, infoagua({ floods: alert }))).kind).toBe("body");
  });

  it.each([
    ["an upstream failure", () => new Response("down", { status: 502 }), "upstream-error"],
    ["a redirect", () => new Response(null, { status: 301, headers: { Location: "https://elsewhere.example/" } }), "source-denied"],
    ["a page without its data", () => new Response("<html>maintenance</html>"), "invalid-response"],
  ])("fails on %s", async (_label, answer, code) => {
    await expect(collectInfoaguaFeed(FLOODS, undefined, INFOAGUA_ORIGIN, infoagua({ answer }))).rejects.toMatchObject({ code });
  });

  it("reads nothing but InfoÁgua's own origin", async () => {
    await expect(collectInfoaguaFeed(FLOODS, undefined, "https://attacker.example", infoagua())).rejects.toMatchObject({ code: "source-denied" });
  });
});

describe("InfoÁgua drought index", () => {
  it("keeps a record per basin and month, dated by the month", async () => {
    const basins = await records(DROUGHT);
    expect(basins).toHaveLength(3);
    expect(basins[0]).toEqual({
      entityKey: "9:2026-08",
      eventTime: "2026-08-01T00:00:00.000Z",
      payload: { basinId: "9", basin: "Sado", month: "2026-08-01", index: 0.645, state: 6, stateName: "Húmido", stateColor: "#0E90C2" },
    });
  });
});

describe("InfoÁgua through a feed's own file", () => {
  it("refuses a history walk", async () => {
    const { resolved, collector } = await feedCollection("infoagua-flood-alerts-feed", { fetcher: infoagua() });
    const result = await collectNormalized(await request({ resolved, mode: { kind: "history", cursor: { before: "2026-01-01T00:00:00.000Z" } } }), collector);
    expect(result).toEqual({ kind: "failure", code: "history-unsupported", retryable: false });
  });

  it("frames a live collection", async () => {
    const { resolved, collector } = await feedCollection("infoagua-flood-alerts-feed", { fetcher: infoagua() });
    const result = await collectNormalized(await request({ resolved }), collector);
    expect(result.kind).toBe("batch");
    if (result.kind !== "batch") return;
    const frames = (await new Response(result.stream).text()).trim().split("\n");
    expect(frames).toHaveLength(5);
    expect(frames.at(-1)).toContain('"counts":{"records":3,"points":0}');
  });
});

async function request(overrides: Partial<CollectionRequest> = {}): Promise<CollectionRequest> {
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: "collection_1",
    feed: { id: "feed_1", slug: "infoagua-flood-alerts-feed", title: "Flood alerts", description: "test feed" },
    resolved: await resolveInfoaguaFeed(FLOODS),
    feedEpoch: "epoch-1",
    mode: { kind: "live" },
    limits: { sourceBytes: 4_194_304, outputBytes: 16_777_216, frameBytes: 262_144, recordBytes: 262_144, records: 10_000, products: 4 },
    deadline: new Date(Date.now() + 30_000).toISOString(),
    observedAt: "2026-09-22T02:00:00.000Z",
    ...overrides,
  };
}
