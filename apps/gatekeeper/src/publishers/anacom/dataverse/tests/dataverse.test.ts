import { describe, expect, it } from "vitest";
import { collectNormalized, type NormalizedRow, type SeriesPoint, type SourceConfig, type SourceFetch } from "#/index";
import { DATAVERSE_API_ORIGIN, collectIndicator, indexUrl, periodStart, transformIndicator, validateDataverseFeedConfig } from "#/publishers/anacom/dataverse/index";
import { networkContext, networkFrames, networkRequest } from "#/tests/networks-support";
import { feedCollection } from "#/tests/catalog";
import { readFixture, readFixtureBytes } from "#/tests/support";

/** A saved STAT.ANACOM answer beside this test. */
const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url);
const archive = (indicator: string) => readFixtureBytes(fixture(`${indicator}_EN.zip`));
const index = (indicator: string) => readFixture(fixture(`index-${indicator}.json`));

const SHARES: SourceConfig = { indicator: "IndI_P070", unit: "%" };
const ACCESSES: SourceConfig = { indicator: "IndI_P068", unit: "accesses" };
const REVENUES: SourceConfig = { indicator: "IndI_P123", unit: "EUR" };

/** STAT.ANACOM as the saved answers have it: the index row for each indicator, then its file under that row's record ID. */
function stat(files: Record<string, { index: string; archive: Uint8Array }>, requests: URL[] = []): typeof fetch {
  return async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    for (const [indicator, answer] of Object.entries(files)) {
      if (url.pathname === "/_api/cr8db_stat_popupfileses" && url.searchParams.get("$filter") === `cr8db_indicador eq '${indicator}'`) {
        return new Response(answer.index, { headers: { "Content-Type": "application/json" } });
      }
      const id = /"cr8db_stat_popupfilesid": "([^"]+)"/.exec(answer.index)?.[1];
      if (url.pathname === `/_api/cr8db_stat_popupfileses(${id})/cr8db_fileen/$value`) {
        return new Response(answer.archive, { headers: { "Content-Type": "application/octet-stream" } });
      }
    }
    return new Response("not found", { status: 404 });
  };
}

function body(fetched: SourceFetch): Uint8Array {
  if (fetched.kind !== "body" || !(fetched.body instanceof Uint8Array)) throw new Error(`Expected a buffered body, got ${fetched.kind}`);
  return fetched.body;
}

/** The CSV inside an indicator's saved archive, as the collection hands it to the transform. */
async function csv(config: SourceConfig): Promise<Uint8Array> {
  const indicator = config.indicator ?? "";
  return body(await collectIndicator(config, undefined, DATAVERSE_API_ORIGIN, stat({ [indicator]: { index: index(indicator), archive: archive(indicator) } })));
}

/** Bytes as a stream of `size`-byte chunks. */
function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
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

async function points(config: SourceConfig, chunkSize = 64 * 1024) {
  const transform = transformIndicator(chunked(await csv(config), chunkSize), networkContext(config));
  const rows: NormalizedRow[] = [];
  for await (const row of transform.rows) rows.push(row);
  const series = rows.map((row) => row.point).filter((point): point is SeriesPoint => point !== undefined);
  return { products: transform.products, series, summary: transform.finish() };
}

function find(series: SeriesPoint[], seriesKey: string, eventTime: string): SeriesPoint | undefined {
  return series.find((point) => point.seriesKey === seriesKey && point.eventTime === eventTime);
}

describe("STAT.ANACOM configuration", () => {
  it("names one indicator by its code and the unit its values are in, and nothing else", () => {
    expect(validateDataverseFeedConfig({ indicator: " IndI_P070 ", unit: " % " })).toEqual({ indicator: "IndI_P070", unit: "%" });
    for (const config of [
      { indicator: "IndI_P70", unit: "%" },
      { indicator: "P070", unit: "%" },
      { indicator: "IndI_P070'or'1'eq'1", unit: "%" },
      { indicator: "IndI_P070", unit: "" },
      { indicator: "IndI_P070", unit: "x".repeat(41) },
      { indicator: "IndI_P070" },
      { ...SHARES, recordId: "a92d49ac-658b-f111-ab10-7c1e5236d412" },
    ]) {
      expect(() => validateDataverseFeedConfig(config)).toThrow();
    }
    expect(() => validateDataverseFeedConfig({ ...SHARES, host: "evil.example" })).toThrow(expect.objectContaining({ code: "source-denied" }));
  });

  it("asks the index for one indicator's row, and only the three fields it reads", () => {
    const url = indexUrl(DATAVERSE_API_ORIGIN, "IndI_P070");
    expect(url.origin).toBe(DATAVERSE_API_ORIGIN);
    expect(url.pathname).toBe("/_api/cr8db_stat_popupfileses");
    expect(url.searchParams.get("$filter")).toBe("cr8db_indicador eq 'IndI_P070'");
    expect(url.searchParams.get("$select")).toBe("cr8db_stat_popupfilesid,cr8db_indicador,cr8db_fileen_name");
  });

  it("reads only the STAT.ANACOM origin", async () => {
    await expect(collectIndicator(SHARES, undefined, "https://stat.anacom.pt.evil.example", stat({}))).rejects.toMatchObject({ code: "source-denied" });
  });
});

