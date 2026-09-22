import {
  asNumberLike,
  field,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  lisbonToUtc,
  parseJsonBytes,
  type CanonicalField,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonValue,
  type ProductBuild,
  type Transformer,
  type UnstampedResult,
} from "../../index";
import { METRO_DAY_TYPES, METRO_LINES, type MetroDayType, type MetroLine } from "./metrolisboa";

const LINE_NAMES = { amarela: "Amarela", azul: "Azul", verde: "Verde", vermelha: "Vermelha" } as const satisfies Record<MetroLine, string>;
/** The suffix each line's message-type field carries in the status answer. */
const LINE_CODES = { amarela: "am", azul: "az", verde: "vd", vermelha: "vm" } as const satisfies Record<MetroLine, string>;
const DAY_TYPES = { S: "weekday", F: "weekend-holiday" } as const satisfies Record<MetroDayType, string>;

/** One of the up-to-three next trains at a platform. */
interface NextTrain {
  train: string | null;
  seconds: number | null;
}

/**
 * Metro Lisboa's EstadoServicoML answers, as the collection document the
 * source assembled, into one product per feed. Pure: the same document gives
 * the same products whenever it is normalized.
 */
export class MetroLisboaTransformer implements Transformer {
  readonly id = "metrolisboa-estado-servico";
  readonly version = "1";

  transform(bytes: Uint8Array): UnstampedResult {
    const document = parseJsonBytes(bytes);
    if (!isJsonObject(document) || !isJsonString(document.feed)) throw new Error("Metro Lisboa collection document has no feed");
    switch (document.feed) {
      case "line-status":
        return lineStatus(document.status);
      case "waiting-times":
        return waitingTimes(document.waiting, document.destinations);
      case "stations":
        return stations(document.stations);
      case "headways":
        return headways(document.headways);
      default:
        throw new Error(`Unsupported Metro Lisboa feed: ${document.feed}`);
    }
  }
}

function lineStatus(status: JsonValue | undefined): UnstampedResult {
  if (!isJsonObject(status)) throw new Error("Metro Lisboa line status must be an object");
  const records: CanonicalRecord[] = [];
  for (const line of METRO_LINES) {
    const text = trimmed(status[line]);
    if (text === undefined) continue;
    records.push({
      entityKey: line,
      payload: {
        id: line,
        line: LINE_NAMES[line],
        status: text,
        // The operator's own short state: "normal" while running, "encerrada" after closing time, other words for disruptions.
        // It is published as written, not folded into a yes/no that would call every night a disruption.
        shortStatus: trimmed(status[`${line}_curta`]) ?? null,
        messageType: trimmed(status[`tipo_msg_${LINE_CODES[line]}`]) ?? null,
      },
    });
  }
  return result(METRO_LINES.length, records.length, {
    productKey: "line-status",
    slug: "metrolisboa-line-status",
    title: "Metro Lisboa line status",
    description:
      "Each of the four lines' state as the operator reports it: a short state (normal while running, encerrada after closing time, another word during a disruption), the service message, and its message type.",
    role: "current-state",
    schema: schema(
      field("id", "identifier", false),
      field("line", "category", false),
      field("status", "string", false),
      field("shortStatus", "category", true),
      field("messageType", "category", true),
    ),
    kind: "record",
    records,
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  });
}

