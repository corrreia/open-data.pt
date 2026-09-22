import {
  GatekeeperError,
  field,
  isJsonArray,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type CanonicalField,
  type CanonicalRecord,
  type CanonicalSchema,
  type ProductBuild,
  type TransformContext,
  type Transformer,
  type UnstampedResult,
} from "../../../index";
import { validateInfoaguaFeedConfig } from "./infoagua";

function badge(id: string, colorField: string, label: string): CanonicalField {
  return { id, name: id, type: "category", nullable: true, display: { label, badge: { colorField } } };
}

const FLOOD_SCHEMA: CanonicalSchema = {
  fields: [
    field("station", "identifier", false, undefined, "SNIRH station"),
    field("name", "string", true),
    field("type", "category", true),
    field("river", "string", true),
    field("basin", "category", true),
    field("latitude", "latitude", true),
    field("longitude", "longitude", true),
    field("watchedParameter", "category", true, undefined, "Watched parameter"),
    field("alertLevel", "number", true, undefined, "Alert level"),
    badge("alert", "alertColor", "Alert"),
    field("alertColor", "color", true, undefined, "Alert colour"),
  ],
};

const DROUGHT_SCHEMA: CanonicalSchema = {
  fields: [
    field("month", "date", false),
    field("basinId", "identifier", false, undefined, "Basin ID"),
    field("basin", "category", true),
    field("index", "number", true),
    field("state", "number", true),
    badge("stateName", "stateColor", "State"),
    field("stateColor", "color", true, undefined, "State colour"),
  ],
};

export class InfoaguaTransformer implements Transformer {
  readonly id = "infoagua";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const config = validateInfoaguaFeedConfig(context.feed.config);
    const document = parseJsonBytes(bytes);
    if (!isJsonObject(document) || document.feed !== config.feed || !isJsonArray(document.entries))
      throw new GatekeeperError("InfoÁgua collection does not match its feed", "invalid-response");
    const records: CanonicalRecord[] = [];
    let rejected = 0;
    for (const entry of document.entries) {
      if (!isJsonObject(entry)) {
        rejected += 1;
        continue;
      }
      if (config.feed === "flood-alerts") {
        if (!isJsonString(entry.station)) rejected += 1;
        else records.push({ entityKey: entry.station, payload: entry });
        continue;
      }
      if (!isJsonString(entry.basinId) || !isJsonString(entry.month) || !/^\d{4}-\d{2}$/u.test(entry.month)) {
        rejected += 1;
        continue;
      }
      const month = entry.month;
      records.push({ entityKey: `${entry.basinId}:${month}`, eventTime: `${month}-01T00:00:00.000Z`, payload: { ...entry, month: `${month}-01` } });
    }
    const flood = config.feed === "flood-alerts";
    const product: ProductBuild = {
      productKey: config.feed ?? "",
      slug: context.feed.slug.replace(/-feed$/u, ""),
      title: context.feed.title,
      description: context.feed.description,
      role: flood ? "current-state" : "summary",
      kind: "record",
      schema: flood ? FLOOD_SCHEMA : DROUGHT_SCHEMA,
      records,
      // The flood page lists every watched station; the drought page shows only the latest month, and the months before it
      // are kept rather than retracted.
      updateMode: flood ? "authoritative-snapshot" : "delta",
      completeness: "complete",
    };
    const watermark = flood
      ? undefined
      : records
          .map((record) => record.eventTime ?? "")
          .sort()
          .at(-1);
    if (watermark) product.watermark = watermark;
    return { products: [product], quality: { acceptedRecords: records.length, rejectedRecords: rejected } };
  }
}
