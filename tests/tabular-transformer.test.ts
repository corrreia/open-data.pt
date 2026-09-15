import { describe, expect, it } from "vitest";
import { TabularTransformer } from "../packages/gatekeeper-shared/src/formats/udata/transform/tabular";
import type {
  CanonicalRecord,
  CanonicalSchema,
  SeriesPoint,
  StreamingSummary,
  StreamingTransform,
  TransformContext,
} from "@open-data-pt/gatekeeper-shared";

const feed: TransformContext["feed"] = {
  id: "feed_csv",
  slug: "municipal-accessibility-feed",
  title: "Municipal accessibility",
  description: "test feed",
  config: {
    feed: "distribution",
    format: "csv",
    productSlug: "municipal-accessibility",
    productTitle: "Municipal accessibility",
    keyField: "municipality",
  },
  semantics: {
    boundedness: "bounded",
    changeSemantics: "full-snapshot",
    cadence: "periodic",
    domainSubject: "reference",
    defaultProductRole: "reference",
    completeness: "complete",
    ordering: "none",
  },
};

function context(config: TransformContext["feed"]["config"] = feed.config): TransformContext {
  return { feed: { ...feed, config }, observedAt: "2026-09-07T00:00:00Z" };
}

function byteStream(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

function textStream(text: string, chunkSize = 64 * 1024): ReadableStream<Uint8Array> {
  return byteStream(new TextEncoder().encode(text), chunkSize);
}

/** Everything a streaming transform produced, grouped by product. */
interface Drained {
  transform: StreamingTransform;
  records: CanonicalRecord[];
  points: SeriesPoint[];
  summary: StreamingSummary;
}

async function drain(transform: StreamingTransform): Promise<Drained> {
  const records: CanonicalRecord[] = [];
  const points: SeriesPoint[] = [];
  for await (const row of transform.rows) {
    if (row.record) records.push(row.record);
    if (row.point) points.push(row.point);
  }
  return { transform, records, points, summary: transform.finish() };
}

function finalSchema(drained: Drained, productKey = "records"): CanonicalSchema | undefined {
  return drained.summary.products?.find((product) => product.productKey === productKey)?.schema;
}

describe("Tabular transformer", () => {
  it("publishes typed records with stable source keys, one byte at a time", async () => {
    const drained = await drain(await new TabularTransformer().transform(
      textStream("municipality,score,pages,active\nAmadora,7.8,248,true\nPorto,,100,false\n", 1),
      context(),
    ));

    expect(drained.transform.products[0]).toMatchObject({
      slug: "municipal-accessibility",
      role: "reference",
      updateMode: "authoritative-snapshot",
    });
    expect(drained.records).toEqual([
      {
        entityKey: "Amadora",
        payload: {
          municipality: "Amadora",
          score: 7.8,
          pages: 248,
          active: true,
        },
      },
      {
        entityKey: "Porto",
        payload: {
          municipality: "Porto",
          score: null,
          pages: 100,
          active: false,
        },
      },
    ]);
    expect(drained.summary.quality).toEqual({ acceptedRecords: 2, rejectedRecords: 0 });
    expect(finalSchema(drained)).toEqual(drained.transform.products[0]?.schema);
  });

  it("detects a preamble, semicolons, decimal commas, Portuguese dates, and x/y coordinates", async () => {
    const drained = await drain(await new TabularTransformer().transform(
      textStream('Relatório;;;;\nNome;Valor;Data;X;Y\nA;"1.234,56";31/12/2025;-9,14;38,72\nB;"2.000,00";01/01/2026;-8,61;41,15\n', 3),
      context({ feed: "distribution", format: "csv", productSlug: "sample" }),
    ));

    expect(drained.transform.products[0]?.schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Valor", type: "number" }),
        expect.objectContaining({ name: "Data", type: "date" }),
        expect.objectContaining({ name: "X", type: "longitude" }),
        expect.objectContaining({ name: "Y", type: "latitude" }),
      ]),
    );
    expect(drained.records[0]).toMatchObject({
      entityKey: expect.stringMatching(/^row-/),
      eventTime: "2025-12-31T00:00:00.000Z",
      payload: { Valor: 1234.56, Data: "2025-12-31", X: -9.14, Y: 38.72 },
    });
  });

  it("streams past the profiled sample with no row cap and reports the final schema at the end", async () => {
    const lines = ["id,kind,amount,note"];
    for (let index = 0; index < 51_000; index += 1) {
      const id = index === 7_000 ? "1" : String(index);
      const kind = index < 5_000 ? `k${index % 5}` : `k${index}`;
      const amount = index === 6_000 ? "n/a" : String(index);
      lines.push(`${id},${kind},${amount},${index < 5_000 ? "x" : ""}`);
    }
    const drained = await drain(await new TabularTransformer().transform(
      textStream(`${lines.join("\n")}\n`),
      context({ feed: "distribution", format: "csv", productSlug: "large" }),
    ));

    expect(drained.records).toHaveLength(51_000);
    expect(drained.summary.quality.acceptedRecords).toBe(51_000);
    const declared = drained.transform.products[0]?.schema.fields;
    expect(declared).toEqual([
      expect.objectContaining({ name: "id", type: "identifier", nullable: false }),
      expect.objectContaining({ name: "kind", type: "category", nullable: false }),
      expect.objectContaining({ name: "amount", type: "number", nullable: false }),
      expect.objectContaining({ name: "note", type: "category", nullable: false }),
    ]);
    expect(finalSchema(drained)?.fields).toEqual([
      expect.objectContaining({ name: "id", type: "identifier", nullable: false }),
      expect.objectContaining({ name: "kind", type: "string", nullable: false }),
      expect.objectContaining({ name: "amount", type: "number", nullable: true }),
      expect.objectContaining({ name: "note", type: "category", nullable: true }),
    ]);
    expect(drained.records[6_000]?.payload.amount).toBeNull();
    expect(drained.records[5_001]?.entityKey).toBe("5001");
    expect(drained.records[7_000]?.entityKey).toMatch(/^row-/);
    // 51,000 CSV rows: near the 5 s default when the whole suite shares the CPU.
  }, 30_000);

  it("streams GeoJSON features one element at a time", async () => {
    const document = {
      type: "FeatureCollection",
      name: "stations",
      features: [
        { type: "Feature", id: 1, properties: { nome: "Lisboa", tipo: "A" }, geometry: { type: "Point", coordinates: [-9.14, 38.72] } },
        { type: "Feature", id: 2, properties: { nome: "Porto", tipo: "B" }, geometry: { type: "Point", coordinates: [-8.61, 41.15] } },
      ],
    };
    const drained = await drain(await new TabularTransformer().transform(
      textStream(JSON.stringify(document), 1),
      context({ feed: "distribution", format: "geojson", productSlug: "stations" }),
    ));
    expect(drained.records[1]?.payload).toMatchObject({ nome: "Porto", featureId: 2, longitude: -8.61, latitude: 41.15, geometry: { type: "Point" } });
  });

  it("streams nested and top-level JSON arrays, and buffers a single object", async () => {
    const run = async (text: string) => drain(await new TabularTransformer().transform(
      textStream(text, 5),
      context({ feed: "distribution", format: "json", productSlug: "items" }),
    ));
    const nested = await run('{"meta":{"page":1},"results":[{"code":"A","value":"1"},{"code":"B","value":"2"},{"code":"C","late":{"a":1}}]}');
    expect(nested.records.map((record) => record.payload)).toEqual([
      { code: "A", value: 1, late: null },
      { code: "B", value: 2, late: null },
      { code: "C", value: null, late: { a: 1 } },
    ]);
    const top = await run('[{"code":"A"},7,{"code":"B"}]');
    expect(top.records.map((record) => record.entityKey)).toEqual(["A", "B"]);
    const rows = Array.from({ length: 5_001 }, (_, index) => (index === 5_000 ? { code: `c${index}`, extra: { note: "late" } } : { code: `c${index}` }));
    const late = await run(JSON.stringify({ items: rows }));
    expect(late.records).toHaveLength(5_001);
    expect(late.records[0]?.payload).toEqual({ code: "c0" });
    expect(late.records[5_000]?.payload).toEqual({ code: "c5000", extra: { note: "late" } });
    expect(finalSchema(late)?.fields).toEqual([
      expect.objectContaining({ name: "code", type: "identifier" }),
      expect.objectContaining({ name: "extra", type: "json", nullable: true }),
    ]);
    const single = await run('{"code":"A","value":"3"}');
    expect(single.records).toEqual([{ entityKey: "A", payload: { code: "A", value: 3 } }]);
  });
});