function waitingTimes(waiting: JsonValue | undefined, destinations: JsonValue | undefined): UnstampedResult {
  if (!isJsonArray(waiting) || !isJsonArray(destinations)) throw new Error("Metro Lisboa waiting times need the platform and destination lists");
  const names = new Map<string, string>();
  for (const destination of destinations) {
    if (!isJsonObject(destination)) continue;
    const id = idText(destination.id_destino);
    const name = trimmed(destination.nome_destino);
    if (id !== undefined && name !== undefined) names.set(id, name);
  }
  const records: CanonicalRecord[] = [];
  const platforms = new Set<string>();
  let watermark: string | undefined;
  for (const row of waiting) {
    if (!isJsonObject(row)) continue;
    const platform = trimmed(row.cais);
    const station = trimmed(row.stop_id);
    const at = metroTimestamp(trimmed(row.hora));
    if (platform === undefined || station === undefined || at === undefined || platforms.has(platform)) continue;
    platforms.add(platform);
    const destinationId = idText(row.destino) ?? null;
    const first = train(row.comboio, row.tempoChegada1);
    const second = train(row.comboio2, row.tempoChegada2);
    const third = train(row.comboio3, row.tempoChegada3);
    records.push({
      entityKey: platform,
      // The operator's own clock for this reading, not the moment it was polled.
      eventTime: at,
      payload: {
        platform,
        stationId: station,
        train1: first.train,
        arrival1Seconds: first.seconds,
        train2: second.train,
        arrival2Seconds: second.seconds,
        train3: third.train,
        arrival3Seconds: third.seconds,
        destinationId,
        destinationName: destinationId === null ? null : (names.get(destinationId) ?? null),
        leavingService: asNumberLike(row.sairServico) === 1,
        units: asNumberLike(row.UT) ?? null,
      },
    });
    if (watermark === undefined || at > watermark) watermark = at;
  }
  const product: ProductBuild = {
    productKey: "waiting-times",
    slug: "metrolisboa-waiting-times",
    title: "Metro Lisboa waiting times",
    description: "The next three trains at every platform, in seconds from the operator's reading time, with the destination they run to. Empty outside service hours.",
    role: "current-state",
    schema: schema(
      field("platform", "identifier", false),
      field("stationId", "category", false),
      field("train1", "identifier", true),
      field("arrival1Seconds", "number", true, "s"),
      field("train2", "identifier", true),
      field("arrival2Seconds", "number", true, "s"),
      field("train3", "identifier", true),
      field("arrival3Seconds", "number", true, "s"),
      field("destinationId", "category", true),
      field("destinationName", "category", true),
      field("leavingService", "boolean", false),
      field("units", "number", true, "train unit"),
    ),
    kind: "record",
    records,
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  };
  if (watermark !== undefined) product.watermark = watermark;
  return result(waiting.length, records.length, product);
}

function stations(list: JsonValue | undefined): UnstampedResult {
  if (!isJsonArray(list)) throw new Error("Metro Lisboa stations must be a list");
  const records: CanonicalRecord[] = [];
  const ids = new Set<string>();
  for (const row of list) {
    if (!isJsonObject(row)) continue;
    const id = trimmed(row.stop_id);
    const name = trimmed(row.stop_name);
    const latitude = coordinate(row.stop_lat, 90);
    const longitude = coordinate(row.stop_lon, 180);
    if (id === undefined || name === undefined || latitude === undefined || longitude === undefined || ids.has(id)) continue;
    ids.add(id);
    records.push({
      entityKey: id,
      payload: { id, name, latitude, longitude, lines: bracketList(row.linha), urls: bracketList(row.stop_url), zone: trimmed(row.zone_id) ?? null },
    });
  }
  return result(list.length, records.length, {
    productKey: "stations",
    slug: "metrolisboa-stations",
    title: "Metro Lisboa stations",
    description: "Every station with its position, the lines that serve it, its fare zone and its page on the operator's site.",
    role: "reference",
    schema: schema(
      field("id", "identifier", false),
      field("name", "string", false),
      field("latitude", "latitude", false),
      field("longitude", "longitude", false),
      field("lines", "json", false),
      field("urls", "json", false),
      field("zone", "category", true),
    ),
    kind: "record",
    records,
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  });
}

