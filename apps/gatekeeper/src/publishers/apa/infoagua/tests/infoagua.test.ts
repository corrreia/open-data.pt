import { readFixture } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import {
  GatekeeperError,
  NORMALIZED_PROTOCOL,
  collectNormalized,
  isJsonArray,
  isJsonObject,
  libraryConfig,
  parseJsonBytes,
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
const RESERVOIRS = { feed: "reservoirs" };
const FLOWS = { feed: "reservoir-flows" };

/**
 * InfoÁgua as its pages answer. A station's page is the saved one for Aguieira, and otherwise the page `stations`
 * gives for its SNIRH site.
 */
function infoagua(
  pages: { floods?: string; drought?: string; stations?: ReadonlyMap<string, string>; stationAnswers?: ReadonlyMap<string, () => Response>; answer?: () => Response } = {},
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    if (pages.answer) return pages.answer();
    const url = new URL(input.toString());
    if (url.pathname === "/pt/cheias/cheias-pesquisa") return new Response(pages.floods ?? page("flood-stations.html"));
    if (url.pathname === "/pt/seca") return new Response(pages.drought ?? page("drought.html"));
    if (url.pathname === "/pt/seca/secas-pesquisa") return new Response(page("reservoirs.html"));
    const site = /^\/pt\/cheias\/cheia-detalhe\/(\d+)$/u.exec(url.pathname)?.[1] ?? "";
    const answer = pages.stationAnswers?.get(site);
    if (answer) return answer();
    const station = pages.stations?.get(site) ?? (site === "1627743384" ? page("station-1627743384.html") : undefined);
    if (station !== undefined) return new Response(station);
    return new Response("not found", { status: 404 });
  });
}

