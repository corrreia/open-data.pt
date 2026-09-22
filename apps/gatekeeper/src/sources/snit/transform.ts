import {
  field,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  lisbonToUtc,
  parseJsonBytes,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonObject,
  type JsonValue,
  type ProductBuild,
  type TransformContext,
  type UnstampedResult,
} from "../../index";

/** One instrument: what it governs, where it applies and how far its paper trail reaches. */
const INSTRUMENT_SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    field("name", "string", false),
    // The kind of instrument is the feed, and the register answers only with
    // what is in force, so neither would vary down a column here. What does
    // vary is the note the register puts against an instrument in force —
    // whether its pieces are deposited yet, and what is still outstanding.
    field("stateNote", "string", true),
    field("municipalities", "string", false),
    field("municipalityCodes", "string", false),
    field("municipalityCount", "number", false),
    field("regions", "category", false),
    field("acts", "number", false),
    // How current the instrument is. The acts themselves — their references,
    // what each changed and the day it was published — are the other product of
    // this feed, and are not restated a second time on the instrument.
    field("lastPublishedOn", "date", true),
    field("plans", "number", false),
    field("latitude", "latitude", true),
    field("longitude", "longitude", true),
  ],
};

/**
 * One act of the Diário da República: the publication that brought an
 * instrument into being or changed it. This is the register's own clock.
 */
const ACT_SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    field("instrumentId", "identifier", false),
    field("instrument", "string", false),
    field("area", "string", true),
    field("change", "category", true),
    field("act", "string", false),
    field("gazette", "string", true),
    field("publishedOn", "date", false),
    field("depositReference", "string", true),
    field("document", "url", true),
    field("elements", "number", false),
  ],
};

/** What `collectSnitFeed` wrapped around the register's answer. */
interface Header {
  abbreviation: string;
  name: string;
}

export class SnitTransformer {
  readonly id = "snit-instruments";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const value = parseJsonBytes(bytes);
    if (!isJsonObject(value) || !isJsonObject(value.snit) || !isJsonArray(value.instruments)) throw new Error("SNIT document is not an instrument list");
    const header = readHeader(value.snit);

    const instruments: CanonicalRecord[] = [];
    const acts: CanonicalRecord[] = [];
    let rejected = 0;
    for (const candidate of value.instruments) {
      const built = instrument(candidate);
      if (!built) {
        rejected += 1;
        continue;
      }
      instruments.push(built.record);
      acts.push(...built.acts);
    }

    const slug = context.feed.slug.replace(/-feed$/u, "");
    const watermark = acts
      .map((record) => record.eventTime)
      .filter((time): time is string => time !== undefined)
      .toSorted()
      .at(-1);

    const instrumentProduct: ProductBuild = {
      productKey: "instruments",
      slug,
      title: context.feed.title,
      description: context.feed.description,
      role: "reference",
      schema: INSTRUMENT_SCHEMA,
      records: instruments,
      kind: "record",
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    };
    const actProduct: ProductBuild = {
      productKey: "acts",
      slug: `${slug}-atos`,
      title: `${context.feed.title}: publication acts`,
      description: `Every act of the Diário da República behind a ${header.name} (${header.abbreviation}) in force: what it changed, the issue it appeared in, the day it was published, the deposit reference it was given and a link to the act itself.`,
      role: "reference",
      schema: ACT_SCHEMA,
      records: acts,
      kind: "record",
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    };
    if (watermark) actProduct.watermark = watermark;

    return {
      products: [instrumentProduct, actProduct],
      quality: { acceptedRecords: instruments.length + acts.length, rejectedRecords: rejected },
    };
  }
}

function readHeader(value: JsonObject): Header {
  return {
    abbreviation: isJsonString(value.abbreviation) ? value.abbreviation : "",
    name: isJsonString(value.name) ? value.name : "",
  };
}

interface BuiltInstrument {
  record: CanonicalRecord;
  acts: CanonicalRecord[];
}

