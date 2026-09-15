import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  CanonicalField,
  CanonicalRecord,
  JsonObject,
  ProductDeclaration,
  TransformContext,
  TransformQuality,
} from "@open-data-pt/gatekeeper-shared";
import { ArcgisTransformer } from "../packages/gatekeeper-shared/src/formats/arcgis";

const transformer = new ArcgisTransformer();

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/arcgis/${name}`, import.meta.url)));
}

function context(slug: string, title = slug): TransformContext {
  return {
    feed: {
      id: `feed_${slug}`,
      slug,
      title,
      description: "test feed",
      config: {
        host: "services.arcgis.com",
        service: "account/arcgis/rest/services/Layer/FeatureServer",
        layer: "0",
      },
      semantics: {
        boundedness: "bounded",
        changeSemantics: "full-snapshot",
        cadence: "periodic",
        domainSubject: "feature",
        defaultProductRole: "reference",
        completeness: "complete",
        ordering: "none",
        entityKeyField: "GlobalID",
      },
    },
    observedAt: "2026-09-07T17:35:17Z",
    sourcePublishedAt: "2026-09-04T08:12:10.839Z",
  };
}

function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
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

/** Everything one streamed run produced: the declaration, every row, and the finalized schema. */
interface Run {
  product: ProductDeclaration | undefined;
  records: CanonicalRecord[];
  declared: Map<string, CanonicalField>;
  fields: Map<string, CanonicalField>;
  quality: TransformQuality;
}

async function run(bytes: Uint8Array, feed: TransformContext, chunkSize = 97): Promise<Run> {
  const transform = await transformer.transform(chunked(bytes, chunkSize), feed);
  const records: CanonicalRecord[] = [];
  for await (const row of transform.rows) if (row.record) records.push(row.record);
  const summary = transform.finish();
  const product = transform.products[0];
  const schema = summary.products?.find((entry) => entry.productKey === product?.productKey)?.schema ?? product?.schema;
  return {
    product,
    records,
    declared: new Map(product?.schema.fields.map((field) => [field.id, field])),
    fields: new Map(schema?.fields.map((field) => [field.id, field])),
    quality: summary.quality,
  };
}

function typedLayer(features: JsonObject[]): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    type: "FeatureCollection",
    arcgis: {
      layerUrl: "https://services.arcgis.com/a/Layer/FeatureServer/0",
      name: "Typed layer",
      description: "Typed fixture",
      copyrightText: "City",
      geometryType: "esriGeometryPoint",
      objectIdField: "OBJECTID",
      fields: [
        { name: "OBJECTID", alias: "Object ID", type: "esriFieldTypeOID", nullable: false },
        {
          name: "STATUS",
          alias: "Status",
          type: "esriFieldTypeInteger",
          nullable: false,
          domain: {
            type: "codedValue",
            codedValues: [
              { name: "Open", code: 1 },
              { name: "Closed", code: 2 },
            ],
          },
        },
        { name: "UPDATED", alias: "Updated", type: "esriFieldTypeDate", nullable: false },
        { name: "LABEL", alias: "Label", type: "esriFieldTypeString", nullable: false },
        { name: "COLOUR", alias: "Colour", type: "esriFieldTypeString", nullable: false },
        { name: "WEBSITE", alias: "Website", type: "esriFieldTypeString", nullable: false },
      ],
    },
    features,
  }));
}

const siteA = {
  type: "Feature",
  properties: {
    OBJECTID: 10,
    STATUS: 1,
    UPDATED: 1_788_509_530_839,
    LABEL: "Site A",
    COLOUR: "#336699",
    WEBSITE: "https://example.test/site-a",
  },
  geometry: { type: "Point", coordinates: [-9.1, 38.7] },
};

describe("ArcGIS transformers", () => {
  it("turns a live point-layer fixture into a typed reference product", async () => {
    const result = await run(
      fixture("recycling-points.json"),
      context("lisboa-ecoilhas-subterraneas-feed", "Ecoilhas Subterrâneas"),
    );

    expect({ id: transformer.id, version: transformer.version }).toEqual({ id: "arcgis-rest-layer", version: "2" });
    expect(result.product).toMatchObject({
      slug: "lisboa-ecoilhas-subterraneas",
      title: "Ecoilhas Subterrâneas",
      role: "reference",
      updateMode: "authoritative-snapshot",
    });
    expect(result.fields.get("OBJECTID")).toMatchObject({
      name: "Object ID",
      type: "identifier",
    });
    expect(result.fields.get("COD_SIG")?.type).toBe("number");
    expect(result.fields.get("TPRS_DESC")?.type).toBe("category");
    expect(result.fields.get("GlobalID")?.type).toBe("identifier");
    expect(result.fields.get("geometry")?.type).toBe("geometry");
    expect(result.fields.get("latitude")?.type).toBe("latitude");
    expect(result.fields.get("longitude")?.type).toBe("longitude");
    expect(result.records[0]).toMatchObject({
      entityKey: "7a9927ae-9aea-47eb-bac5-02c72d352cd0",
      payload: {
        latitude: 38.707288678883,
        longitude: -9.14301026891279,
        geometry: { type: "Point" },
      },
    });
  });

  it("transforms a live Lisbon health-centre fixture with stable identities", async () => {
    const result = await run(
      fixture("lisbon-health-centres.json"),
      context("lisbon-health-centres-feed", "Lisbon health centres"),
    );

    expect(result.product).toMatchObject({
      slug: "lisbon-health-centres",
      title: "Lisbon health centres",
      role: "reference",
    });
    expect(result.records).toHaveLength(3);
    expect(result.records[0]).toMatchObject({
      entityKey: expect.any(String),
      payload: {
        Nome: expect.any(String),
        latitude: expect.any(Number),
        longitude: expect.any(Number),
      },
    });
    expect(result.fields.get("OBJECTID")?.type).toBe("identifier");
    expect(result.fields.get("GlobalID")?.type).toBe("identifier");
  });

  it("adds deterministic centroids for live line and polygon fixtures, whatever the chunking", async () => {
    const lines = await run(
      fixture("cycling-lines.json"),
      context("lisboa-rede-ciclavel-feed"),
    );
    const polygons = await run(
      fixture("dog-parks.json"),
      context("lisboa-parques-caninos-feed"),
    );

    expect(lines.records).toHaveLength(3);
    expect(lines.records[0]?.payload.geometry).toMatchObject({
      type: "LineString",
    });
    expect(lines.records[0]?.payload.latitude).toEqual(
      expect.any(Number),
    );
    expect(lines.records[0]?.payload.longitude).toEqual(
      expect.any(Number),
    );
    expect(polygons.records[0]?.payload.geometry).toMatchObject({
      type: "Polygon",
    });
    expect(polygons.product?.description).toContain("Parques Caninos");
    expect(polygons.product?.description).toContain("2026");
    expect(await run(fixture("cycling-lines.json"), context("lisboa-rede-ciclavel-feed"), 1)).toEqual(lines);
  });

  it("decodes coded values while retaining their code and types dates and colours", async () => {
    const result = await run(typedLayer([siteA]), context("typed-feed"), 1);
    const record = result.records[0];

    expect(result.fields.get("STATUS")).toMatchObject({ name: "Status", type: "category" });
    expect(result.fields.get("STATUS__code")).toMatchObject({
      name: "Status code",
      type: "identifier",
    });
    expect(result.fields.get("UPDATED")?.type).toBe("datetime");
    expect(result.fields.get("COLOUR")?.type).toBe("color");
    expect(result.fields.get("WEBSITE")?.type).toBe("url");
    expect(result.fields.get("LABEL")?.display).toEqual({
      badge: { colorField: "Colour" },
    });
    expect(record?.payload).toMatchObject({
      Status: "Open",
      "Status code": 1,
      Updated: "2026-09-04T08:12:10.839Z",
      Colour: "#336699",
    });
    expect(record?.entityKey).toBe("10");
  });

  it("declares metadata types up front and refines string types and nullability once every feature is read", async () => {
    const result = await run(typedLayer([
      siteA,
      { ...siteA, properties: { ...siteA.properties, OBJECTID: 11, LABEL: null } },
      { ...siteA, properties: { ...siteA.properties, OBJECTID: null } },
    ]), context("typed-feed"));

    expect(result.declared.get("COLOUR")).toMatchObject({ type: "string", nullable: false });
    expect(result.declared.get("LABEL")?.display).toBeUndefined();
    expect(result.fields.get("COLOUR")).toMatchObject({ type: "color", nullable: false });
    expect(result.fields.get("LABEL")).toMatchObject({ nullable: true });
    expect(result.fields.get("OBJECTID")).toMatchObject({ nullable: true });
    expect(result.records.map((record) => record.entityKey)).toEqual(["10", "11"]);
    expect(result.quality).toEqual({
      acceptedRecords: 2,
      rejectedRecords: 1,
    });
  });

  it("keeps a layer's own latitude and longitude attributes apart from the derived coordinates", async () => {
    // APA's bathing-waters layer has attributes named latitude and longitude.
    const document = new TextEncoder().encode(JSON.stringify({
      type: "FeatureCollection",
      arcgis: {
        layerUrl: "https://sniambgeoogc.apambiente.pt/getogc/rest/services/SNIAmb/Aguas_Balneares/MapServer/0",
        name: "Água balnear",
        description: "",
        copyrightText: "",
        geometryType: "esriGeometryPoint",
        objectIdField: "id",
        fields: [
          { name: "codigo", alias: "Código", type: "esriFieldTypeString", nullable: true },
          { name: "id", alias: "id", type: "esriFieldTypeOID", nullable: true },
          { name: "latitude", alias: "latitude", type: "esriFieldTypeDouble", nullable: true },
          { name: "longitude", alias: "longitude", type: "esriFieldTypeDouble", nullable: true },
        ],
      },
      features: [{
        type: "Feature",
        properties: { codigo: "PTAD2T", id: 1, latitude: 37.73972, longitude: -25.66111 },
        geometry: { type: "Point", coordinates: [-25.66111, 37.73972] },
      }],
    }));
    const result = await run(document, context("apa-bathing-waters-feed"));
    const ids = result.product?.schema.fields.map((field) => field.id) ?? [];

    expect(new Set(ids).size).toBe(ids.length);
    expect(result.fields.get("latitude__source")).toMatchObject({ name: "latitude (2)", type: "number" });
    expect(result.fields.get("latitude")?.type).toBe("latitude");
    expect(result.records[0]?.payload).toMatchObject({ "latitude (2)": 37.73972, latitude: 37.73972, longitude: -25.66111 });
  });

  it("declares the product of an empty layer and rejects documents without layer metadata", async () => {
    const empty = await run(typedLayer([]), context("typed-feed"), 1);
    expect(empty.product?.productKey).toBe("features");
    expect(empty.records).toEqual([]);

    await expect(run(new TextEncoder().encode('{"type":"FeatureCollection","features":[]}'), context("typed-feed")))
      .rejects.toMatchObject({ code: "invalid-response" });
  });
});
