import { jsonAs } from "./support";
import { describe, expect, it, vi } from "vitest";
import { retryAfterSeconds, type SourceBody, type SourceFetch, type TransformContext } from "@open-data-pt/gatekeeper";
import { collectOmieFeed, collectOmieHistory, OMIE_HISTORY_EARLIEST, OMIE_MAX_BYTES, validateOmieFeedConfig } from "../apps/gatekeeper/src/publishers/omie/omie/omie";
import { OmieTransformer } from "../apps/gatekeeper/src/publishers/omie/omie/transform";

const ORIGIN = "https://www.omie.es";
const NOW = () => new Date("2026-09-07T10:00:00.000Z");

function priceFile(series: "marginalpdbc" | "marginalpdbcpt", date: string): string {
  const [year, month, day] = date.split("-");
  return `${series.toUpperCase()};\n${year};${month};${day};1;10;20;\n*\n`;
}

function historyPriceReport(date: string, periods = 1): string {
  const labels = Array.from({ length: periods }, (_, index) => String(index + 1));
  const es = labels.map((label) => `${label},00`);
  const pt = labels.map((label) => `${Number(label) + 10},00`);
  return [
    `OMIE - Mercado de electricidad;Fecha Emision;;${date};Precio del mercado diario (EUR/MWh);`,
    "",
    `;${labels.join(";")};`,
    `Precio marginal en el sistema espanol (EUR/MWh);${es.join(";")};`,
    `Precio marginal en el sistema portugues (EUR/MWh);${pt.join(";")};`,
    "*",
  ].join("\n");
}

function historyContext(): TransformContext {
  return {
    feed: {
      id: "feed_omie_history",
      slug: "omie-history",
      title: "OMIE history",
      description: "test",
      config: { series: "marginalpdbc", days: "2" },
      semantics: {
        boundedness: "bounded",
        changeSemantics: "full-snapshot",
        cadence: "periodic",
        domainSubject: "observation",
        defaultProductRole: "time-series",
        completeness: "complete",
        ordering: "per-entity",
      },
    },
    observedAt: "2026-09-08T12:00:00.000Z",
  };
}

/** The body a fetch carried, failing the test when the adapter returned anything else. */
function sourceBody(fetched: SourceFetch): SourceBody & { body: Uint8Array } {
  if (fetched.kind !== "body") throw new Error(`Expected a source body, got ${fetched.kind}`);
  const { body } = fetched;
  if (!(body instanceof Uint8Array)) throw new Error("Expected a buffered source body");
  return { ...fetched, body };
}

