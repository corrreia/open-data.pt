import {
  GatekeeperError,
  field,
  isJsonBoolean,
  isJsonNumber,
  isJsonString,
  streamJsonArray,
  type CanonicalRecord,
  type JsonObject,
  type JsonValue,
  type NormalizedRow,
  type ProductDeclaration,
  type ProductFinalization,
  type StreamingTransform,
  type TransformContext,
} from "../../../index";
import { pageRecords, PEERINGDB_MAX_RECORDS, validatePeeringdbFeedConfig } from "./peeringdb";

const SCHEMA = {
  fields: [
    field("id", "identifier", false),
    field("name", "string", false),
    field("nameLong", "string", true),
    field("city", "string", false),
    field("country", "category", false),
    field("website", "url", true),
    field("media", "category", true),
    field("supportsUnicast", "boolean", true),
    field("supportsMulticast", "boolean", true),
    field("supportsIpv6", "boolean", true),
    field("created", "datetime", true),
    field("updated", "datetime", true),
  ],
};

export class PeeringdbTransformer {
  readonly id = "peeringdb-exchanges";
  readonly version = "1";

  async transform(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
    validatePeeringdbFeedConfig(context.feed.config);
    const pages = streamJsonArray(body, ["pages"], { maxElementBytes: 256 * 1024, maxEnvelopeBytes: 1024 });
    const iterator = pages.elements[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (first.done) throw new GatekeeperError("PeeringDB collection omitted its pages", "invalid-response");
    let accepted = 0;
    let nonemptyPages = 0;
    let exhausted = false;
    let finished = false;
    let watermark: string | undefined;
    const seen = new Set<number>();
    const product: ProductDeclaration = {
      productKey: "exchanges",
      slug: context.feed.slug.replace(/-feed$/, ""),
      title: context.feed.title,
      description: context.feed.description,
      kind: "record",
      role: "reference",
      schema: SCHEMA,
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    };
    async function* rows(): AsyncGenerator<NormalizedRow> {
      try {
        for (let current = first; !current.done; current = await iterator.next()) {
          if (exhausted) throw new GatekeeperError("PeeringDB returned pages after exhaustion", "invalid-response");
          const records = pageRecords(current.value);
          if (records.length === 0) {
            exhausted = true;
            continue;
          }
          nonemptyPages += 1;
          for (const raw of records) {
            if (!isJsonNumber(raw.id) || !Number.isSafeInteger(raw.id) || raw.id <= 0 || raw.country !== "PT" || raw.status !== "ok")
              throw new GatekeeperError("PeeringDB exchange has invalid identity, country or status", "invalid-response");
            if (seen.has(raw.id)) throw new GatekeeperError("PeeringDB pagination repeated an exchange ID", "invalid-response");
            if (seen.size >= PEERINGDB_MAX_RECORDS) throw new GatekeeperError("PeeringDB exceeded its exchange bound", "response-too-large");
            seen.add(raw.id);
            const updated = timestamp(raw.updated);
            const payload: JsonObject = {
              id: String(raw.id),
              name: text(raw.name, false),
              nameLong: text(raw.name_long),
              city: text(raw.city, false, true),
              country: "PT",
              website: website(raw.website),
              media: text(raw.media),
              supportsUnicast: boolean(raw.proto_unicast),
              supportsMulticast: boolean(raw.proto_multicast),
              supportsIpv6: boolean(raw.proto_ipv6),
              created: timestamp(raw.created),
              updated,
            };
            accepted += 1;
            if (updated && (!watermark || updated > watermark)) watermark = updated;
            const record: CanonicalRecord = { entityKey: String(raw.id), payload };
            if (updated) {
              record.eventTime = updated;
              record.sourcePublishedAt = updated;
            }
            yield { productKey: "exchanges", record };
          }
        }
        if (!exhausted) throw new GatekeeperError("PeeringDB directory did not reach an empty final page", "invalid-response");
        finished = true;
      } finally {
        await iterator.return?.();
      }
    }
    return {
      products: [product],
      rows: rows(),
      finish: () => {
        if (!finished) throw new GatekeeperError("PeeringDB stream is incomplete", "invalid-response");
        // Offset pages have no shared snapshot token. An intervening edit could shift an
        // existing row past an offset, so multi-page collections must not authorize deletion.
        const finalization: ProductFinalization = { productKey: "exchanges", completeness: nonemptyPages > 1 ? "partial" : "complete" };
        if (watermark) finalization.watermark = watermark;
        return { quality: { acceptedRecords: accepted, rejectedRecords: 0 }, products: [finalization] };
      },
    };
  }
}

function text(value: JsonValue | undefined, nullable = true, allowEmpty = false): string | null {
  if ((value === undefined || value === null || value === "") && nullable) return null;
  if (!isJsonString(value) || (!allowEmpty && !value.trim()) || value.length > 1000) throw new GatekeeperError("PeeringDB exchange text is invalid", "invalid-response");
  return value.trim();
}

function boolean(value: JsonValue | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  if (!isJsonBoolean(value)) throw new GatekeeperError("PeeringDB exchange protocol flag is invalid", "invalid-response");
  return value;
}

function timestamp(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (!isJsonString(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new GatekeeperError("PeeringDB source timestamp is invalid", "invalid-response");
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10))
    throw new GatekeeperError("PeeringDB source calendar date is invalid", "invalid-response");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new GatekeeperError("PeeringDB source timestamp is invalid", "invalid-response");
  return parsed.toISOString();
}

function website(value: JsonValue | undefined): string | null {
  const candidate = text(value);
  if (candidate === null) return null;
  try {
    const url = new URL(candidate);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) return url.toString();
  } catch {
    /* Invalid or credential-bearing links are not published. */
  }
  throw new GatekeeperError("PeeringDB exchange website is invalid", "invalid-response");
}
