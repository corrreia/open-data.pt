import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  CanonicalRecord,
  CanonicalSchema,
  ProductDeclaration,
  SeriesPoint,
  SourceConfig,
  TransformContext,
  TransformQuality,
} from "@open-data-pt/gatekeeper-shared";
import { libraryConfig } from "@open-data-pt/gatekeeper-shared";
import { UDATA_EXAMPLES } from "../packages/gatekeeper-shared/src/formats/udata/examples";
import { chooseTransformer, transformUdata } from "../packages/gatekeeper-shared/src/formats/udata/transform";

const FIXTURE = new Map([
  ["justice-facilities-feed", "justice-facilities.csv"],
  ["portuguese-museums-feed", "museums.csv"],
  ["portuguese-parishes-feed", "parishes.csv"],
  ["public-libraries-2024-feed", "public-libraries-latin1.csv"],
  ["municipal-ev-charging-feed", "ev-charging.csv"],
  ["cadaval-municipal-waste-feed", "cadaval-waste-latin1.csv"],
  ["primary-care-oral-health-referrals-feed", "oral-health-referrals.csv"],
] as const);

function fixture(name: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/udata/${name}`, import.meta.url)));
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

function context(config: SourceConfig, slug: string, title: string, description: string): TransformContext {
  return {
    feed: {
      id: `feed_${slug}`,
      slug,
      title,
      description,
      config,
      semantics: {
        boundedness: "bounded",
        changeSemantics: "full-snapshot",
        cadence: "periodic",
        domainSubject: "reference",
        defaultProductRole: "reference",
        completeness: "complete",
        ordering: "none",
      },
    },
    observedAt: "2026-09-08T10:00:00.000Z",
  };
}

/** One product as the kernel ends up with it: its declaration, its final schema, and its rows. */
interface ProductView extends ProductDeclaration {
  records: CanonicalRecord[];
  points: SeriesPoint[];
}

interface Transformed {
  products: ProductView[];
  quality: TransformQuality;
}

async function transformExample(slug: string, chunkSize = 7): Promise<Transformed> {
  const example = UDATA_EXAMPLES.find((candidate) => candidate.slug === slug);
  const fixtureName = FIXTURE.get(slug);
  if (!example || !fixtureName) throw new Error(`No example fixture for ${slug}`);
  const transform = await transformUdata(
    fixture(fixtureName, chunkSize),
    context(libraryConfig(example.config), example.slug, example.title, example.description),
  );
  const records = new Map<string, CanonicalRecord[]>();
  const points = new Map<string, SeriesPoint[]>();
  for await (const row of transform.rows) {
    if (row.record) records.set(row.productKey, [...(records.get(row.productKey) ?? []), row.record]);
    if (row.point) points.set(row.productKey, [...(points.get(row.productKey) ?? []), row.point]);
  }
  const summary = transform.finish();
  return {
    quality: summary.quality,
    products: transform.products.map((product) => {
      const finalization = summary.products?.find((candidate) => candidate.productKey === product.productKey);
      const schema: CanonicalSchema = finalization?.schema ?? product.schema;
      const view: ProductView = { ...product, schema, records: records.get(product.productKey) ?? [], points: points.get(product.productKey) ?? [] };
      if (finalization?.watermark !== undefined) view.watermark = finalization.watermark;
      return view;
    }),
  };
}

describe("uData curated example transformers", () => {
  it("transforms every new example fixture with a fully typed schema", async () => {
    for (const [slug] of FIXTURE) {
      const example = UDATA_EXAMPLES.find((candidate) => candidate.slug === slug);
      expect(example, slug).toBeDefined();
      expect(chooseTransformer(example!.config).id, slug).not.toBe("");
      const result = await transformExample(slug);
      expect(result.quality.acceptedRecords, slug).toBeGreaterThan(0);
      expect(result.products.length, slug).toBeGreaterThan(0);
      for (const product of result.products) {
        expect(product.schema.fields.length, product.slug).toBeGreaterThan(0);
        expect(product.schema.fields.every((field) => Boolean(field.type)), product.slug).toBe(true);
      }
    }
  });

  it("detects justice map coordinates and categorical facility types", async () => {
    const product = (await transformExample("justice-facilities-feed")).products[0]!;
    expect(product.schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Posicao_Lat", type: "latitude" }),
        expect.objectContaining({ name: "Posicao_Lng", type: "longitude" }),
        expect.objectContaining({ name: "Tipo", type: "category" }),
      ]),
    );
    expect(product.records[0]?.payload).toMatchObject({
      Posicao_Lat: 38.708537,
      Posicao_Lng: -9.136274,
    });
  });

  it("types public URLs and dates in the museum and parish directories", async () => {
    for (const slug of ["portuguese-museums-feed", "portuguese-parishes-feed"]) {
      const result = await transformExample(slug);
      expect(result.products[0]?.schema.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Website ou página web (Source)", type: "url" }),
          expect.objectContaining({ name: "Distrito (Spatial Coverage 3)", type: "category" }),
        ]),
      );
    }
  });

  it("decodes the live Windows-1252 library export and skips its heading rows, one byte at a time", async () => {
    const result = await transformExample("public-libraries-2024-feed", 1);
    expect(result.products[0]?.records[0]?.payload).toMatchObject({
      "MUNICÍPIO": "Abrantes",
      "TOTAL": 33770,
      "ANO": 2024,
    });
  });

  it("publishes monthly health observations once, as records, without a restated series", async () => {
    const result = await transformExample("primary-care-oral-health-referrals-feed");
    expect(result.products.map((product) => product.role)).toEqual(["reference"]);
    expect(result.products[0]?.records[0]).toMatchObject({
      eventTime: "2026-08-01T00:00:00.000Z",
      payload: { "Cheques Emitidos": 359 },
    });
    expect(result.products[0]?.points).toEqual([]);
  });

  it("normalizes the Cadaval decimal-comma workbook into tonne records and monthly points", async () => {
    const example = UDATA_EXAMPLES.find((candidate) => candidate.slug === "cadaval-municipal-waste-feed")!;
    expect(chooseTransformer(libraryConfig(example.config))).toMatchObject({ id: "cadaval-municipal-waste-v1", version: "2" });
    const result = await transformExample("cadaval-municipal-waste-feed", 1);
    expect(result.products[0]?.records[0]?.payload).toMatchObject({
      material: "Plástico / Metal (LER 150102, 150106 e 200139)",
      year: 2024,
      annualTotal: 203.13,
    });
    expect(result.products[1]?.points[0]).toMatchObject({
      eventTime: "2024-01-01T00:00:00.000Z",
      value: 15.51,
      unit: "tonne",
    });
    expect(result.products[0]?.watermark).toBe("2024-12-31T00:00:00.000Z");
  });
});
