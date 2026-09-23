import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  GatekeeperError,
  NORMALIZED_PROTOCOL,
  collectNormalized,
  isJsonObject,
  libraryConfig,
  parseJson,
  runTransformer,
  type CollectionRequest,
  type JsonObject,
  type ProductBuild,
  type SourceBody,
  type SourceConfig,
  type SourceFetch,
} from "@open-data-pt/gatekeeper";
import {
  SNIRH_ORIGIN,
  SnirhTransformer,
  collectSnirhFeed,
  collectSnirhHistory,
  parseReadingsCsv,
  parseStationList,
  resolveSnirhFeed,
  validateSnirhFeedConfig,
} from "../apps/gatekeeper/src/publishers/apa/snirh";
import { feedCollection, feedsOf } from "./catalog";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./fixtures/snirh/${name}`, import.meta.url)));
const text = (name: string): string => new TextDecoder().decode(fixture(name));

const ALMOUROL = "1627743414";
const PONTE_DE_LIMA = "1627759118";
const ALTO_TAMEGA = "11508860178";
const LEVELS = { feed: "readings", reading: "river-level" };

interface SourceOptions {
  /** The CSV export for a request, by the sites it names; undefined falls back to the two-station fixture. */
  csv?: (sites: string[]) => Uint8Array | undefined;
  stations?: string;
  onRequest?: (url: URL, init?: RequestInit) => Response | undefined;
}

/** SNIRH as its pages answer: the filter form opens a session, the station list reads it, the export answers CSV. */
function snirh(options: SourceOptions = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    const answer = options.onRequest?.(url, init);
    if (answer) return answer;
    if (url.pathname === "/index.php") return new Response("<html></html>", { headers: { "Set-Cookie": "PHPSESSID=abc123; path=/" } });
    if (url.pathname.endsWith("xml_listaestacoes.php")) return new Response(options.stations ?? TWO_STATIONS);
    if (url.pathname.endsWith("dados_csv.php")) {
      const sites = (url.searchParams.get("sites") ?? "").split(",");
      return new Response(options.csv?.(sites) ?? fixture("river-level.csv"));
    }
    if (url.pathname.endsWith("coresXML.php")) return new Response(fixture("precipitation-2026-08.xml"));
    if (url.pathname.endsWith("dadosxml.php")) return new Response(fixture("groundwater-2026-08.xml"));
    if (url.pathname.endsWith("tabelageral.php")) return new Response(fixture("reservoir-basins-2025.html"));
    return new Response("not found", { status: 404 });
  });
}

function bodyOf(fetched: SourceFetch): SourceBody {
  if (fetched.kind !== "body") throw new Error(`Expected a source body, got ${fetched.kind}`);
  return fetched;
}

function bytesOf(fetched: SourceFetch): Uint8Array {
  const body = bodyOf(fetched).body;
  if (!(body instanceof Uint8Array)) throw new Error("SNIRH hands over a buffered body");
  return body;
}

async function transform(fetched: SourceFetch, config: SourceConfig, observedAt = "2026-09-22T02:00:00.000Z"): Promise<ProductBuild> {
  const context = {
    feed: {
      slug: "snirh-test-feed",
      title: "Test",
      description: "test feed",
      config,
      semantics: { domainSubject: "observation" as const, defaultProductRole: "time-series" as const },
    },
    observedAt,
  };
  const result = await runTransformer(new SnirhTransformer(), bytesOf(fetched), context);
  const product = result.products[0];
  if (!product || result.products.length !== 1) throw new Error("Every SNIRH feed has one product");
  return product;
}

function pointsOf(product: ProductBuild) {
  if (product.kind !== "series") throw new Error(`Expected a series, got ${product.kind}`);
  return product.points;
}

function recordsOf(product: ProductBuild) {
  if (product.kind !== "record") throw new Error(`Expected records, got ${product.kind}`);
  return product.records;
}

/** The two stations the CSV fixture holds a column for: the third in the list is a reservoir. */
const TWO_STATIONS = text("stations-hydrometric.xml").replace(/<marker site="11508860178"[\s\S]*?\/>/u, "");

/** The empty export for a station that does not hold the parameter: a header with no columns. */
const NO_COLUMN = new TextEncoder().encode("SNIRH - SISTEMA NACIONAL\r\n\r\nDATA,\r\n,\r\n\r\n\r\nDados obtidos\r\n");

describe("SNIRH configuration", () => {
  it("canonicalizes readings and bulletins", () => {
    expect(validateSnirhFeedConfig({ feed: " readings ", reading: " river-level " })).toEqual(LEVELS);
    expect(validateSnirhFeedConfig({ feed: "reservoir-basins" })).toEqual({ feed: "reservoir-basins" });
  });

  it.each([
    ["readings without a reading", { feed: "readings" }],
    ["a reading the library does not know", { feed: "readings", reading: "pressure" }],
    ["a bulletin that names a reading", { feed: "groundwater-state", reading: "river-level" }],
    ["an unknown feed", { feed: "stations" }],
    ["an unknown field", { feed: "readings", reading: "river-level", parameter: "1843" }],
  ])("refuses %s", (_label, candidate) => {
    expect(() => validateSnirhFeedConfig(candidate)).toThrow(GatekeeperError);
  });

  it("refuses a configuration that names its own host", () => {
    try {
      validateSnirhFeedConfig({ feed: "readings", reading: "river-level", host: "attacker.example" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GatekeeperError);
      if (error instanceof GatekeeperError) expect(error.code).toBe("source-denied");
    }
  });

  it.each(feedsOf("snirh"))("validates the curated $slug example", (example) => {
    const candidate = libraryConfig(example.config);
    expect(validateSnirhFeedConfig(candidate)).toEqual(candidate);
  });

  it("gives each reading its own resource key, and every feed a history", async () => {
    const levels = await resolveSnirhFeed(LEVELS);
    const flows = await resolveSnirhFeed({ feed: "readings", reading: "river-flow" });
    expect(levels.resourceKey).not.toBe(flows.resourceKey);
    expect(levels.history).toBeDefined();
    expect((await resolveSnirhFeed({ feed: "reservoir-basins" })).history?.earliest).toBe("1989-10-01T00:00:00.000Z");
  });
});

describe("SNIRH station list", () => {
  it("reads a river station's name and code, even when the name has a parenthesis of its own", () => {
    const stations = parseStationList(text("stations-hydrometric.xml"));
    expect(stations).toContainEqual({ site: PONTE_DE_LIMA, code: "03F/03H", name: "PONTE DE LIMA (SÃO JOÃO)" });
    expect(stations).toContainEqual({ site: ALMOUROL, code: "17G/02H", name: "ALMOUROL" });
    expect(stations).toContainEqual({ site: ALTO_TAMEGA, code: "04K/04A", name: "ALBUFEIRA ALTO TÂMEGA (R.E.)" });
  });

  it("reads a well's code from its tooltip, as its label carries nothing else", () => {
    expect(parseStationList(text("stations-piezometric.xml"))).toEqual([
      { site: "2028876", code: "3/N1", name: "A21" },
      { site: "2028878", code: "3/N2", name: "A22" },
    ]);
  });
});

describe("SNIRH readings export", () => {
  it("reads the label of each column and each row's UTC time", () => {
    const csv = parseReadingsCsv(new TextDecoder("windows-1252").decode(fixture("river-level.csv")));
    expect(csv.columns).toEqual(["Nível hidrométrico Instantâneo (m)", "Nível hidrométrico Instantâneo (m)"]);
    expect(csv.rows[0]).toEqual({
      time: "2026-09-20T00:00:00.000Z",
      cells: [
        { value: "-0.28", flag: "" },
        { value: "2.13", flag: "" },
      ],
    });
  });

  it("refuses a page that is not an export", () => {
    expect(() => parseReadingsCsv("<html>session expired</html>")).toThrow(GatekeeperError);
  });
});

describe("SNIRH live readings", () => {
  it("opens a session with the form's filter, then reads the station list through it", async () => {
    const fetcher = snirh();
    await collectSnirhFeed(LEVELS, undefined, SNIRH_ORIGIN, fetcher, new Date("2026-09-22T02:00:00.000Z"));
    const [post, list] = fetcher.mock.calls;
    expect(post?.[1]?.method).toBe("POST");
    const form = new URLSearchParams(String(post?.[1]?.body));
    expect(form.get("f_redes_seleccao[]")).toBe("920123705");
    expect(form.get("f_parametros_seleccao[]")).toBe("1843");
    expect(form.get("f_estado")).toBe("ATIVA");
    expect(new Headers(list?.[1]?.headers).get("cookie")).toBe("PHPSESSID=abc123");
  });

  it("asks for the last three days of every listed station, their commas unencoded as the export expects", async () => {
    const fetcher = snirh();
    await collectSnirhFeed(LEVELS, undefined, SNIRH_ORIGIN, fetcher, new Date("2026-09-22T02:00:00.000Z"));
    const exports = fetcher.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("dados_csv.php"));
    expect(exports).toHaveLength(1);
    expect(exports[0]).toContain(`sites=${ALMOUROL},${PONTE_DE_LIMA}&pars=1843&tmin=20/09/2026&tmax=22/09/2026`);
  });

  it("names each point by its station's code, at the source's own UTC time", async () => {
    const fetcher = snirh();
    const product = await transform(await collectSnirhFeed(LEVELS, undefined, SNIRH_ORIGIN, fetcher, new Date("2026-09-22T02:00:00.000Z")), LEVELS);
    const points = pointsOf(product);
    expect(points[0]).toEqual({ seriesKey: "17G/02H", eventTime: "2026-09-20T00:00:00.000Z", value: -0.28, unit: "m", dimensions: { station: "17G/02H", name: "ALMOUROL" } });
    expect(points.filter((point) => point.seriesKey === "03F/03H")).toHaveLength(24);
    expect(product.watermark).toBe("2026-09-20T23:00:00.000Z");
    expect(product.updateMode).toBe("source-window");
  });

  it("halves a batch whose columns do not line up, until every column has its station", async () => {
    const fetcher = snirh({
      csv: (sites) => (sites.length > 1 ? fixture("river-level-one-column.csv") : sites[0] === ALMOUROL ? fixture("river-level-one-column.csv") : NO_COLUMN),
    });
    const product = await transform(await collectSnirhFeed(LEVELS, undefined, SNIRH_ORIGIN, fetcher, new Date("2026-09-22T02:00:00.000Z")), LEVELS);
    const exports = fetcher.mock.calls.map((call) => new URL(String(call[0])).searchParams.get("sites")).filter(Boolean);
    expect(exports).toEqual([`${ALMOUROL},${PONTE_DE_LIMA}`, ALMOUROL, PONTE_DE_LIMA]);
    expect(new Set(pointsOf(product).map((point) => point.seriesKey))).toEqual(new Set(["17G/02H"]));
  });

  it("refuses a column labelled for another parameter", async () => {
    const other = new TextEncoder().encode(
      new TextDecoder("windows-1252").decode(fixture("river-level.csv")).replaceAll("Nível hidrométrico Instantâneo (m)", "Caudal médio diário (m3/s)"),
    );
    await expect(collectSnirhFeed(LEVELS, undefined, SNIRH_ORIGIN, snirh({ csv: () => other }), new Date())).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("answers unchanged when the collected document is the one the checkpoint names", async () => {
    const now = new Date("2026-09-22T02:00:00.000Z");
    const first = bodyOf(await collectSnirhFeed(LEVELS, undefined, SNIRH_ORIGIN, snirh(), now));
    const second = await collectSnirhFeed(LEVELS, first.validator, SNIRH_ORIGIN, snirh(), now);
    expect(second.kind).toBe("not-modified");
  });

  it.each([
    ["an upstream failure", () => new Response("down", { status: 503 }), "upstream-error"],
    ["a redirect", () => new Response(null, { status: 302, headers: { Location: "https://elsewhere.example/" } }), "source-denied"],
  ])("fails on %s", async (_label, answer, code) => {
    const fetcher = snirh({ onRequest: (url) => (url.pathname.endsWith("dados_csv.php") ? answer() : undefined) });
    await expect(collectSnirhFeed(LEVELS, undefined, SNIRH_ORIGIN, fetcher, new Date())).rejects.toMatchObject({ code });
  });

  it("fails when the filter opens no session", async () => {
    const fetcher = snirh({ onRequest: (url) => (url.pathname === "/index.php" ? new Response("<html></html>") : undefined) });
    await expect(collectSnirhFeed(LEVELS, undefined, SNIRH_ORIGIN, fetcher, new Date())).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("reads nothing but SNIRH's own origin", async () => {
    await expect(collectSnirhFeed(LEVELS, undefined, "https://attacker.example", snirh(), new Date())).rejects.toMatchObject({ code: "source-denied" });
  });
});

describe("SNIRH readings history", () => {
  it("walks back one slice at a time, from every station that ever measured the parameter", async () => {
    const fetcher = snirh();
    const fetched = bodyOf(await collectSnirhHistory(LEVELS, { before: "2026-09-21T00:00:00.000Z" }, SNIRH_ORIGIN, fetcher));
    expect(new URLSearchParams(String(fetcher.mock.calls[0]?.[1]?.body)).get("f_estado")).toBe("");
    const exported = fetcher.mock.calls.map((call) => String(call[0])).find((url) => url.includes("dados_csv.php"));
    expect(exported).toContain("tmin=19/09/2026&tmax=20/09/2026");
    expect(fetched.next).toEqual({ before: "2026-09-19T00:00:00.000Z" });
  });

  it("keeps only what lies before the cursor", async () => {
    const fetched = await collectSnirhHistory(LEVELS, { before: "2026-09-20T12:00:00.000Z" }, SNIRH_ORIGIN, snirh());
    const points = pointsOf(await transform(fetched, LEVELS));
    expect(points.every((point) => point.eventTime < "2026-09-20T12:00:00.000Z")).toBe(true);
    expect(points.at(-1)?.eventTime).toBe("2026-09-20T11:00:00.000Z");
  });

  it("refuses a cursor that is not a time", async () => {
    await expect(collectSnirhHistory(LEVELS, { before: "yesterday" }, SNIRH_ORIGIN, snirh())).rejects.toMatchObject({ code: "invalid-config" });
  });
});

describe("SNIRH monthly precipitation", () => {
  const config = { feed: "monthly-precipitation" };

  it("asks for each month with a two-digit month and its hydrological year", async () => {
    const fetcher = snirh();
    await collectSnirhFeed(config, undefined, SNIRH_ORIGIN, fetcher, new Date("2026-10-05T00:00:00.000Z"));
    const asked = fetcher.mock.calls.map((call) => new URL(String(call[0])).searchParams);
    expect(asked.map((params) => `${params.get("prec_anoh")} ${params.get("mestarget")}`)).toEqual(["2025/26 08", "2025/26 09", "2026/27 10"]);
  });

  it("publishes finished months only, per station, with the station's normal", async () => {
    const product = await transform(await collectSnirhFeed(config, undefined, SNIRH_ORIGIN, snirh(), new Date("2026-09-22T00:00:00.000Z")), config, "2026-09-22T00:00:00.000Z");
    const points = pointsOf(product);
    // July and August from the fixture; September is still under way, and the regional entries have no station.
    expect(points).toHaveLength(6);
    expect(points).toContainEqual({
      seriesKey: "01H/02G",
      eventTime: "2026-08-01T00:00:00.000Z",
      value: 58.3,
      unit: "mm",
      dimensions: { station: "01H/02G", name: "PORTELINHA", normalMm: "53" },
    });
  });

  it("walks back twelve months at a time and stops at the archive's first month", async () => {
    const slice = bodyOf(await collectSnirhHistory(config, { before: "2026-01-01T00:00:00.000Z" }, SNIRH_ORIGIN, snirh()));
    expect(slice.next).toEqual({ before: "2025-01-01T00:00:00.000Z" });
    const last = bodyOf(await collectSnirhHistory(config, { before: "1981-06-01T00:00:00.000Z" }, SNIRH_ORIGIN, snirh()));
    expect(last.exhausted).toBe(true);
    expect(await collectSnirhHistory(config, { before: "1980-10-01T00:00:00.000Z" }, SNIRH_ORIGIN, snirh())).toEqual({ kind: "exhausted" });
  });
});

describe("SNIRH reservoir storage by basin", () => {
  const config = { feed: "reservoir-basins" };

  it("reads each hydrological year's months per basin, leaving out the means and unpublished months", async () => {
    const points = pointsOf(await transform(await collectSnirhFeed(config, undefined, SNIRH_ORIGIN, snirh(), new Date("2026-09-22T00:00:00.000Z")), config));
    expect(new Set(points.map((point) => point.seriesKey)).size).toBe(12);
    // October belongs to the calendar year the hydrological year starts in.
    expect(points).toContainEqual({ seriesKey: "tejo", eventTime: "2025-10-01T00:00:00.000Z", value: 69, unit: "%", dimensions: { basin: "TEJO", capacityHm3: "2546.4" } });
    expect(points).toContainEqual({
      seriesKey: "cavado-ribeiras-costeiras",
      eventTime: "2024-10-01T00:00:00.000Z",
      value: 78,
      unit: "%",
      dimensions: { basin: "CÁVADO/RIBEIRAS COSTEIRAS", capacityHm3: "1169.6" },
    });
    expect(points.some((point) => point.eventTime === "2026-09-01T00:00:00.000Z")).toBe(false);
  });

  it("asks for the year before the cursor and steps back two, as each table prints two years", async () => {
    const fetcher = snirh();
    const slice = bodyOf(await collectSnirhHistory(config, { before: "2026-01-01T00:00:00.000Z" }, SNIRH_ORIGIN, fetcher));
    expect(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get("anohi")).toBe("2025");
    expect(slice.next).toEqual({ before: "2024-10-01T00:00:00.000Z" });
    expect(await collectSnirhHistory(config, { before: "1989-11-01T00:00:00.000Z" }, SNIRH_ORIGIN, snirh())).toEqual({ kind: "exhausted" });
  });
});

describe("SNIRH groundwater state", () => {
  const config = { feed: "groundwater-state" };

  it("keeps a record per aquifer and month, and leaves out an aquifer with no class", async () => {
    const records = recordsOf(await transform(await collectSnirhFeed(config, undefined, SNIRH_ORIGIN, snirh(), new Date("2026-08-15T00:00:00.000Z")), config));
    // Three months asked, the same fixture each time: three classed aquifers a month.
    expect(records).toHaveLength(9);
    expect(records).toContainEqual({
      entityKey: "2007467:2026-08",
      eventTime: "2026-08-01T00:00:00.000Z",
      payload: { month: "2026-08-01", aquiferId: "2007467", aquifer: "A1 - VEIGA DE CHAVES", state: "SUP_MEDIA", stateLabel: "Above the monthly mean" },
    });
    expect(new Set(records.map((record) => record.payload.state))).toEqual(new Set(["SUP_MEDIA", "INF_P20", "SUP_P20_INF_MEDIA"]));
  });
});

describe("SNIRH through a feed's own file", () => {
  it("frames a live collection with the feed's fetch, and a history slice with its backfill", async () => {
    const { resolved, collector } = await feedCollection("snirh-river-levels-feed", { fetcher: snirh(), now: () => new Date("2026-09-22T02:00:00.000Z") });
    const live = await collectNormalized(await request({ resolved }), collector);
    expect(live.kind).toBe("batch");
    if (live.kind !== "batch") return;
    const frames = (await new Response(live.stream).text())
      .trim()
      .split("\n")
      .map((line) => {
        const frame = parseJson(line);
        if (!isJsonObject(frame)) throw new Error("Every frame is a JSON object");
        return frame;
      });
    expect(frames[0]?.type).toBe("header");
    const complete: JsonObject | undefined = frames.at(-1);
    expect(complete?.type).toBe("complete");
    expect(complete?.counts).toEqual({ records: 0, points: 48 });

    const history = await collectNormalized(await request({ resolved, mode: { kind: "history", cursor: { before: "2026-09-21T00:00:00.000Z" } } }), collector);
    expect(history.kind).toBe("batch");
  });
});

async function request(overrides: Partial<CollectionRequest> = {}): Promise<CollectionRequest> {
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: "collection_1",
    feed: { id: "feed_1", slug: "snirh-river-levels-feed", title: "River levels", description: "test feed" },
    resolved: await resolveSnirhFeed(LEVELS),
    feedEpoch: "epoch-1",
    mode: { kind: "live" },
    limits: { sourceBytes: 12_582_912, outputBytes: 16_777_216, frameBytes: 262_144, recordBytes: 4_096, records: 150_000, products: 4 },
    deadline: new Date(Date.now() + 30_000).toISOString(),
    observedAt: "2026-09-22T02:00:00.000Z",
    ...overrides,
  };
}
