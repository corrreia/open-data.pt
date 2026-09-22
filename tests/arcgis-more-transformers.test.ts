import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanonicalField, CanonicalRecord, ProductDeclaration, TransformContext, TransformQuality } from "@open-data-pt/contract";
import { ARCGIS_EXAMPLES } from "../apps/gatekeeper/src/formats/arcgis";
import { ArcgisTransformer } from "../apps/gatekeeper/src/formats/arcgis";

const transformer = new ArcgisTransformer();

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/arcgis-more/${name}`, import.meta.url)));
}

function context(slug: string, service: string, title = slug): TransformContext {
  return {
    feed: {
      id: `feed_${slug}`,
      slug,
      title,
      description: "live APA fixture",
      config: {
        host: "sniambgeoogc.apambiente.pt",
        service: `getogc/rest/services/SNIAmb/${service}/MapServer`,
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
        entityKeyField: "GlobalID or OBJECTID",
      },
    },
    observedAt: "2026-09-07T20:55:23Z",
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
  fields: Map<string, CanonicalField>;
  quality: TransformQuality;
}

async function run(bytes: Uint8Array, feed: TransformContext, chunkSize = 61): Promise<Run> {
  const transform = await transformer.transform(chunked(bytes, chunkSize), feed);
  const records: CanonicalRecord[] = [];
  for await (const row of transform.rows) if (row.record) records.push(row.record);
  const summary = transform.finish();
  const product = transform.products[0];
  const schema = summary.products?.find((entry) => entry.productKey === product?.productKey)?.schema ?? product?.schema;
  return { product, records, fields: new Map(schema?.fields.map((field) => [field.id, field])), quality: summary.quality };
}

describe("ArcGIS transformers — APA SNIAmb live fixtures", () => {
  it("types bathing-water classifications, dates, URLs, identifiers, and coordinates", async () => {
    const result = await run(fixture("bathing-beaches.json"), context("apa-bathing-beaches-feed", "Praias", "Portugal bathing beaches"), 1);
    const fields = result.fields;

    expect({ id: transformer.id, version: transformer.version }).toEqual({ id: "arcgis-rest-layer", version: "2" });
    expect(result.product).toMatchObject({
      slug: "apa-bathing-beaches",
      title: "Portugal bathing beaches",
      role: "reference",
      updateMode: "authoritative-snapshot",
    });
    expect(fields.get("objectid")?.type).toBe("identifier");
    expect(fields.get("qualidade_agua_balnear_dsc")?.type).toBe("category");
    expect(fields.get("data_inicio_epoca_balnear")?.type).toBe("datetime");
    expect(fields.get("url_infopraia")?.type).toBe("url");
    expect(fields.get("shape")?.type).toBe("geometry");
    expect(fields.get("latitude")?.type).toBe("latitude");
    expect(fields.get("longitude")?.type).toBe("longitude");
    expect(result.records[0]).toMatchObject({
      entityKey: "100000001",
      payload: {
        data_inicio_epoca_balnear: "2026-06-27T00:00:00.000Z",
        qualidade_agua_balnear_dsc: "Água adequada a banhos",
        url_infopraia: "https://infoagua.apambiente.pt/pt/praias/praia-detalhe/8979629970",
        latitude: expect.any(Number),
        longitude: expect.any(Number),
      },
    });
    expect(result.quality).toEqual({
      acceptedRecords: 3,
      rejectedRecords: 0,
    });
  });

  it("types station status and links while retaining point positions", async () => {
    const hydrometric = await run(fixture("hydrometric-stations.json"), context("apa-hydrometric-stations-feed", "Estacoes_hidrometricas"));
    const meteorological = await run(fixture("meteorological-stations.json"), context("apa-meteorological-stations-feed", "Estacoes_meteorologicas"));

    expect(hydrometric.fields.get("estado")?.type).toBe("category");
    expect(hydrometric.fields.get("url")?.type).toBe("url");
    expect(hydrometric.records[0]?.payload).toMatchObject({
      Código: "03J/02H",
      Estado: "ATIVA",
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    });
    expect(meteorological.records).toHaveLength(3);
    expect(meteorological.records[0]?.entityKey).toBe("100000002");
  });

  it("converts pre-1970 ArcGIS epoch dates and preserves flood elevations as numbers", async () => {
    const result = await run(fixture("flood-marks.json"), context("apa-flood-marks-feed", "Marcas_cheias"));
    const first = result.records[0];

    expect(result.fields.get("data")?.type).toBe("datetime");
    expect(result.fields.get("cota_inundacao")?.type).toBe("number");
    expect(first?.payload).toMatchObject({
      Data: new Date(-1_894_233_600_000).toISOString(),
      "Cota de inundação": 9.54,
      Fonte: "PDM Porto",
    });
  });

  it("builds typed reference products for air-quality and RADNET stations", async () => {
    const air = await run(fixture("air-quality-stations.json"), context("apa-air-quality-stations-feed", "Qualidade_do_Ar"));
    const radnet = await run(fixture("radnet-stations.json"), context("apa-radnet-stations-feed", "RADNET"));

    expect(air.fields.get("rede_m_id")?.type).toBe("identifier");
    expect(radnet.fields.get("limite")?.type).toBe("number");
    expect(air.records).toHaveLength(3);
    expect(radnet.records[0]).toMatchObject({
      entityKey: "1201",
      payload: { nome: "Coimbra", limite: 689 },
    });
  });

  it("ships ten ready-to-install APA examples", () => {
    const examples = ARCGIS_EXAMPLES.filter((example) => example.config.host === "sniambgeoogc.apambiente.pt");

    expect(examples).toHaveLength(10);
    expect(examples.map((example) => `${example.config.service}/${example.config.layer}`)).toEqual([
      "getogc/rest/services/SNIAmb/Praias/MapServer/0",
      "getogc/rest/services/SNIAmb/Qualidade_do_Ar/MapServer/0",
      "getogc/rest/services/SNIAmb/Estacoes_hidrometricas/MapServer/0",
      "getogc/rest/services/SNIAmb/Estacoes_meteorologicas/MapServer/0",
      "getogc/rest/services/SNIAmb/RADNET/MapServer/0",
      "getogc/rest/services/SNIAmb/Marcas_cheias/MapServer/0",
      "getogc/rest/services/SNIAmb/Aguas_Balneares/MapServer/0",
      "getogc/rest/services/SNIAmb/Praias/MapServer/2",
      "getogc/rest/services/SNIAmb/Prevencao_Acidentes_Graves/MapServer/0",
      "getogc/rest/services/SNIAmb/CELE/MapServer/0",
    ]);
    expect(examples.every((example) => example.policy.collection.maxBytes === 5 * 1024 * 1024 && example.policy.collection.historyMode === "changes")).toBe(true);
  });
});
