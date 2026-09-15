import { jsonAs } from "./support";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  CanonicalRecord,
  JsonObject,
  JsonValue,
  ProductDeclaration,
  SeriesPoint,
  TransformContext,
  TransformQuality,
} from "@open-data-pt/gatekeeper-shared";
import { OpendatasoftTransformer, SAMPLE_ROWS } from "../packages/gatekeeper-shared/src/formats/opendatasoft/transform";

const transformer = new OpendatasoftTransformer();

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/opendatasoft/${name}`, import.meta.url)));
}

function context(slug: string, series?: string): TransformContext {
  const config: TransformContext["feed"]["config"] = { host: "e-redes.opendatasoft.com", dataset: slug };
  if (series) config.series = series;
  return {
    feed: {
      id: `feed_${slug}`,
      slug,
      title: slug,
      description: "test feed",
      config,
      semantics: {
        boundedness: "bounded",
        changeSemantics: "full-snapshot",
        cadence: "periodic",
        domainSubject: "observation",
        defaultProductRole: "current-state",
        completeness: "complete",
        ordering: "none",
      },
    },
    observedAt: "2026-09-07T17:45:00Z",
    sourcePublishedAt: "2026-09-07T17:00:00Z",
  };
}

function bytes(value: JsonValue | undefined): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function chunked(value: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= value.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(value.slice(offset, offset + size));
      offset += size;
    },
  });
}

/** A product as declared, with its final schema and watermark applied and every row it received. */
interface TransformedProduct extends ProductDeclaration {
  records: CanonicalRecord[];
  points: SeriesPoint[];
}

interface Transformed {
  declared: ProductDeclaration[];
  products: TransformedProduct[];
  quality: TransformQuality;
}

async function transform(document: Uint8Array, slug: string, chunkSize = 97, series?: string): Promise<Transformed> {
  const result = await transformer.transform(chunked(document, chunkSize), context(slug, series));
  const declared = structuredClone(result.products);
  const products: TransformedProduct[] = result.products.map((product) => ({ ...structuredClone(product), records: [], points: [] }));
  const byKey = new Map(products.map((product) => [product.productKey, product]));
  for await (const row of result.rows) {
    const product = byKey.get(row.productKey);
    if (!product) throw new Error(`Row for undeclared product ${row.productKey}`);
    if (row.record !== undefined) product.records.push(row.record);
    else product.points.push(row.point);
  }
  const summary = result.finish();
  for (const finalization of summary.products ?? []) {
    const product = byKey.get(finalization.productKey);
    if (!product) throw new Error(`Finalization for undeclared product ${finalization.productKey}`);
    if (finalization.schema) product.schema = finalization.schema;
    if (finalization.watermark) product.watermark = finalization.watermark;
  }
  return { declared, products, quality: summary.quality };
}

describe("Opendatasoft transformers", () => {
  it("maps a live E-REDES geospatial fixture to typed current records", async () => {
    const result = await transform(
      fixture("e-redes-secondary-substations.json"),
      "e-redes-secondary-substations",
    );
    const product = result.products[0];

    expect({ id: transformer.id, version: transformer.version }).toEqual({
      id: "opendatasoft-explore-v2.1",
      version: "5",
    });
    expect(product).toMatchObject({
      slug: "e-redes-secondary-substations",
      role: "current-state",
      updateMode: "authoritative-snapshot",
    });
    expect(product?.schema.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "coordenadas_geo_latitude", type: "latitude" }),
      expect.objectContaining({ id: "coordenadas_geo_longitude", type: "longitude" }),
      expect.objectContaining({ id: "potencia_transformacao_kva", type: "number" }),
      expect.objectContaining({ id: "nivel_utilizacao", type: "category" }),
    ]));
    expect(product?.records[0]).toMatchObject({
      entityKey: expect.stringMatching(/^row-[0-9a-f]{16}$/),
      payload: {
        coordenadas_geo_latitude: 37.087648290720594,
        coordenadas_geo_longitude: -8.248545818839204,
        potencia_transformacao_kva: 400,
      },
    });
  });

  it("produces the same rows and final schemas whatever the chunk boundaries", async () => {
    const whole = await transform(fixture("sns-newborn-screening.json"), "sns-newborn-screening", 1 << 20);
    const single = await transform(fixture("sns-newborn-screening.json"), "sns-newborn-screening", 1);
    expect(single).toEqual(whole);
  });

  it.each([
    {
      fixture: "sns-hospital-emergency-attendances.json",
      slug: "sns-hospital-emergency-attendances-feed",
      fields: [
        ["tempo", "date"],
        ["localizacao_geografica_latitude", "latitude"],
        ["localizacao_geografica_longitude", "longitude"],
        ["total_urgencias", "number"],
      ],
      eventTime: "2026-06-01T00:00:00.000Z",
    },
    {
      fixture: "sns-surgery-waiting-target.json",
      slug: "sns-surgery-waiting-target-feed",
      fields: [
        ["tempo", "date"],
        ["localizacao_geografica_latitude", "latitude"],
        ["localizacao_geografica_longitude", "longitude"],
        ["de_inscritos_em_lic_dentro_do_tmrg", "number"],
      ],
      eventTime: "2026-06-01T00:00:00.000Z",
    },
    {
      fixture: "sns-primary-care-consultation-access.json",
      slug: "sns-primary-care-consultation-access-feed",
      fields: [
        ["tempo", "date"],
        ["localizacao_geografica_latitude", "latitude"],
        ["localizacao_geografica_longitude", "longitude"],
        ["taxa_de_utilizacao_global_de_consultas_medicas_1_ano", "number"],
      ],
      eventTime: "2026-07-01T00:00:00.000Z",
    },
    {
      fixture: "sns-flu-vaccination-coverage.json",
      slug: "sns-seasonal-flu-vaccination-coverage-feed",
      fields: [
        ["epoca_sazonal", "date"],
        ["ponto_ou_localizacao_geografica_latitude", "latitude"],
        ["ponto_ou_localizacao_geografica_longitude", "longitude"],
      ],
      eventTime: "2022-01-01T00:00:00.000Z",
    },
    {
      fixture: "sns-dispensed-medicines.json",
      slug: "sns-dispensed-medicines-feed",
      fields: [
        ["tempo", "date"],
        ["regiao_de_saude", "category"],
        ["valor_comparticipado_pelo_sns", "number"],
      ],
      eventTime: "2026-06-01T00:00:00.000Z",
    },
    {
      fixture: "e-redes-ev-charging-connections.json",
      slug: "e-redes-ev-charging-connections-feed",
      fields: [
        ["trimestre", "date"],
        ["concelho", "category"],
        ["potencia_maxima_admissivel", "number"],
      ],
      eventTime: "2026-04-01T00:00:00.000Z",
    },
    {
      fixture: "e-redes-scheduled-interruptions.json",
      slug: "e-redes-scheduled-interruptions-feed",
      fields: [
        ["startdatetime", "datetime"],
        ["enddatetime", "datetime"],
        ["updatedatetime", "date"],
        ["interrupcao_programada", "number"],
      ],
      eventTime: "2026-09-08T05:00:00.000Z",
    },
    {
      fixture: "e-redes-self-consumption-installations.json",
      slug: "e-redes-self-consumption-installations-feed",
      fields: [
        ["data", "date"],
        ["tipo_de_tecnologia", "string"],
        ["numero_de_instalacoes", "number"],
        ["potencia_instalada_upac_kw", "number"],
      ],
      eventTime: "2026-07-01T00:00:00.000Z",
    },
  ])("transforms curated live sample $fixture into one typed table, guessing no series", async ({ fixture: fixtureName, slug, fields, eventTime }) => {
    const result = await transform(fixture(fixtureName), slug);
    const current = result.products[0];
    const typed = new Map(current?.schema.fields.map((field) => [field.id, field.type]));
    for (const [field, type] of fields) expect(typed.get(field)).toBe(type);
    expect(current?.records).toHaveLength(3);
    expect(current?.records[0]?.eventTime).toBe(eventTime);
    expect(result.products).toHaveLength(1);
    expect(result.products.some((product) => product.role === "time-series")).toBe(false);
  });

  it("publishes a live SNS fixture once: as its table, or as the series an example names", async () => {
    const table = await transform(fixture("sns-newborn-screening.json"), "sns-newborn-screening");
    expect(table.products).toHaveLength(1);
    expect(table.products[0]?.title).toBe("Programa Nacional de Diagnóstico Precoce");
    expect(table.products[0]?.description).not.toContain("<p>");
    expect(table.products[0]?.schema.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "tempo", type: "date" }),
      expect.objectContaining({ id: "entidade", type: "category" }),
      expect.objectContaining({ id: "casos_detetados", type: "number" }),
    ]));
    expect(table.products[0]?.records[0]).toMatchObject({
      eventTime: "2011-01-01T00:00:00.000Z",
      payload: { tempo: "2011-01-01", casos_detetados: 75 },
    });

    const result = await transform(fixture("sns-newborn-screening.json"), "sns-newborn-screening", 97, "casos_detetados");
    expect(result.products).toHaveLength(1);
    const cases = result.products[0];
    // A single series is the feed's own product, under the feed's slug and title.
    expect(cases).toMatchObject({
      slug: "sns-newborn-screening",
      title: "Programa Nacional de Diagnóstico Precoce",
      role: "time-series",
      updateMode: "delta",
      watermark: "2013-01-01T00:00:00.000Z",
    });
    expect(cases?.records).toEqual([]);
    expect(cases?.points[0]).toEqual({
      seriesKey: "entidade=Instituto Nacional de Saúde Doutor Ricardo Jorge, IP",
      eventTime: "2011-01-01T00:00:00.000Z",
      value: 75,
      unit: "value",
      dimensions: {
        entidade: "Instituto Nacional de Saúde Doutor Ricardo Jorge, IP",
      },
    });
  });

  it("uses annotated identifiers and otherwise hashes sorted row content deterministically", async () => {
    const document = jsonAs<{ dataset: JsonObject; records: Array<JsonObject> }>(
      fixture("sns-newborn-screening.json"),
    );
    const first = document.records[0] ?? {};
    const reversed = Object.fromEntries(Object.entries(first).reverse());
    const one = await transform(
      bytes({ dataset: document.dataset, records: [first] }),
      "stable-one",
    );
    const two = await transform(
      bytes({ dataset: document.dataset, records: [reversed] }),
      "stable-two",
    );
    expect(one.products[0]?.records[0]?.entityKey).toBe(
      two.products[0]?.records[0]?.entityKey,
    );

    const identified = {
      dataset: {
        dataset_id: "identified",
        metas: { default: { title: "Identified", records_count: 1 } },
        fields: [
          { name: "code", type: "text", annotations: { id: true } },
        ],
      },
      records: [{ code: "stable-code" }],
    };
    expect((await transform(bytes(identified), "identified"))
      .products[0]?.records[0]?.entityKey).toBe("stable-code");
  });

  it("types URLs, booleans, colours, geometry, JSON, and badge display hints", async () => {
    const captured = {
      dataset: {
        dataset_id: "typed",
        metas: {
          default: {
            title: "Typed dataset",
            description: "<p>Typed fields.</p>",
            records_count: 1,
          },
        },
        fields: [
          { name: "id", type: "text", annotations: { id: true } },
          { name: "name", type: "text", annotations: {} },
          { name: "color", type: "text", annotations: {} },
          { name: "active", type: "boolean", annotations: {} },
          { name: "document", type: "file", annotations: {} },
          { name: "shape", type: "geo_shape", annotations: {} },
          { name: "details", type: "object", annotations: {} },
        ],
      },
      records: [{
        id: "one",
        name: "Area one",
        color: "#112233",
        active: true,
        document: { url: "https://example.test/document.pdf" },
        "shape": { type: "Feature", geometry: { type: "Point", coordinates: [-9, 38] } },
        details: { source: "live" },
      }],
    };
    const result = await transform(bytes(captured), "typed", 1);
    for (const schema of [result.declared[0]?.schema, result.products[0]?.schema]) {
      const fields = Object.fromEntries(schema?.fields.map((field) => [field.id, field]) ?? []);
      expect(fields.id?.type).toBe("identifier");
      expect(fields.color?.type).toBe("color");
      expect(fields.active?.type).toBe("boolean");
      expect(fields.document?.type).toBe("url");
      expect(fields["shape"]?.type).toBe("geometry");
      expect(fields.details?.type).toBe("json");
      expect(fields.name?.display?.badge).toEqual({ colorField: "color" });
    }
    expect(result.products[0]?.records[0]?.payload).toMatchObject({
      document: "https://example.test/document.pdf",
      "shape": { type: "Point", coordinates: [-9, 38] },
    });
  });

  it("requires the dataset metadata before the records it describes", async () => {
    const records = Array.from({ length: SAMPLE_ROWS + 1 }, (_, index) => ({ id: String(index) }));
    const late = new TextEncoder().encode(`{"records":${JSON.stringify(records)},"dataset":{"dataset_id":"x","fields":[],"metas":{"default":{}}}}`);
    await expect(transform(late, "late")).rejects.toThrow("dataset metadata before its records");
    // A body that ends inside the profiling prefix still reads metadata from anywhere.
    const small = await transform(new TextEncoder().encode('{"records":[{"id":"a"}],"dataset":{"dataset_id":"x","fields":[{"name":"id","type":"text","annotations":{"id":true}}],"metas":{"default":{}}}}'), "small");
    expect(small.products[0]?.records.map((record) => record.entityKey)).toEqual(["a"]);
  });
});

describe("rows beyond the profiling sample", () => {
  const dataset = {
    dataset_id: "big",
    fields: [
      { name: "id", type: "text", annotations: { id: true } },
      { name: "kind", type: "text", annotations: { facet: true } },
      { name: "periodo", type: "text", annotations: {} },
      { name: "total", type: "int", annotations: {} },
    ],
    metas: { default: { title: "Big", records_count: SAMPLE_ROWS + 50 } },
  };
  const records = Array.from({ length: SAMPLE_ROWS + 50 }, (_, index): JsonObject => {
    const row: JsonObject = {
      id: `r${index}`,
      kind: index < SAMPLE_ROWS ? `k${index % 3}` : `late-${index}`,
      periodo: index === SAMPLE_ROWS + 1 ? "not a date" : `20${String(10 + (index % 10))}-01`,
      total: index === SAMPLE_ROWS + 2 ? null : index,
    };
    if (index >= SAMPLE_ROWS + 10) row.extra = "seen late";
    return row;
  });

  it("declares a provisional schema from the sample and finalizes it over every row", async () => {
    const result = await transform(bytes({ dataset, records }), "big", 4_096);
    const declared = new Map(result.declared[0]?.schema.fields.map((field) => [field.id, field]));
    const final = new Map(result.products[0]?.schema.fields.map((field) => [field.id, field]));

    expect(result.products[0]?.records).toHaveLength(SAMPLE_ROWS + 50);
    expect(declared.get("kind")?.type).toBe("category");
    expect(final.get("kind")?.type).toBe("string");
    expect(declared.get("total")?.nullable).toBe(false);
    expect(final.get("total")?.nullable).toBe(true);
    expect(declared.has("extra")).toBe(false);
    expect(final.get("extra")).toMatchObject({ type: "string", nullable: true });
    expect(result.products[0]?.records.at(-1)?.payload.extra).toBe("seen late");

    // The periodo encoding was locked as a date by the sample; the later non-date is null and reported.
    expect(declared.get("periodo")?.type).toBe("date");
    expect(result.products[0]?.records[SAMPLE_ROWS + 1]?.payload.periodo).toBeNull();
    expect(result.products[0]?.watermark).toBe("2019-01-01T00:00:00.000Z");
    expect(result.products).toHaveLength(1);
    expect(result.quality.acceptedRecords).toBe(SAMPLE_ROWS + 50);
  });
});

describe("series dimensions", () => {
  it("does not key series on date-part facets such as dia, mes, ano, time and dia_da_semana", async () => {
    const dataset = {
      dataset_id: "energia",
      fields: [
        { name: "datahora", type: "datetime", annotations: { timeserie_precision: "minute", facet: true } },
        { name: "dia", type: "text", annotations: { facet: true } },
        { name: "mes", type: "text", annotations: { facet: true } },
        { name: "ano", type: "text", annotations: { facet: true } },
        { name: "time", type: "text", annotations: { facet: true } },
        { name: "dia_da_semana", type: "text", annotations: { facet: true } },
        { name: "regiao", type: "text", annotations: { facet: true } },
        { name: "total", type: "double", annotations: {} },
      ],
      metas: { default: { title: "Energia", records_count: 2 } },
    };
    const records = [
      { datahora: "2026-07-01T00:15:00+00:00", dia: "01", mes: "07", ano: "2026", time: "00:15", dia_da_semana: "quarta-feira", regiao: "Norte", total: 10 },
      { datahora: "2026-07-01T00:30:00+00:00", dia: "01", mes: "07", ano: "2026", time: "00:30", dia_da_semana: "quarta-feira", regiao: "Norte", total: 12 },
    ];
    const result = await transform(bytes({ dataset, records }), "energia", 97, "total");
    const series = result.products.find((product) => product.role === "time-series");
    expect(series?.points.map((point) => point.seriesKey)).toEqual(["regiao=Norte", "regiao=Norte"]);
  });

  it("refuses a series list naming a field that is missing or not numeric", async () => {
    const dataset = {
      dataset_id: "energia",
      fields: [
        { name: "datahora", type: "datetime", annotations: { timeserie_precision: "minute" } },
        { name: "regiao", type: "text", annotations: {} },
        { name: "total", type: "double", annotations: {} },
      ],
      metas: { default: { title: "Energia", records_count: 1 } },
    };
    const records = [{ datahora: "2026-07-01T00:15:00+00:00", regiao: "Norte", total: 10 }];
    await expect(transform(bytes({ dataset, records }), "energia", 97, "regiao")).rejects.toThrow("series field regiao is not a numeric field");
    await expect(transform(bytes({ dataset, records }), "energia", 97, "missing")).rejects.toThrow("series field missing is not a numeric field");
  });
});

describe("duplicate timestamps", () => {
  it("keeps one point per series and timestamp and reports the collapsed rows", async () => {
    const dataset = {
      dataset_id: "energia",
      fields: [
        { name: "datahora", type: "datetime", annotations: { timeserie_precision: "minute", facet: true } },
        { name: "total", type: "double", annotations: {} },
      ],
      metas: { default: { title: "Energia", records_count: 3 } },
    };
    const records = [
      { datahora: "2026-08-31T23:00:00+00:00", total: 1399285.5 },
      { datahora: "2026-08-31T23:00:00+00:00", total: 1390264 },
      { datahora: "2026-08-31T22:45:00+00:00", total: 1433735 },
    ];
    const result = await transform(bytes({ dataset, records }), "energia", 97, "total");
    const series = result.products.find((product) => product.role === "time-series");
    expect(series?.points.map((point) => [point.seriesKey, point.eventTime, point.value])).toEqual([
      ["all", "2026-08-31T23:00:00.000Z", 1399285.5],
      ["all", "2026-08-31T22:45:00.000Z", 1433735],
    ]);
  });
});
