import { Link } from "@cloudflare/kumo";
import { Fragment, type ReactNode } from "react";
import { fmt, humanize, isRecord } from "../../lib/format";
import type { Field, Geometry, JsonRecord, JsonValue, SeriesPoint } from "../../lib/types";

export function isText(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

const isHexColor = (value: JsonValue | undefined): value is string => isText(value) && /^#[0-9a-f]{6}$/i.test(value);

/** How many positions a geometry is made of: the size of a route or a border. */
export function countPositions(geometry: Geometry | undefined): number {
  if (!geometry) return 0;
  if (geometry.geometries) return geometry.geometries.reduce((total, item) => total + countPositions(item), 0);
  const count = (value: JsonValue | undefined): number => {
    if (!Array.isArray(value)) return 0;
    if (Number.isFinite(value[0])) return 1;
    return value.reduce<number>((total, item) => total + count(item), 0);
  };
  return count(geometry.coordinates);
}

function geometryOf(value: JsonValue | undefined): Geometry | undefined {
  if (value === undefined || value === null || !isRecord(value) || !isText(value.type)) return undefined;
  const geometry: Geometry = { type: value.type };
  if (value.coordinates !== undefined) geometry.coordinates = value.coordinates;
  if (Array.isArray(value.geometries)) geometry.geometries = value.geometries.map(geometryOf).filter((item): item is Geometry => item !== undefined);
  return geometry;
}

/** One cell from its field type and display hints; nothing here knows any source. */
export function Cell({ record, field }: { record: JsonRecord; field: Field }): ReactNode {
  const value = record[field.name];
  const badge = field.display?.badge;
  if (badge && isText(value) && isHexColor(record[badge.colorField])) {
    const text = badge.textColorField && isHexColor(record[badge.textColorField]) ? record[badge.textColorField] : "#fff";
    return (
      <span className="inline-block rounded px-1.5 py-0.5 font-mono text-xs font-semibold" style={{ background: String(record[badge.colorField]), color: String(text) }}>
        {value}
      </span>
    );
  }
  if (field.type === "color" && isHexColor(value)) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-sm ring-1 ring-kumo-line" style={{ background: value }} aria-hidden="true" />
        <code>{value}</code>
      </span>
    );
  }
  if (field.type === "geometry") {
    const geometry = geometryOf(value);
    if (geometry) {
      const positions = countPositions(geometry);
      return positions ? `${geometry.type} · ${fmt.int(positions)} points` : geometry.type;
    }
  }
  if (field.type === "url" && isText(value) && URL.canParse(value.trim())) return <LinkValue value={value} max={TABLE_LINK} />;
  return fmt.cell(value, field.type);
}

/** The longest link a table cell shows, as for any text: past it, the cell ends in an ellipsis and the whole address is its tooltip. */
const TABLE_LINK = 120;

/**
 * A link as the publisher wrote it, without its scheme: "snit-mais.dgterritorio.gov.pt/SRUP/DL 222_98.pdf". Spaces
 * and other characters an address cannot hold are encoded in the link itself. The text may break after each "/", so
 * a narrow column wraps it between the parts of its path, and inside one only when a part alone is too wide. Cut
 * only when `max` says so, and then with an ellipsis.
 */
export function LinkValue({ value, max }: { value: string; max?: number }) {
  const address = value.trim();
  const text = address.replace(/^https?:\/\//, "");
  const cut = max !== undefined && text.length > max;
  const parts = (cut ? `${text.slice(0, max - 1)}…` : text).split(/(?<=\/)/);
  return (
    <Link href={new URL(address).href} target="_blank" rel="noopener noreferrer" title={cut ? address : undefined} className="[overflow-wrap:break-word]">
      {parts.map((part, index) => (
        // The parts of one address never move, so their position names them.
        <Fragment key={index}>
          {index ? <wbr /> : null}
          {part}
        </Fragment>
      ))}
    </Link>
  );
}

/** What a sortable column compares for a record field. */
export function sortValue(value: JsonValue | undefined): string | number | null {
  if (value === undefined || value === null) return null;
  if (Number.isFinite(value)) return Number(value);
  if (isText(value)) return value;
  if (value === true || value === false) return value ? 1 : 0;
  return JSON.stringify(value);
}

export function seriesLabel(point: SeriesPoint): string {
  if (point.seriesKey === "all") return "Whole network";
  const dimensions = Object.entries(point.dimensions ?? {});
  if (dimensions.length === 0) return point.seriesKey;
  // A value that reads on its own ("Portugal", "Lisboa") stands alone; a bare number needs its dimension's name.
  return dimensions
    .map(([key, value]) => {
      const text = value === null ? "—" : String(value);
      return /^[\d.-]+$/.test(text) && !/^dim_?\d+$/i.test(key) ? `${humanize(key).replace(/ ID$/, "")} ${text}` : text;
    })
    .join(" · ");
}

export const OPERATION_BADGE = new Map<string, "green" | "blue" | "red" | "neutral">([
  ["create", "green"],
  ["baseline", "green"],
  ["upsert", "blue"],
  ["retract", "red"],
]);
