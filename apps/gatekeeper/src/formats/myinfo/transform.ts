import {
  field,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type CanonicalField,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonObject,
  type JsonValue,
  type ProductBuild,
  type Transformer,
  type UnstampedResult,
} from "#/index";

/**
 * A Card4B MYINFO portal's collection document — the stop network one page
 * carries, or the departures one search answered with — into products. Pure:
 * the same document gives the same products whenever it is normalized.
 */
export class MyInfoTransformer implements Transformer {
  readonly id = "myinfo-portal";
  readonly version = "1";

  transform(bytes: Uint8Array): UnstampedResult {
    const document = parseJsonBytes(bytes);
    if (!isJsonObject(document) || !isJsonString(document.feed) || !isJsonString(document.operator)) {
      throw new Error("MYINFO collection document has no feed and operator");
    }
    switch (document.feed) {
      case "network":
        return network(document.operator, document);
      case "timetable":
        return timetable(document.operator, document);
      default:
        throw new Error(`Unsupported MYINFO feed: ${document.feed}`);
    }
  }
}

function network(operator: string, document: JsonObject): UnstampedResult {
  const stops = rows(document.stops);
  const lines = rows(document.lines);
  const zones = new Map<string, string>();
  for (const zone of rows(document.zones)) {
    const id = string(zone.id);
    const name = string(zone.name);
    if (id !== undefined && name !== undefined) zones.set(id, name);
  }

  const stopRecords: CanonicalRecord[] = [];
  const served = new Map<string, number>();
  for (const stop of stops) {
    const id = string(stop.stopId);
    const zoneId = string(stop.zoneId);
    const name = string(stop.name);
    if (id === undefined || zoneId === undefined || name === undefined) continue;
    const keys = strings(stop.lineKeys);
    for (const key of keys) served.set(key, (served.get(key) ?? 0) + 1);
    stopRecords.push({
      entityKey: id,
      payload: {
        id,
        code: string(stop.stopCode) ?? null,
        name,
        zoneId,
        // The place a journey search names, which the stop data itself leaves null.
        zoneName: zones.get(zoneId) ?? null,
        latitude: number(stop.latitude),
        longitude: number(stop.longitude),
        // The lines calling here, by key. Their numbers and names are published once, in the line list.
        lines: keys,
      },
    });
  }

  const lineRecords: CanonicalRecord[] = [];
  for (const line of lines) {
    const key = string(line.key);
    const code = string(line.code);
    const name = string(line.name);
    if (key === undefined || code === undefined || name === undefined) continue;
    lineRecords.push({
      entityKey: key,
      payload: {
        id: key,
        lineId: string(line.lineId) ?? null,
        code,
        name,
        direction: string(line.direction) === "RETURN" ? "return" : "outward",
        // A count the stop list does not carry: how many stops this direction calls at.
        stops: served.get(key) ?? 0,
      },
    });
  }

  const slug = operatorSlug(operator);
  const products: ProductBuild[] = [
    {
      productKey: "stops",
      slug: `${slug}-stops`,
      title: `${operator} stops`,
      description: "Every stop the operator serves, with its position, its code, the place a journey search calls it, and the lines calling there.",
      role: "reference",
      kind: "record",
      schema: schema(
        field("id", "identifier", false),
        field("code", "identifier", true),
        field("name", "string", false),
        field("zoneId", "identifier", false),
        field("zoneName", "category", true),
        field("latitude", "latitude", true),
        field("longitude", "longitude", true),
        field("lines", "json", false),
      ),
      records: stopRecords,
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    },
    {
      productKey: "lines",
      slug: `${slug}-lines`,
      title: `${operator} lines`,
      description: "Every line and direction the operator runs, with its number, its published name and how many stops it calls at.",
      role: "reference",
      kind: "record",
      schema: schema(
        field("id", "identifier", false),
        field("lineId", "identifier", true),
        field("code", "category", false),
        field("name", "string", false),
        field("direction", "category", false),
        field("stops", "number", false),
      ),
      records: lineRecords,
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    },
  ];
  return {
    products,
    quality: { acceptedRecords: stopRecords.length + lineRecords.length, rejectedRecords: stops.length + lines.length - stopRecords.length - lineRecords.length },
  };
}