describe("OMIE Gatekeeper", () => {
  it("validates and normalizes series and day counts", () => {
    expect(validateOmieFeedConfig({ series: "marginalpdbc" })).toEqual({
      series: "marginalpdbc",
      days: "2",
    });
    expect(validateOmieFeedConfig({ series: "marginalpdbcpt", days: "7" })).toEqual({ series: "marginalpdbcpt", days: "7" });
    expect(() => validateOmieFeedConfig({ series: "curva_pbc" })).toThrow("series=marginalpdbc or marginalpdbcpt");
    expect(() => validateOmieFeedConfig({ series: "marginalpdbc", days: "8" })).toThrow("integer from 1 to 7");
  });

  it("rejects caller-provided hosts and a misconfigured Worker origin", async () => {
    expect(() =>
      validateOmieFeedConfig({
        series: "marginalpdbc",
        host: "evil.example",
      }),
    ).toThrow("does not accept host");
    await expect(collectOmieFeed({ series: "marginalpdbc", days: "1" }, undefined, "https://evil.example", vi.fn(), NOW)).rejects.toMatchObject({ code: "source-denied" });
  });

  it("collects the requested available days into a deterministic document with provenance", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      const filename = url.searchParams.get("filename");
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe("/en/file-download");
      expect(url.searchParams.get("parents")).toBe("marginalpdbc");
      if (filename === "marginalpdbc_20260908.1") {
        return new Response("not published", { status: 404 });
      }
      if (filename === "marginalpdbc_20260907.1") {
        return new Response(priceFile("marginalpdbc", "2026-09-07"), {
          headers: { "Last-Modified": "Sun, 06 Sep 2026 12:56:00 GMT" },
        });
      }
      if (filename === "marginalpdbc_20260906.1") {
        return new Response(priceFile("marginalpdbc", "2026-09-06"), {
          headers: { "Last-Modified": "Sat, 05 Sep 2026 13:03:26 GMT" },
        });
      }
      throw new Error(`Unexpected file ${filename}`);
    });

    const fetched = sourceBody(await collectOmieFeed({ series: "marginalpdbc" }, undefined, ORIGIN, fetcher, NOW));

    expect(fetched.validator?.etag).toMatch(/^"sha256-[0-9a-f]{64}"$/u);
    expect(fetched.validator?.lastModified).toBe("Sun, 06 Sep 2026 12:56:00 GMT");
    expect(fetched.completeness).toBe("complete");
    expect(fetched.provenance).toEqual({
      sourceUrl: "https://www.omie.es/en/file-download?parents=marginalpdbc&filename=marginalpdbc_20260907.1",
    });
    expect(fetched.next).toBeUndefined();
    expect(jsonAs(fetched.body)).toEqual({
      series: "marginalpdbc",
      files: [
        {
          date: "2026-09-06",
          filename: "marginalpdbc_20260906.1",
          text: priceFile("marginalpdbc", "2026-09-06"),
        },
        {
          date: "2026-09-07",
          filename: "marginalpdbc_20260907.1",
          text: priceFile("marginalpdbc", "2026-09-07"),
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("marks a window with fewer published days than requested as partial", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const filename = new URL(input.toString()).searchParams.get("filename");
      return filename === "marginalpdbc_20260907.1" ? new Response(priceFile("marginalpdbc", "2026-09-07")) : new Response(null, { status: 404 });
    });
    const fetched = sourceBody(await collectOmieFeed({ series: "marginalpdbc", days: "2" }, undefined, ORIGIN, fetcher, NOW));
    expect(fetched.completeness).toBe("partial");
  });

  it("forwards checkpoints and reports an unchanged synthetic ETag as not modified", async () => {
    let expectedCheckpoint: string | undefined;
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (expectedCheckpoint) {
        expect(headers.get("if-none-match")).toBe(expectedCheckpoint);
        expect(headers.get("if-modified-since")).toBe("Mon, 07 Sep 2026 13:27:45 GMT");
      }
      return new Response(priceFile("marginalpdbc", "2026-09-08"));
    });
    const first = sourceBody(await collectOmieFeed({ series: "marginalpdbc", days: "1" }, undefined, ORIGIN, fetcher, NOW));
    const etag = first.validator?.etag;
    if (!etag) throw new Error("Expected a synthetic ETag");
    expectedCheckpoint = etag;

    const second = await collectOmieFeed({ series: "marginalpdbc", days: "1" }, { etag, lastModified: "Mon, 07 Sep 2026 13:27:45 GMT" }, ORIGIN, fetcher, NOW);

    expect(second).toEqual({ kind: "not-modified", validator: { etag } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports an upstream 304 as not modified, keeping checkpoint validators the provider omitted", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 304, headers: { ETag: '"provider-v1"' } }));
    const fetched = await collectOmieFeed({ series: "marginalpdbcpt", days: "1" }, { etag: '"provider-v0"', lastModified: "Mon, 07 Sep 2026 13:27:45 GMT" }, ORIGIN, fetcher, NOW);
    expect(fetched).toEqual({
      kind: "not-modified",
      validator: { etag: '"provider-v1"', lastModified: "Mon, 07 Sep 2026 13:27:45 GMT" },
    });
  });

  it("rejects a response over the one MiB cap", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("x", {
          headers: { "Content-Length": String(OMIE_MAX_BYTES + 1) },
        }),
    );
    await expect(collectOmieFeed({ series: "marginalpdbc", days: "1" }, undefined, ORIGIN, fetcher, NOW)).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("reports provider errors with their retry delay and without returning their body", async () => {
    const fetcher = vi.fn(async () => new Response("provider details", { status: 503, headers: { "Retry-After": "120" } }));
    await expect(collectOmieFeed({ series: "marginalpdbc", days: "1" }, undefined, ORIGIN, fetcher, NOW)).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: 120,
      message: "OMIE returned HTTP 503 for marginalpdbc_20260908.1",
    });
  });

  it("rejects a successful response that is not an OMIE price file", async () => {
    const fetcher = vi.fn(async () => new Response("<html>maintenance</html>"));
    await expect(collectOmieFeed({ series: "marginalpdbc", days: "1" }, undefined, ORIGIN, fetcher, NOW)).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("reads Retry-After as a delay or an HTTP date", () => {
    expect(retryAfterSeconds(new Headers({ "Retry-After": "45" }))).toBe(45);
    const inAMinute = new Date(Date.now() + 60_000).toUTCString();
    expect(retryAfterSeconds(new Headers({ "Retry-After": inAMinute }))).toBeGreaterThanOrEqual(58);
    expect(retryAfterSeconds(new Headers({ "Retry-After": "Thu, 01 Jan 1970 00:00:00 GMT" }))).toBe(0);
    expect(retryAfterSeconds(new Headers({ "Retry-After": "soon" }))).toBeUndefined();
    expect(retryAfterSeconds(new Headers())).toBeUndefined();
  });
});