function instrument(value: JsonValue | undefined): BuiltInstrument | undefined {
  if (!isJsonObject(value) || !isJsonNumber(value.idigt)) return undefined;
  const id = String(value.idigt);
  const municipalities = readMunicipalities(value.listMunicipality);
  const acts = readActs(value.listDynamic, id, text(value.name) ?? id);
  const days = acts
    .map((act) => text(act.payload.publishedOn))
    .filter((day): day is string => day !== undefined)
    .toSorted();

  const payload: JsonObject = {
    id,
    name: text(value.name) ?? id,
    stateNote: text(value.message) ?? null,
    municipalities: municipalities.names.join(", "),
    municipalityCodes: municipalities.codes.join(","),
    municipalityCount: municipalities.codes.length,
    regions: municipalities.regions.join(", "),
    acts: acts.length,
    lastPublishedOn: days.at(-1) ?? null,
    plans: countOf(value.listRasters),
    latitude: midpoint(value.yMin, value.yMax, -90, 90),
    longitude: midpoint(value.xMin, value.xMax, -180, 180),
  };
  return { record: { entityKey: `igt-${id}`, payload }, acts };
}

interface Municipalities {
  names: string[];
  codes: string[];
  regions: string[];
}

function readMunicipalities(value: JsonValue | undefined): Municipalities {
  const names: string[] = [];
  const codes: string[] = [];
  const regions = new Set<string>();
  if (!isJsonArray(value)) return { names, codes, regions: [] };
  for (const member of value) {
    if (!isJsonObject(member)) continue;
    const designation = text(member.designation);
    const code = text(member.dtcc);
    const region = text(member.region);
    if (designation) names.push(designation);
    if (code) codes.push(code);
    if (region) regions.add(region);
  }
  return { names, codes, regions: [...regions].toSorted() };
}

/** The acts behind one instrument, newest first, each dated by the day it was published. */
function readActs(value: JsonValue | undefined, instrumentId: string, instrumentName: string): CanonicalRecord[] {
  if (!isJsonArray(value)) return [];
  const acts: CanonicalRecord[] = [];
  for (const member of value) {
    if (!isJsonObject(member) || !isJsonNumber(member.id)) continue;
    const day = calendarDay(member.pubDate);
    if (day === undefined) continue;
    const payload: JsonObject = {
      id: String(member.id),
      instrumentId,
      instrument: instrumentName,
      area: text(member.designation) ?? null,
      change: text(member.condition) ?? null,
      act: text(member.pubDR) ?? String(member.id),
      gazette: text(member.nrDR) ?? null,
      publishedOn: day,
      depositReference: text(member.idDeposito) ?? null,
      document: url(member.dinLink) ?? null,
      elements: countOf(member.listElements),
    };
    const record: CanonicalRecord = { entityKey: `ato-${member.id}`, payload };
    // The register writes a publication as a Lisbon calendar day with a zeroed
    // time. Dating the row by that day is the source's own clock; dating it by
    // the poll would make every act look like news on the day we happened to read it.
    const instant = lisbonToUtc(day, "00:00:00");
    if (instant) record.eventTime = instant;
    acts.push(record);
  }
  return acts.toSorted((left, right) => text(right.payload.publishedOn)?.localeCompare(text(left.payload.publishedOn) ?? "") ?? 0);
}

/** `2023-10-02T00:00:00` is a calendar day wearing a zeroed clock, and is kept as the day. */
function calendarDay(value: JsonValue | undefined): string | undefined {
  const written = text(value);
  if (written === undefined) return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})/u.exec(written);
  return match?.[1];
}

function midpoint(low: JsonValue | undefined, high: JsonValue | undefined, minimum: number, maximum: number): number | null {
  if (!isJsonNumber(low) || !isJsonNumber(high) || !Number.isFinite(low) || !Number.isFinite(high)) return null;
  const middle = (low + high) / 2;
  if (middle < minimum || middle > maximum) return null;
  return Math.round(middle * 1e6) / 1e6;
}

function countOf(value: JsonValue | undefined): number {
  return isJsonArray(value) ? value.length : 0;
}

function text(value: JsonValue | undefined): string | undefined {
  if (!isJsonString(value)) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function url(value: JsonValue | undefined): string | undefined {
  const written = text(value);
  if (written === undefined) return undefined;
  try {
    const parsed = new URL(written);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}
