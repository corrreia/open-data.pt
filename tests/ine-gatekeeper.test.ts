import { jsonAs } from "./support";
import { describe, expect, it, vi } from "vitest";
import type {
  JsonObject,
  JsonValue,
  SourceBody,
  SourceFetch,
  TransformContext,
} from "@open-data-pt/gatekeeper-shared";
import { libraryConfig } from "@open-data-pt/gatekeeper-shared";
import {
  INE_FEEDS,
  INE_HISTORY_MAX_BYTES,
  INE_MAX_BYTES,
  collectIneIndicator,
  collectIneIndicatorHistory,
  validateIneFeedConfig,
} from "../packages/gatekeeper-shared/src/sources/ine/ine";
import { INE_EXAMPLES } from "../packages/gatekeeper-shared/src/sources/ine/examples";
import { transformIneIndicator } from "../packages/gatekeeper-shared/src/sources/ine/transform";

const META = [
  {
    IndicadorCod: "0007976",
    IndicadorNome: "Taxa de desemprego",
    Periodic: "Mensal",
    UnidadeMedida: "Percentagem (%)",
    DataUltimaAtualizacao: "2026-08-31",
    Dimensoes: { Descricao_Dim: [], Categoria_Dim: [] },
  },
];

const DATA = [
  {
    IndicadorCod: "0007976",
    IndicadorDsg: "Taxa de desemprego",
    DataUltimoAtualizacao: "2026-08-31",
    Dados: { "2026-07": [] },
  },
];

function jsonResponse(value: JsonValue | undefined, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

interface TestPeriod {
  code: string;
  label: string;
  order: string;
}

function annualPeriods(from: number, to: number): TestPeriod[] {
  return Array.from({ length: to - from + 1 }, (_, index) => {
    const year = from + index;
    return { code: `S7A${year}`, label: String(year), order: `${year}0101` };
  });
}

function monthlyPeriods(from: string, count: number): TestPeriod[] {
  const [year = 0, month = 0] = from.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 + index, 1));
    const label = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return {
      code: `S3A${label.replace("-", "")}`,
      label,
      order: `${label.replace("-", "")}01`,
    };
  });
}

function historyMeta(
  periodic: string,
  periods: TestPeriod[],
  otherDimensionSizes: number[] = [],
): JsonValue[] {
  const dimensionGroups = otherDimensionSizes.map((size, index) => {
    const number = index + 2;
    return {
      [`Dim${number}`]: Array.from({ length: size }, (_, category) => ({
        dim_num: String(number),
        categ_cod: `D${number}C${category}`,
        categ_dsg: `Dimension ${number} category ${category}`,
        categ_ord: String(category),
      })),
    };
  });
  return [
    {
      ...META[0],
      Periodic: periodic,
      Dimensoes: {
        Descricao_Dim: [],
        Categoria_Dim: [
          {
            Dim1: periods.map((period) => ({
              dim_num: "1",
              categ_cod: period.code,
              categ_dsg: period.label,
              categ_ord: period.order,
            })),
          },
          ...dimensionGroups,
        ],
      },
    },
  ];
}

function historyData(periods: TestPeriod[], codes: string[]): JsonValue[] {
  const selected = periods.filter((period) => codes.includes(period.code));
  return [
    {
      ...DATA[0],
      Dados: Object.fromEntries(
        selected.map((period, index) => [
          period.label,
          [
            {
              geocod: "PT",
              geodsg: "Portugal",
              valor: String(index + 1),
            },
          ],
        ]),
      ),
    },
  ];
}

function transformContext(): TransformContext {
  return {
    feed: {
      id: "feed_history",
      slug: "ine-history",
      title: "INE history",
      description: "History test",
      config: { indicator: "0007976", lang: "PT" },
      semantics: INE_FEEDS.indicator.semantics,
    },
    observedAt: "2026-09-08T00:00:00.000Z",
  };
}

function sourceBody(fetched: SourceFetch): SourceBody {
  if (fetched.kind !== "body") throw new Error(`Expected a source body, got ${fetched.kind}`);
  return fetched;
}

