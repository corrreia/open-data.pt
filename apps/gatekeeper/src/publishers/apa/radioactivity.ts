import { GatekeeperError, field, isJsonNumber, isJsonObject, isJsonString, streamJsonArray } from "#/index";
import type { NormalizedRow, ProductDeclaration, StreamingTransform, StreamingTransformer, TransformContext } from "#/index";

/*
 * The radioactivity readings of APA's SIRAD viewer (`Visualizador/sirad` on sniambgeoogc.apambiente.pt): one ArcGIS
 * layer per measurement, each holding the latest reading of every station of the national radioactivity alert
 * network (RADNET). The layer is read whole by the `arcgis` library; this turns its rows into one series per station,
 * so that reading it every hour keeps every hour.
 *
 * `data_hora` is an ArcGIS date: milliseconds since the epoch, which ArcGIS keeps in UTC and the layer does not say
 * otherwise. The newest reading is 30 to 45 minutes old when read against that clock.
 */

/** The layer's unit codes, as the unit a person reads. */
const UNITS = new Map([
  ["nsvh", "nSv/h"],
  ["bqm3", "Bq/m3"],
]);

const PRODUCT_KEY = "readings";

export class RadioactivityTransformer implements StreamingTransformer {
  readonly id = "apa-radioactivity";
  readonly version = "1";

  async transform(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
    const product: ProductDeclaration = {
      productKey: PRODUCT_KEY,
      slug: context.feed.slug.replace(/-feed$/u, ""),
      title: context.feed.title,
      description: context.feed.description,
      role: "time-series",
      kind: "series",
      schema: {
        fields: [
          field("seriesKey", "identifier", false),
          field("eventTime", "datetime", false),
          field("value", "number", false),
          field("unit", "category", false),
          field("dimensions", "json", false),
        ],
      },
      // The layer shows each station's latest reading only; the ones before it are kept rather than retracted.
      updateMode: "delta",
      completeness: "complete",
    };
    const document = streamJsonArray(body, ["features"]);
    let accepted = 0;
    let rejected = 0;
    let watermark: string | undefined;

    async function* rows(): AsyncGenerator<NormalizedRow> {
      for await (const feature of document.elements) {
        const properties = isJsonObject(feature) && isJsonObject(feature.properties) ? feature.properties : undefined;
        const station = properties?.id_estacao;
        const time = properties?.data_hora;
        const value = properties?.valor;
        const unit = isJsonString(properties?.unidade) ? UNITS.get(properties.unidade) : undefined;
        if (!properties || !isJsonNumber(station) || !isJsonNumber(time) || !isJsonNumber(value) || !unit) {
          rejected += 1;
          continue;
        }
        // A time no date can hold is that reading's fault, not the collection's.
        const measured = new Date(time);
        if (Number.isNaN(measured.getTime())) {
          rejected += 1;
          continue;
        }
        const eventTime = measured.toISOString();
        if (watermark === undefined || eventTime > watermark) watermark = eventTime;
        accepted += 1;
        yield {
          productKey: PRODUCT_KEY,
          point: {
            seriesKey: String(station),
            eventTime,
            value,
            unit,
            dimensions: { station: String(station), name: isJsonString(properties.nome_estacao) ? properties.nome_estacao : String(station) },
          },
        };
      }
      if (accepted === 0 && rejected > 0) throw new GatekeeperError("SIRAD layer has no readable reading", "invalid-response");
    }

    return {
      products: [product],
      rows: rows(),
      finish: () => ({
        quality: { acceptedRecords: accepted, rejectedRecords: rejected },
        products: watermark === undefined ? [] : [{ productKey: PRODUCT_KEY, watermark }],
      }),
    };
  }
}

/** The translator every radioactivity feed's file calls. */
export const RADIOACTIVITY_TRANSFORMER = new RadioactivityTransformer();

export const RADIOACTIVITY_NORMALIZER = { id: RADIOACTIVITY_TRANSFORMER.id, version: RADIOACTIVITY_TRANSFORMER.version };