describe("OMIE history", () => {
  it("collects one seven-day slice with its range, next cursor, and bytes the existing transform accepts", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      const match = /_(\d{2})_(\d{2})_(\d{4})_\1_\2_\3\.TXT$/u.exec(url.pathname);
      if (!match) throw new Error(`Unexpected history URL ${url}`);
      const date = `${match[3]}-${match[2]}-${match[1]}`;
      return new Response(historyPriceReport(date));
    });

    const fetched = sourceBody(await collectOmieHistory({ series: "marginalpdbc" }, { before: "2026-09-08T22:00:00.000Z" }, ORIGIN, fetcher));

    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(fetched.next).toEqual({ before: "2026-09-01T22:00:00.000Z" });
    expect(fetched.exhausted).toBeUndefined();
    expect(fetched.completeness).toBe("complete");
    expect(fetched.provenance).toEqual({
      sourceUrl: "https://www.omie.es/sites/default/files/dados/AGNO_2026/MES_09/TXT/INT_PBC_EV_H_1_02_09_2026_02_09_2026.TXT",
    });

    const document = jsonAs<{
      series: string;
      files: Array<{ date: string; filename: string; text: string }>;
    }>(fetched.body);
    expect(document.series).toBe("marginalpdbc");
    expect(document.files.map((file) => file.date)).toEqual(["2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"]);
    const transformed = new OmieTransformer().transform(fetched.body, historyContext());
    expect(transformed.products[0]?.points).toHaveLength(14);
    expect(transformed.products[1]?.records).toHaveLength(7);
    expect(transformed.products[1]?.records?.[0]?.eventTime).toBe("2026-09-01T22:00:00.000Z");
  });

  it("skips a missing file and crosses a DST month boundary without losing cursor progress", async () => {
    const fetchedPaths: string[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const pathname = new URL(input.toString()).pathname;
      fetchedPaths.push(pathname);
      if (pathname.includes("31_03_2026")) return new Response(null, { status: 404 });
      const match = /_(\d{2})_(\d{2})_(\d{4})_\1_\2_\3\.TXT$/u.exec(pathname)!;
      const date = `${match[3]}-${match[2]}-${match[1]}`;
      const periods = date === "2026-03-29" ? 23 : 24;
      return new Response(historyPriceReport(date, periods));
    });

    const fetched = sourceBody(await collectOmieHistory({ series: "marginalpdbc", days: "7" }, { before: "2026-04-03T22:00:00.000Z" }, ORIGIN, fetcher));
    expect(fetched.completeness).toBe("partial");
    expect(fetched.next).toEqual({ before: "2026-03-27T23:00:00.000Z" });
    expect(fetchedPaths[0]).toContain("03_04_2026");
    expect(fetchedPaths.at(-1)).toContain("28_03_2026");
    const transformed = new OmieTransformer().transform(fetched.body, historyContext());
    expect(transformed.quality.rejectedRecords).toBe(0);
  });

  it("reports exhaustion when the known boundary is reached or a whole slice is missing", async () => {
    const unusedFetcher = vi.fn();
    const boundary = await collectOmieHistory({ series: "marginalpdbc" }, { before: OMIE_HISTORY_EARLIEST }, ORIGIN, unusedFetcher);
    expect(boundary).toEqual({ kind: "exhausted" });
    expect(unusedFetcher).not.toHaveBeenCalled();

    const missingFetcher = vi.fn(async () => new Response(null, { status: 404 }));
    const missing = await collectOmieHistory({ series: "marginalpdbc" }, { before: "2007-07-08T22:00:00.000Z" }, ORIGIN, missingFetcher);
    expect(missing).toEqual({ kind: "exhausted" });
    expect(missingFetcher).toHaveBeenCalledTimes(7);
  });

  it.each([429, 503])("maps upstream HTTP %i to a retryable upstream error with its retry delay", async (status) => {
    await expect(
      collectOmieHistory(
        { series: "marginalpdbc" },
        { before: "2026-09-08T22:00:00.000Z" },
        ORIGIN,
        vi.fn(async () => new Response("provider details", { status, headers: { "Retry-After": "30" } })),
      ),
    ).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 30 });
  });
});
