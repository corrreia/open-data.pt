import { jsonAs, readFixtureBytes } from "#/tests/support";
import { describe, expect, it } from "vitest";
import type { JsonObject, TransformContext } from "@open-data-pt/contract";
import { transformIneIndicator } from "#/publishers/ine/ine/transform";

function fixture(name: string): Uint8Array {
  return readFixtureBytes(new URL(`./fixtures/${name}`, import.meta.url));
}

function context(indicator: string, slug: string): TransformContext {
  return {
    feed: {
      slug,
      title: `INE ${indicator}`,
      description: "test feed",
      config: { indicator, lang: "PT" },
      semantics: {
        domainSubject: "observation",
        defaultProductRole: "reference",
      },
    },
    observedAt: "2026-09-07T17:43:18Z",
  };
}

describe("INE transformers", () => {
  it("creates one time-series product from an annual indicator", () => {
    const result = transformIneIndicator(fixture("population-0004167.json"), context("0004167", "ine-resident-population"));

    expect(result.transformer).toEqual({ id: "ine-indicator", version: "3" });
    expect(result.quality).toEqual({
      acceptedRecords: 3,
      rejectedRecords: 0,
    });
    // Every value is published once: no record product repeats the points.
    expect(result.products.map(({ slug, role, kind }) => ({ slug, role, kind }))).toEqual([{ slug: "ine-resident-population-series", role: "time-series", kind: "series" }]);

    const series = result.products[0];
    expect(series).toMatchObject({
      updateMode: "authoritative-snapshot",
      watermark: "2025-01-01T00:00:00.000Z",
    });
    expect(series?.schema.fields.find(({ id }) => id === "value")?.unit).toBe("Número (N.º)");

    expect(series?.points?.[0]).toEqual({
      seriesKey: "01:1:1",
      eventTime: "2025-01-01T00:00:00.000Z",
      value: 46425,
      unit: "Número (N.º)",
      dimensions: {
        geography: "Aveiro",
        dim_3: "H",
        dim_4: "0 - 14 anos",
      },
    });
  });

  it.each([
    {
      fixture: "crime-rate-0008074.json",
      indicator: "0008074",
      slug: "ine-crime-rate",
      unit: "Permilagem (‰)",
      firstEventTime: "2020-01-01T00:00:00.000Z",
      lastEventTime: "2022-01-01T00:00:00.000Z",
      dimensions: ["dim_3", "dim_3_t"],
    },
    {
      fixture: "home-prices-0012255.json",
      indicator: "0012255",
      slug: "ine-median-home-sale-price",
      unit: "Euro/ Metro quadrado (€/ m²)",
      firstEventTime: "2023-01-01T00:00:00.000Z",
      lastEventTime: "2025-01-01T00:00:00.000Z",
      dimensions: ["dim_3", "dim_3_t"],
    },
    {
      fixture: "live-births-0012094.json",
      indicator: "0012094",
      slug: "ine-live-births",
      unit: "Número (N.º)",
      firstEventTime: "2026-01-01T00:00:00.000Z",
      lastEventTime: "2026-06-01T00:00:00.000Z",
      dimensions: ["dim_3", "dim_3_t"],
    },
    {
      fixture: "employment-rate-0007971.json",
      indicator: "0007971",
      slug: "ine-employment-rate",
      unit: "Percentagem (%)",
      firstEventTime: "2026-02-01T00:00:00.000Z",
      lastEventTime: "2026-07-01T00:00:00.000Z",
      dimensions: ["dim_3", "dim_3_t"],
    },
    {
      fixture: "earnings-0012656.json",
      indicator: "0012656",
      slug: "ine-average-monthly-earnings",
      unit: "Euro (€)",
      firstEventTime: "2022-01-01T00:00:00.000Z",
      lastEventTime: "2024-01-01T00:00:00.000Z",
      dimensions: [],
    },
  ])("transforms curated live indicator $indicator into typed values and history", ({ fixture: fixtureName, indicator, slug, unit, firstEventTime, lastEventTime, dimensions }) => {
    const result = transformIneIndicator(fixture(fixtureName), context(indicator, slug));
    expect(result.products).toHaveLength(1);
    const series = result.products[0];

    expect(result.quality.acceptedRecords).toBeGreaterThan(0);
    expect(result.quality.rejectedRecords).toBe(0);
    expect(series?.schema.fields).toEqual(expect.arrayContaining([expect.objectContaining({ id: "value", type: "number", unit })]));
    expect(series?.points?.[0]).toMatchObject({ eventTime: firstEventTime });
    for (const id of dimensions.filter((key) => !key.endsWith("_t"))) {
      expect(series?.points?.every((point) => id in point.dimensions)).toBe(true);
    }
    expect(series).toMatchObject({
      role: "time-series",
      watermark: lastEventTime,
    });
    expect(series?.points?.at(-1)).toMatchObject({
      eventTime: lastEventTime,
      value: expect.any(Number),
      unit,
      dimensions: expect.any(Object),
    });
    expect(new Set(series?.points?.map((point) => point.eventTime)).size).toBeGreaterThan(1);
  });

  it("titles products with the measure and keeps the full designation in the description", () => {
    const annual = transformIneIndicator(fixture("population-0004167.json"), context("0004167", "ine-resident-population"));

    expect(annual.products.map(({ title }) => title)).toEqual(["População residente (N.º)"]);
    expect(annual.products[0]?.description).toBe(
      "População residente (N.º) por Local de residência, Sexo e Grupo etário (Por ciclos de vida); Anual - INE, Estimativas anuais da população residente. Measurements grouped into a series for each geography and dimension combination.",
    );

    const monthly = transformIneIndicator(fixture("unemployment-0007976.json"), context("0007976", "ine-unemployment-rate"));

    // The breakdown ("por Grupo etário") goes, the measure and its cohort stay.
    expect(monthly.products[0]?.title).toBe("Taxa de desemprego (%) da população ativa com idade entre 16 e 74 anos");
    expect(monthly.products[0]?.description).toContain("Mensal - INE, Estatísticas Mensais de Emprego e Desemprego");
  });

  it("keeps a short designation whole, breakdown and all", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        meta: [
          {
            IndicadorCod: "0000002",
            UnidadeMedida: "Euro (€)",
            Dimensoes: { Descricao_Dim: [], Categoria_Dim: [] },
          },
        ],
        data: [
          {
            IndicadorCod: "0000002",
            IndicadorDsg: "Produto interno bruto por habitante (€); Anual - INE, Contas nacionais",
            Dados: { "2024": [{ geocod: "PT", geodsg: "Portugal", valor: "1" }] },
          },
        ],
      }),
    );

    const result = transformIneIndicator(bytes, context("0000002", "ine-gdp-per-capita"));

    expect(result.products[0]?.title).toBe("Produto interno bruto por habitante (€)");
  });

  it("uses metadata to normalize INE's localized monthly period labels", () => {
    const result = transformIneIndicator(fixture("unemployment-0007976.json"), context("0007976", "ine-unemployment-rate"));

    expect(result.products[0]?.points?.[2]).toMatchObject({
      seriesKey: "PT:T",
      eventTime: "2026-07-01T00:00:00.000Z",
      value: 5.4,
      unit: "Percentagem (%)",
      dimensions: { geography: "Portugal", dim_3: "Total" },
    });
  });

  it("normalizes compact and separated month keys without metadata categories", () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({
        meta: [
          {
            IndicadorCod: "0000001",
            UnidadeMedida: "unit",
            Dimensoes: { Descricao_Dim: [], Categoria_Dim: [] },
          },
        ],
        data: [
          {
            IndicadorCod: "0000001",
            Dados: {
              "2023-03": [{ geocod: "PT", geodsg: "Portugal", valor: "1" }],
              "202304": [{ geocod: "PT", geodsg: "Portugal", valor: "2" }],
            },
          },
        ],
      }),
    );
    const result = transformIneIndicator(bytes, context("0000001", "ine-months"));
    expect(result.products[0]?.points?.map(({ eventTime }) => eventTime)).toEqual(["2023-03-01T00:00:00.000Z", "2023-04-01T00:00:00.000Z"]);
  });

  it("rejects rows with missing dimension codes or duplicate identities", () => {
    const source = jsonAs<{
      data: Array<{
        Dados: Record<string, Array<JsonObject>>;
      }>;
    }>(fixture("unemployment-0007976.json"));
    const rows = source.data[0]?.Dados["Julho de 2026"];
    if (!rows?.[0]) throw new Error("Fixture did not contain the expected row");
    rows.push({ ...rows[0], dim_3: "" }, { ...rows[0] });

    const result = transformIneIndicator(new TextEncoder().encode(JSON.stringify(source)), context("0007976", "ine-unemployment-rate"));
    expect(result.quality.acceptedRecords).toBe(3);
    expect(result.quality.rejectedRecords).toBe(2);
  });

  it("rejects artifacts for a different indicator", () => {
    expect(() => transformIneIndicator(fixture("population-0004167.json"), context("0007976", "wrong-indicator"))).toThrow("did not match");
  });
});