function bodyBytes(fetched: SourceBody): Uint8Array {
  if (!(fetched.body instanceof Uint8Array)) throw new Error("Expected buffered source bytes");
  return fetched.body;
}

describe("INE Gatekeeper", () => {
  it("ships example feeds whose configurations all validate", () => {
    expect(INE_EXAMPLES).toHaveLength(26);
    for (const example of INE_EXAMPLES) {
      expect(() => validateIneFeedConfig(libraryConfig(example.config))).not.toThrow();
    }
  });

  it("normalizes valid indicator configuration and dimension filters", () => {
    expect(
      validateIneFeedConfig({
        indicator: " 0007976 ",
        lang: "pt",
        dims: "dim3=T,2&Dim1=S3A202607",
      }),
    ).toEqual({
      indicator: "0007976",
      lang: "PT",
      dims: "Dim1=S3A202607&Dim3=T%2C2",
    });
    expect(validateIneFeedConfig({ indicator: "0004167" })).toEqual({
      indicator: "0004167",
      lang: "PT",
    });
  });

  it("rejects malformed indicators, caller-provided hosts, and unsafe origins", async () => {
    expect(() => validateIneFeedConfig({ indicator: "4167" })).toThrow(
      "exactly seven digits",
    );
    expect(() =>
      validateIneFeedConfig({
        indicator: "0004167",
        host: "attacker.example",
      }),
    ).toThrow("does not accept host");
    await expect(
      collectIneIndicator(
        { indicator: "0004167" },
        undefined,
        "https://attacker.example",
        vi.fn(),
      ),
    ).rejects.toThrow("restricted to https://www.ine.pt");
  });

  it("collects metadata and data into one bounded document with provenance", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.origin).toBe("https://www.ine.pt");
      if (url.pathname.endsWith("/pindicaMeta.jsp")) {
        expect(url.searchParams.get("varcd")).toBe("0007976");
        return jsonResponse(META);
      }
      expect(url.pathname).toBe("/ine/json_indicador/pindica.jsp");
      expect(url.searchParams.get("op")).toBe("2");
      expect(url.searchParams.get("Dim3")).toBe("T");
      return jsonResponse(DATA);
    });

    const collected = sourceBody(await collectIneIndicator(
      { indicator: "0007976", lang: "pt", dims: "Dim3=T" },
      undefined,
      "https://www.ine.pt",
      fetcher,
    ));

    expect(collected).toMatchObject({
      provenance: {
        sourceUrl:
          "https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=0007976&lang=PT&Dim3=T",
        sourcePublishedAt: "2026-08-31T00:00:00.000Z",
      },
      completeness: "complete",
      validator: { etag: '"2026-08-31"' },
    });
    expect(collected.next).toBeUndefined();
    expect(jsonAs(bodyBytes(collected))).toEqual({ meta: META, data: DATA });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("honors a synthetic ETag checkpoint after the metadata request", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("if-none-match")).toBe('"2026-08-31"');
      return jsonResponse(META);
    });

    const fetched = await collectIneIndicator(
      { indicator: "0007976" },
      { etag: '"2026-08-31"' },
      "https://www.ine.pt",
      fetcher,
    );

    expect(fetched).toEqual({ kind: "not-modified", validator: { etag: '"2026-08-31"' } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("validates metadata before accepting a matching checkpoint", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse([
        {
          ...META[0],
          IndicadorCod: "9999999",
        },
      ]),
    );
    await expect(
      collectIneIndicator(
        { indicator: "0007976" },
        { etag: '"2026-08-31"' },
        "https://www.ine.pt",
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("maps an upstream 304 response to not-modified", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 304,
          headers: { ETag: '"provider-etag"' },
        }),
    );
    const fetched = await collectIneIndicator(
      { indicator: "0007976" },
      { etag: '"provider-etag"' },
      "https://www.ine.pt",
      fetcher,
    );
    expect(fetched).toEqual({ kind: "not-modified", validator: { etag: '"provider-etag"' } });
  });

  it("rejects a response declared above the 8 MiB cap", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("[]", {
          headers: { "Content-Length": String(INE_MAX_BYTES + 1) },
        }),
    );
    await expect(
      collectIneIndicator(
        { indicator: "0007976" },
        undefined,
        "https://www.ine.pt",
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("rejects a successful data response that omits Dados", async () => {
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(META)
        : jsonResponse([
            {
              IndicadorCod: "0007976",
              DataUltimoAtualizacao: "2026-08-31",
            },
          ]);
    });
    await expect(
      collectIneIndicator(
        { indicator: "0007976" },
        undefined,
        "https://www.ine.pt",
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("collects one annual history slice with its range, next cursor, and a transform-compatible document", async () => {
    expect(INE_FEEDS.indicator.history).toEqual({});
    const periods = annualPeriods(2010, 2023);
    const meta = historyMeta("Anual", periods);
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/pindicaMeta.jsp")) return jsonResponse(meta);
      expect(url.searchParams.get("Dim3")).toBe("T");
      const codes = url.searchParams.get("Dim1")?.split(",") ?? [];
      expect(codes).toEqual(annualPeriods(2014, 2023).reverse().map(({ code }) => code));
      return jsonResponse(historyData(periods, codes));
    });

    const slice = sourceBody(await collectIneIndicatorHistory(
      {
        indicator: "0007976",
        dims: "Dim1=S7A2023&Dim3=T",
      },
      { before: "2024-01-01T00:00:00.000Z" },
      "https://www.ine.pt",
      fetcher,
    ));

    expect(slice).toMatchObject({
      completeness: "complete",
      next: { before: "2014-01-01T00:00:00.000Z" },
    });
    expect(slice.exhausted).toBeUndefined();
    expect(slice.provenance.sourceUrl).toContain(
      "Dim1=S7A2023%2CS7A2022%2CS7A2021",
    );
    const bytes = bodyBytes(slice);
    expect(bytes.byteLength).toBeLessThan(INE_HISTORY_MAX_BYTES);
    const document = jsonAs<{
      meta: JsonValue[];
      data: Array<{ Dados: JsonObject }>;
    }>(bytes);
    expect(document.meta).toEqual(meta);
    expect(Object.keys(document.data[0]?.Dados ?? {})).toHaveLength(10);

    const transformed = transformIneIndicator(bytes, transformContext());
    expect(transformed.quality).toMatchObject({
      acceptedRecords: 10,
      rejectedRecords: 0,
    });
    expect(transformed.products[0]?.points).toHaveLength(10);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("accepts a single historical period larger than 2 MiB within the live source budget", async () => {
    const periods = annualPeriods(2023, 2023);
    const meta = historyMeta("Anual", periods);
    const data = [{ ...DATA[0], sourceNotes: "x".repeat(3 * 1024 * 1024), Dados: { "2023": [{ geocod: "PT", geodsg: "Portugal", valor: "1" }] } }];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => new URL(input.toString()).pathname.endsWith("/pindicaMeta.jsp") ? jsonResponse(meta) : jsonResponse(data));
    const fetched = sourceBody(await collectIneIndicatorHistory({ indicator: "0007976" }, { before: "2024-01-01T00:00:00Z" }, "https://www.ine.pt", fetcher));
    expect(bodyBytes(fetched).byteLength).toBeGreaterThan(2 * 1024 * 1024);
    expect(bodyBytes(fetched).byteLength).toBeLessThan(INE_HISTORY_MAX_BYTES);
    expect(fetched.exhausted).toBe(true);
  });

  it("reduces the annual period maximum for a wide indicator", async () => {
    const periods = annualPeriods(2010, 2023);
    // 344 geographies × 7 crime categories mirrors indicator 0008074: one
    // period is already 2,408 points, so ten periods would exceed the target.
    const meta = historyMeta("Anual", periods, [344, 7]);
    let requestedCodes: string[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/pindicaMeta.jsp")) return jsonResponse(meta);
      requestedCodes = url.searchParams.get("Dim1")?.split(",") ?? [];
      return jsonResponse(historyData(periods, requestedCodes));
    });

    const slice = sourceBody(await collectIneIndicatorHistory(
      { indicator: "0007976" },
      { before: "2024-01-01T00:00:00Z" },
      "https://www.ine.pt",
      fetcher,
    ));

    expect(requestedCodes).toEqual(["S7A2023"]);
    expect(slice.next).toEqual({ before: "2023-01-01T00:00:00.000Z" });
  });

  it("reports exhaustion after the metadata proves the exclusive cursor is at the oldest period", async () => {
    const periods = annualPeriods(2010, 2023);
    const fetcher = vi.fn(async () =>
      jsonResponse(historyMeta("Anual", periods)),
    );

    const fetched = await collectIneIndicatorHistory(
      { indicator: "0007976" },
      { before: "2010-01-01T00:00:00.000Z" },
      "https://www.ine.pt",
      fetcher,
    );

    expect(fetched).toEqual({ kind: "exhausted" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("uses UTC-exclusive monthly slices across a year boundary", async () => {
    const periods = monthlyPeriods("2023-11", 16);
    const meta = historyMeta("Mensal", periods);
    let requestedCodes: string[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/pindicaMeta.jsp")) return jsonResponse(meta);
      requestedCodes = url.searchParams.get("Dim1")?.split(",") ?? [];
      return jsonResponse(historyData(periods, requestedCodes));
    });

    const slice = sourceBody(await collectIneIndicatorHistory(
      { indicator: "0007976" },
      // This offset instant is exactly 2025-01-01T00:00:00Z, so January is excluded.
      { before: "2025-01-01T01:00:00+01:00" },
      "https://www.ine.pt",
      fetcher,
    ));

    expect(requestedCodes).toHaveLength(12);
    expect(requestedCodes.at(0)).toBe("S3A202412");
    expect(requestedCodes.at(-1)).toBe("S3A202401");
    expect(slice.next).toEqual({ before: "2024-01-01T00:00:00.000Z" });
  });

  it("maps history throttling and server failures to retryable upstream errors", async () => {
    const throttled = vi.fn(
      async () => new Response("slow down", { status: 429, headers: { "Retry-After": "60" } }),
    );
    await expect(
      collectIneIndicatorHistory(
        { indicator: "0007976" },
        { before: "2024-01-01T00:00:00Z" },
        "https://www.ine.pt",
        throttled,
      ),
    ).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: 60,
      message: "INE metadata endpoint returned HTTP 429",
    });

    let calls = 0;
    const unavailable = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse(historyMeta("Anual", annualPeriods(2010, 2023)))
        : new Response("unavailable", { status: 503 });
    });
    await expect(
      collectIneIndicatorHistory(
        { indicator: "0007976" },
        { before: "2024-01-01T00:00:00Z" },
        "https://www.ine.pt",
        unavailable,
      ),
    ).rejects.toMatchObject({ code: "upstream-error" });
  });

  it("maps HTTP and JSON provider failures to retryable upstream errors", async () => {
    const httpFailure = vi.fn(
      async () => new Response("temporary failure", { status: 500 }),
    );
    await expect(
      collectIneIndicator(
        { indicator: "0007976" },
        undefined,
        "https://www.ine.pt",
        httpFailure,
      ),
    ).rejects.toMatchObject({ code: "upstream-error" });

    const jsonFailure = vi.fn(async () =>
      jsonResponse([
        {
          Sucesso: {
            Falso: [{ Msg: "Temporary provider failure" }],
          },
        },
      ]),
    );
    await expect(
      collectIneIndicator(
        { indicator: "0007976" },
        undefined,
        "https://www.ine.pt",
        jsonFailure,
      ),
    ).rejects.toMatchObject({ code: "upstream-error" });
  });
});

it("explicitly declares exhaustion when the final INE metadata-backed slice has data", async () => {
  const periods = annualPeriods(2010, 2013);
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(input.toString());
    return jsonResponse(url.pathname.endsWith("/pindicaMeta.jsp") ? historyMeta("Anual", periods) : historyData(periods, url.searchParams.get("Dim1")?.split(",") ?? []));
  };
  const slice = sourceBody(await collectIneIndicatorHistory({ indicator: "0007976" }, { before: "2014-01-01T00:00:00.000Z" }, "https://www.ine.pt", fetcher));
  expect(slice.next).toBeUndefined();
  expect(slice.exhausted).toBe(true);
});