/** A reservoir's page as InfoÁgua writes it, with the inflow and outflow given, by time. */
function reservoirPage(inflow: Array<[moment: string, value: number]>, outflow: Array<[moment: string, value: number]>): string {
  const values = (entries: Array<[string, number]>) => entries.map(([moment, value]) => ({ moment, value }));
  const parameters = [
    { id: 6, name: "Caudal Afluente (m3/s)", unit: "m3/s", values: values(inflow) },
    { id: 2, name: "Caudal Efluente (m3/s)", unit: "m3/s", values: values(outflow) },
  ];
  return `<html><body><script>\n\t\tvar DATA_StationParameters = ${JSON.stringify(parameters)};\n</script></body></html>`;
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

describe("InfoÁgua reservoirs", () => {
  it("keeps one record per reservoir, keyed by SNIRH code, reading the numbers and flags InfoÁgua writes out as text", async () => {
    const reservoirs = await records(RESERVOIRS);
    expect(reservoirs.map((record) => record.entityKey)).toEqual(["02H/01A", "03G/01A"]);
    const lindoso = reservoirs[0]?.payload;
    expect(lindoso).toMatchObject({
      station: "02H/01A",
      site: "1627743428",
      name: "ALTO LINDOSO",
      basin: "Lima",
      capacityHm3: 379,
      usableVolumeHm3: 347.91,
      fullSupplyLevelM: 338,
      waterSupply: false,
      energy: true,
      environmentalFlow: true,
      floodControl: true,
    });
    expect(lindoso?.monthlyLows).toContainEqual({ month: 8, volumeHm3: 60.3, year: 2022 });
    expect(reservoirs[1]?.payload).toMatchObject({ station: "03G/01A", waterSupply: true });
  });
});

describe("InfoÁgua reservoir flows", () => {
  it("reads each reservoir's page once for both flows, and files both series under SNIRH's code and name", async () => {
    // Fronhas's place in the list goes to Alcántara, across the border and in no SNIRH station list.
    const floods = page("flood-stations.html").replace('"snirh_source_id": 1627758668', '"snirh_source_id": 21042');
    const stations = new Map([
      ["1627759328", reservoirPage([["2026-09-29 11:00:00", 5]], [["2026-09-29 11:00:00", 7]])],
      ["21042", reservoirPage([["2026-09-29 11:00:00", 100]], [["2026-09-29 11:00:00", 120]])],
    ]);
    const fetcher = infoagua({ floods, stations });
    const fetched = bodyOf(await collectInfoaguaFeed(FLOWS, undefined, INFOAGUA_ORIGIN, fetcher));
    expect(fetched.completeness).toBe("complete");
    const body = fetched.body;
    if (!(body instanceof Uint8Array)) throw new Error("InfoÁgua hands over a buffered body");
    const context = {
      feed: {
        slug: "infoagua-reservoir-flows-feed",
        title: "Test",
        description: "test feed",
        config: FLOWS,
        semantics: { domainSubject: "observation" as const, defaultProductRole: "time-series" as const },
      },
      observedAt: "2026-09-29T12:00:00.000Z",
    };
    const result = await runTransformer(new InfoaguaTransformer(), body, context);

    const pages = fetcher.mock.calls.map(([input]) => new URL(input.toString()).pathname).filter((path) => path.startsWith("/pt/cheias/cheia-detalhe/"));
    expect(pages.toSorted()).toEqual(["/pt/cheias/cheia-detalhe/1627743384", "/pt/cheias/cheia-detalhe/1627759328", "/pt/cheias/cheia-detalhe/21042"]);
    const [inflows, outflows] = result.products;
    if (inflows?.kind !== "series" || outflows?.kind !== "series") throw new Error("The flows are two series");
    expect([inflows.slug, outflows.slug]).toEqual(["infoagua-reservoir-inflows", "infoagua-reservoir-outflows"]);
    expect(inflows.points).toContainEqual({
      seriesKey: "11H/01A",
      eventTime: "2026-09-29T11:00:00.000Z",
      value: 138.85,
      unit: "m3/s",
      dimensions: { station: "11H/01A", name: "ALBUFEIRA DA AGUIEIRA (R.E.)" },
    });
    expect(outflows.points).toContainEqual({
      seriesKey: "12H/01A",
      eventTime: "2026-09-29T11:00:00.000Z",
      value: 7,
      unit: "m3/s",
      dimensions: { station: "12H/01A", name: "ALBUFEIRA DA RAIVA (R.E.)" },
    });
    expect(new Set([...inflows.points, ...outflows.points].map((point) => point.seriesKey))).toEqual(new Set(["11H/01A", "12H/01A"]));
    // Alcántara was never going to be published: left out, not rejected, so the run is not marked partial.
    expect(result.quality.rejectedRecords).toBe(0);
  });
});

describe("InfoÁgua station pages that fail", () => {
  it("costs only the station whose page is gone or moved, marks the run partial, and fails it only when none answers", async () => {
    // Aguieira answers; Raiva's page is not there, and Fronhas's redirects, as InfoÁgua does for a station without one.
    const stationAnswers = new Map([["1627758668", () => new Response(null, { status: 302, headers: { Location: "/pt/cheias" } })]]);
    const fetched = bodyOf(await collectInfoaguaFeed(FLOWS, undefined, INFOAGUA_ORIGIN, infoagua({ stationAnswers })));
    expect(fetched.completeness).toBe("partial");
    const document = parseJsonBytes(fetched.body instanceof Uint8Array ? fetched.body : new Uint8Array());
    expect(isJsonObject(document) && isJsonArray(document.entries) ? document.entries.map((entry) => (isJsonObject(entry) ? entry.site : null)) : []).toEqual([
      "1627743384",
      "1627743384",
    ]);

    const noneAnswers = page("flood-stations.html").replace('"snirh_source_id": 1627743384', '"snirh_source_id": 1');
    await expect(collectInfoaguaFeed(FLOWS, undefined, INFOAGUA_ORIGIN, infoagua({ floods: noneAnswers }))).rejects.toMatchObject({ code: "upstream-error" });
  });
});

describe("InfoÁgua through a feed's own file", () => {
  it("refuses a history walk", async () => {
    const { resolved, collector } = await feedCollection("infoagua-flood-alerts-feed", { fetcher: infoagua() });
    const result = await collectNormalized(
      await request({ configHash: resolved.configHash, mode: { kind: "history", cursor: { before: "2026-01-01T00:00:00.000Z" } } }),
      collector,
    );
    expect(result).toEqual({ kind: "failure", code: "history-unsupported", retryable: false });
  });

  it("frames a live collection", async () => {
    const { resolved, collector } = await feedCollection("infoagua-flood-alerts-feed", { fetcher: infoagua() });
    const result = await collectNormalized(await request({ configHash: resolved.configHash }), collector);
    expect(result.kind).toBe("batch");
    if (result.kind !== "batch") return;
    const frames = (await new Response(result.stream).text()).trim().split("\n");
    expect(frames).toHaveLength(5);
    expect(frames.filter((frame) => frame.startsWith('{"type":"record"'))).toHaveLength(3);
    expect(frames.at(-1)).toContain('"quality":{"acceptedRecords":3,"rejectedRecords":0}');
  });
});

async function request(overrides: Partial<CollectionRequest> = {}): Promise<CollectionRequest> {
  return {
    protocol: NORMALIZED_PROTOCOL,
    slug: "infoagua-flood-alerts-feed",
    configHash: (await resolveInfoaguaFeed(FLOODS)).configHash,
    mode: { kind: "live" },
    limits: { sourceBytes: 4_194_304, outputBytes: 16_777_216, recordBytes: 262_144, records: 10_000 },
    deadline: new Date(Date.now() + 30_000).toISOString(),
    observedAt: "2026-09-22T02:00:00.000Z",
    ...overrides,
  };
}