describe("STAT.ANACOM collection", () => {
  it("looks the file up by code, then reads the CSV out of its ZIP", async () => {
    const requests: URL[] = [];
    const fetched = await collectIndicator(SHARES, undefined, DATAVERSE_API_ORIGIN, stat({ IndI_P070: { index: index("IndI_P070"), archive: archive("IndI_P070") } }, requests));
    expect(requests.map((url) => url.pathname)).toEqual([
      "/_api/cr8db_stat_popupfileses",
      "/_api/cr8db_stat_popupfileses(a92d49ac-658b-f111-ab10-7c1e5236d412)/cr8db_fileen/$value",
    ]);
    expect(fetched).toMatchObject({ kind: "body", completeness: "complete", provenance: { sourceUrl: expect.stringContaining("Dados-abertos") } });
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body(fetched));
    expect(text.startsWith("﻿GrupoDimensao\tId_Periodo\t")).toBe(true);
    expect(text.split("\n").filter((line) => line.trim() !== "")).toHaveLength(329);
  });

  it("answers not-modified when the inflated CSV is the one it read last", async () => {
    const fetcher = stat({ IndI_P070: { index: index("IndI_P070"), archive: archive("IndI_P070") } });
    const first = await collectIndicator(SHARES, undefined, DATAVERSE_API_ORIGIN, fetcher);
    if (first.kind !== "body" || !first.validator) throw new Error("Expected a body with a validator");
    expect(await collectIndicator(SHARES, first.validator, DATAVERSE_API_ORIGIN, fetcher)).toEqual({ kind: "not-modified", validator: first.validator });
    expect(await collectIndicator(SHARES, { etag: '"sha256-other"' }, DATAVERSE_API_ORIGIN, fetcher)).toMatchObject({ kind: "body" });
  });

  it("fails honestly when the index or the file is not what it should be", async () => {
    const busy: typeof fetch = async () => new Response("busy", { status: 503, headers: { "Retry-After": "120" } });
    await expect(collectIndicator(SHARES, undefined, DATAVERSE_API_ORIGIN, busy)).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 120 });
    const empty = index("IndI_P070").replace(/"value": \[[\s\S]*\]/, '"value": []');
    await expect(collectIndicator(SHARES, undefined, DATAVERSE_API_ORIGIN, stat({ IndI_P070: { index: empty, archive: archive("IndI_P070") } }))).rejects.toMatchObject({
      code: "invalid-config",
    });
    // The index answering for another indicator, or a file that holds another indicator's CSV.
    await expect(
      collectIndicator(SHARES, undefined, DATAVERSE_API_ORIGIN, stat({ IndI_P070: { index: index("IndI_P068"), archive: archive("IndI_P070") } })),
    ).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(
      collectIndicator(SHARES, undefined, DATAVERSE_API_ORIGIN, stat({ IndI_P070: { index: index("IndI_P070"), archive: archive("IndI_P068") } })),
    ).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(
      collectIndicator(SHARES, undefined, DATAVERSE_API_ORIGIN, stat({ IndI_P070: { index: index("IndI_P070"), archive: new TextEncoder().encode("<html>not a zip</html>") } })),
    ).rejects.toMatchObject({ code: "invalid-response" });
    const huge: typeof fetch = async (input) =>
      String(input).includes("$value")
        ? new Response("x", { headers: { "Content-Length": String(2 * 1024 * 1024) } })
        : new Response(index("IndI_P070"), { headers: { "Content-Type": "application/json" } });
    await expect(collectIndicator(SHARES, undefined, DATAVERSE_API_ORIGIN, huge)).rejects.toMatchObject({ code: "response-too-large" });
  });
});