function timetable(operator: string, document: JsonObject): UnstampedResult {
  const from = place(document.origin);
  const to = place(document.destination);
  if (from === undefined || to === undefined) throw new Error("MYINFO timetable document names no origin and destination");
  const trips = rows(document.trips);
  const records: CanonicalRecord[] = [];
  const seen = new Set<string>();
  for (const trip of trips) {
    const departure = clock(trip.departure);
    const arrival = clock(trip.arrival);
    const duration = clock(trip.duration);
    const routes = strings(trip.routes);
    if (departure === undefined || arrival === undefined || duration === undefined || routes.length === 0) continue;
    const days = string(trip.frequency) ?? "";
    // One departure is the same journey whenever it is collected: the days it runs,
    // the time it leaves, and the lines it uses. The date of a collection is not part of it.
    const entityKey = `${days}|${departure}|${routes.join("+")}`;
    if (seen.has(entityKey)) continue;
    seen.add(entityKey);
    records.push({
      entityKey,
      payload: {
        id: entityKey,
        departure,
        arrival,
        minutes: minutes(duration),
        lines: routes,
        transfer: string(trip.transfer) ?? null,
        days,
      },
    });
  }

  const slug = `${operatorSlug(operator)}-${placeSlug(from.name)}-${placeSlug(to.name)}-departures`;
  const product: ProductBuild = {
    productKey: "departures",
    slug: slug.length <= 200 ? slug : `${operatorSlug(operator)}-${from.id}-${to.id}-departures`,
    title: `${from.name} to ${to.name} departures`,
    description:
      `Every scheduled departure from ${from.name} to ${to.name} run by ${operator}, with its arrival, journey time, the lines it uses, where to change, and the days it runs. ` +
      "One collection asks the portal for one day, so the list grows as days of different service patterns are collected; a departure is never removed by a day that does not run it.",
    role: "reference",
    kind: "record",
    schema: schema(
      field("id", "identifier", false),
      field("departure", "string", false),
      field("arrival", "string", false),
      field("minutes", "number", true, "min"),
      field("lines", "json", false),
      field("transfer", "string", true),
      field("days", "category", false),
    ),
    records,
    // A search answers for one day, so it can add and correct departures but never retract them.
    updateMode: "partial-snapshot",
    completeness: "partial",
  };
  return { products: [product], quality: { acceptedRecords: records.length, rejectedRecords: trips.length - records.length } };
}

interface Place {
  id: string;
  name: string;
}

function place(value: JsonValue | undefined): Place | undefined {
  if (!isJsonObject(value)) return undefined;
  const id = string(value.id);
  const name = string(value.name);
  return id === undefined || name === undefined ? undefined : { id, name };
}

/** `HH:MM` as whole minutes, for the journey time a portal writes as a clock. */
function minutes(duration: string): number | null {
  const parts = duration.split(":");
  const hours = Number(parts[0]);
  const rest = Number(parts[1]);
  if (!Number.isInteger(hours) || !Number.isInteger(rest)) return null;
  return hours * 60 + rest;
}

function operatorSlug(operator: string): string {
  return placeSlug(operator);
}

/** A name as a slug piece: unaccented, lower case, words joined by hyphens. */
function placeSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug === "" ? "portal" : slug;
}

function rows(value: JsonValue | undefined): JsonObject[] {
  if (!isJsonArray(value)) return [];
  return value.filter((entry) => isJsonObject(entry));
}

function strings(value: JsonValue | undefined): string[] {
  if (!isJsonArray(value)) return [];
  const found: string[] = [];
  for (const entry of value) {
    const text = string(entry);
    if (text !== undefined) found.push(text);
  }
  return found;
}

function clock(value: JsonValue | undefined): string | undefined {
  const text = string(value);
  if (text === undefined || !/^\d{1,2}:\d{2}$/u.test(text)) return undefined;
  const [hours, rest] = text.split(":");
  return `${hours!.padStart(2, "0")}:${rest!}`;
}

function number(value: JsonValue | undefined): number | null {
  return isJsonNumber(value) && Number.isFinite(value) ? value : null;
}

function string(value: JsonValue | undefined): string | undefined {
  if (!isJsonString(value)) return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}

function schema(...fields: CanonicalField[]): CanonicalSchema {
  return { fields };
}