function headways(groups: JsonValue | undefined): UnstampedResult {
  if (!isJsonArray(groups)) throw new Error("Metro Lisboa headways must be a list of tables");
  const records: CanonicalRecord[] = [];
  const keys = new Set<string>();
  let rows = 0;
  for (const group of groups) {
    if (!isJsonObject(group) || !isJsonArray(group.rows)) throw new Error("Metro Lisboa headway table is malformed");
    const line = lineOf(group.line);
    const day = dayTypeOf(group.day);
    if (line === undefined || day === undefined) throw new Error("Metro Lisboa headway table names an unknown line or day type");
    for (const row of group.rows) {
      rows += 1;
      if (!isJsonObject(row)) continue;
      const start = clockText(row.HoraInicio);
      const end = clockText(row.HoraFim);
      const interval = trimmed(row.Intervalo);
      const seconds = intervalSeconds(interval);
      const key = `${line}:${day}:${start ?? ""}`;
      if (start === undefined || end === undefined || interval === undefined || seconds === undefined || keys.has(key)) continue;
      keys.add(key);
      records.push({
        entityKey: key,
        payload: { id: key, line: LINE_NAMES[line], lineId: line, dayType: DAY_TYPES[day], start, end, interval, intervalSeconds: seconds, units: asNumberLike(row.UT) ?? null },
      });
    }
  }
  return result(rows, records.length, {
    productKey: "headways",
    slug: "metrolisboa-headways",
    title: "Metro Lisboa scheduled headways",
    description:
      "The scheduled interval between trains on each line for each time band, on weekdays and on weekends and holidays. The operator writes the interval as minutes:seconds:hundredths (07:30:00 is seven and a half minutes); intervalSeconds reads it that way.",
    role: "reference",
    schema: schema(
      field("id", "identifier", false),
      field("line", "category", false),
      field("lineId", "category", false),
      field("dayType", "category", false),
      field("start", "string", false),
      field("end", "string", false),
      field("interval", "string", false),
      field("intervalSeconds", "number", false, "s"),
      field("units", "number", true, "train unit"),
    ),
    kind: "record",
    records,
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  });
}

/** A Europe/Lisbon wall-clock time written `yyyyMMddHHmmss`, as an ISO 8601 UTC time; undefined when it is not one. */
export function metroTimestamp(text: string | undefined): string | undefined {
  const match = text === undefined ? null : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/u.exec(text);
  if (!match) return undefined;
  return lisbonToUtc(`${match[1]}-${match[2]}-${match[3]}`, `${match[4]}:${match[5]}:${match[6]}`);
}

/** `07:30:00` as seconds, reading minutes and seconds; undefined for anything else. */
export function intervalSeconds(text: string | undefined): number | undefined {
  const match = text === undefined ? null : /^(\d{1,2}):(\d{2})(?::\d{2})?$/u.exec(text);
  if (!match) return undefined;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  return seconds < 60 ? minutes * 60 + seconds : undefined;
}

/** `[Verde, Vermelha]` or `[https://a/,https://b/]` as a list of its entries. */
export function bracketList(value: JsonValue | undefined): string[] {
  if (isJsonArray(value))
    return value
      .filter(isJsonString)
      .map((item) => item.trim())
      .filter((item) => item !== "");
  const text = trimmed(value);
  if (text === undefined) return [];
  return text
    .replace(/^\[/u, "")
    .replace(/\]$/u, "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function train(id: JsonValue | undefined, arrival: JsonValue | undefined): NextTrain {
  const name = trimmed(id);
  const seconds = asNumberLike(arrival);
  if (name === undefined) return { train: null, seconds: null };
  return { train: name, seconds: seconds !== undefined && Number.isFinite(seconds) && seconds >= 0 ? seconds : null };
}

function coordinate(value: JsonValue | undefined, bound: number): number | undefined {
  const number = asNumberLike(value);
  return number !== undefined && Number.isFinite(number) && Math.abs(number) <= bound ? number : undefined;
}

function clockText(value: JsonValue | undefined): string | undefined {
  const text = trimmed(value);
  return text !== undefined && /^\d{2}:\d{2}:\d{2}$/u.test(text) ? text : undefined;
}

function idText(value: JsonValue | undefined): string | undefined {
  if (isJsonNumber(value) && Number.isFinite(value)) return String(value);
  return trimmed(value);
}

function trimmed(value: JsonValue | undefined): string | undefined {
  if (!isJsonString(value)) return undefined;
  const text = value.trim();
  return text === "" ? undefined : text;
}

function lineOf(value: JsonValue | undefined): MetroLine | undefined {
  return METRO_LINES.find((line) => line === value);
}

function dayTypeOf(value: JsonValue | undefined): MetroDayType | undefined {
  return METRO_DAY_TYPES.find((day) => day === value);
}

function schema(...fields: CanonicalField[]): CanonicalSchema {
  return { fields };
}

function result(inputCount: number, acceptedRecords: number, product: ProductBuild): UnstampedResult {
  const rejected = inputCount - acceptedRecords;
  return {
    products: [product],
    quality: { acceptedRecords, rejectedRecords: rejected },
  };
}