describe("STAT.ANACOM series", () => {
  it("dates each value by the start of its quarter or year", () => {
    expect(periodStart("2026 T2")).toBe("2026-04-01T00:00:00Z");
    expect(periodStart("2018 T1")).toBe("2018-01-01T00:00:00Z");
    expect(periodStart("2025 T4")).toBe("2025-10-01T00:00:00Z");
    expect(periodStart("2025")).toBe("2025-01-01T00:00:00Z");
    for (const period of ["2026 T5", "2026-Q2", "T2 2026", ""]) expect(periodStart(period)).toBeUndefined();
  });

  it("keys a market share by operator and breakdown, and keeps the operator's group as a dimension", async () => {
    const { products, series, summary } = await points(SHARES);
    expect(products).toEqual([
      expect.objectContaining({ productKey: "series", kind: "series", role: "time-series", updateMode: "authoritative-snapshot", completeness: "complete" }),
    ]);
    expect(summary.quality).toEqual({ acceptedRecords: 328, rejectedRecords: 0 });
    expect(summary.products).toEqual([{ productKey: "series", watermark: "2026-04-01T00:00:00Z" }]);
    expect(find(series, "Prestador=MEO", "2026-04-01T00:00:00Z")).toEqual({
      seriesKey: "Prestador=MEO",
      eventTime: "2026-04-01T00:00:00Z",
      value: 37.9,
      unit: "%",
      dimensions: { Segmento: "Total", Grupo_Prestador: "Grupo Altice", Prestador: "MEO" },
    });
    expect(find(series, "Segmento=Residential;Prestador=MEO", "2026-04-01T00:00:00Z")?.value).toBe(37);
    // NOWO changed groups three times and is one series throughout.
    const nowo = series.filter((point) => point.seriesKey === "Prestador=NOWO");
    expect(new Set(nowo.map((point) => point.dimensions.Grupo_Prestador))).toEqual(new Set(["Sem grupo", "Grupo NOWO / Onitelecom", "Grupo DIGI / NOWO"]));
  });

  it("calls every breakdown a row does not split by its total, whatever the file wrote there", async () => {
    const { series, summary } = await points(REVENUES);
    expect(summary.quality.rejectedRecords).toBe(0);
    expect(find(series, "Total", "2026-04-01T00:00:00Z")).toMatchObject({
      value: 1973341492.5284991,
      unit: "EUR",
      dimensions: { Servico_Nivel_1: "Total", Servico_Nivel_2: "Total", Segmento: "Total", Tipo_de_pacote: "Total" },
    });
    expect(find(series, "Segmento=Residential;Receitas_roaming_out=Yes", "2026-04-01T00:00:00Z")?.value).toBe(16343859.66954437);
  });

  it("rejects a row whose group names a breakdown the file has no column for", async () => {
    const { series, summary } = await points(ACCESSES);
    // Eight rows split by number range, place and internet use, none of which this file has a column for.
    expect(summary.quality).toEqual({ acceptedRecords: 202, rejectedRecords: 8 });
    expect(find(series, "Total", "2026-04-01T00:00:00Z")?.value).toBe(17262654);
    expect(new Set(series.map((point) => `${point.seriesKey}@${point.eventTime}`)).size).toBe(series.length);
  });

  it("reads the same series one byte at a time", async () => {
    const whole = await points(SHARES);
    const bytewise = await points(SHARES, 1);
    expect(bytewise.series).toEqual(whole.series);
    expect(bytewise.summary).toEqual(whole.summary);
  });

  it("refuses a file without the columns every indicator carries", async () => {
    const transform = transformIndicator(chunked(new TextEncoder().encode("Periodo\tValor\n2026 T2\t1\n"), 64), networkContext(SHARES));
    await expect(async () => {
      for await (const _row of transform.rows) {
        // Reading is what fails.
      }
    }).rejects.toMatchObject({ code: "invalid-response" });
  });
});

describe("an ANACOM indicator feed", () => {
  it("collects through the Worker's path into one complete series", async () => {
    const { collector } = await feedCollection("anacom-mobile-access-shares", { fetcher: stat({ IndI_P070: { index: index("IndI_P070"), archive: archive("IndI_P070") } }) });
    const frames = await networkFrames(await collectNormalized(await networkRequest(collector), collector));
    expect(frames.filter((frame) => frame.type === "header")).toHaveLength(1);
    expect(frames.filter((frame) => frame.type === "point")).toHaveLength(328);
    expect(frames.at(-1)).toMatchObject({ type: "complete", quality: { acceptedRecords: 328, rejectedRecords: 0 } });
  });
});
