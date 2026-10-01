import { GatekeeperError } from "#/index";

/** What a point shapefile and its dBASE table hold: each point with one numeric column, and the rows that could not be read. */
export interface PointLayer {
  /** `[x, y, value]` in the shapefile's own coordinates. */
  points: Array<[number, number, number]>;
  /** Rows with a null record, a deleted flag or a value that is not a number. */
  rejected: number;
}

const FILE_CODE = 9994;
const FILE_VERSION = 1000;
const NULL_RECORD = 0;
const POINT_RECORD = 1;
const DBF_HEADER_END = 0x0d;

/**
 * Reads an ESRI point shapefile (`.shp`) together with its dBASE table
 * (`.dbf`), pairing the nth shape with the nth row and taking one numeric
 * column. A file that breaks the format is refused whole; a row that is merely
 * empty is counted and left out.
 */
export function readPointLayer(shp: Uint8Array, dbf: Uint8Array, column: string): PointLayer {
  const positions = readPoints(shp);
  const values = readNumericColumn(dbf, column);
  if (positions.length !== values.length) throw invalid(`its shapefile holds ${positions.length} records and its table ${values.length} rows`);
  const points: Array<[number, number, number]> = [];
  let rejected = 0;
  positions.forEach((position, index) => {
    const value = values[index];
    if (!position || value === undefined) rejected += 1;
    else points.push([position[0], position[1], value]);
  });
  return { points, rejected };
}

function readPoints(bytes: Uint8Array): Array<[number, number] | undefined> {
  if (bytes.byteLength < 100) throw invalid("its shapefile is shorter than a header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getInt32(0, false) !== FILE_CODE || view.getInt32(28, true) !== FILE_VERSION) throw invalid("its shapefile has no shapefile header");
  if (view.getInt32(24, false) * 2 !== bytes.byteLength) throw invalid("its shapefile is not the length its header states");
  const type = view.getInt32(32, true);
  if (type !== POINT_RECORD && type !== NULL_RECORD) throw invalid(`its shapefile holds shape type ${type}, not points`);
  const positions: Array<[number, number] | undefined> = [];
  let offset = 100;
  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) throw invalid("its shapefile ends inside a record header");
    const length = view.getInt32(offset + 4, false) * 2;
    const end = offset + 8 + length;
    if (length < 4 || end > bytes.byteLength) throw invalid("its shapefile has a record past its end");
    const kind = view.getInt32(offset + 8, true);
    if (kind === POINT_RECORD) {
      if (length < 20) throw invalid("its shapefile has a point record too short for a point");
      const x = view.getFloat64(offset + 12, true);
      const y = view.getFloat64(offset + 20, true);
      positions.push(Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined);
    } else if (kind === NULL_RECORD) positions.push(undefined);
    else throw invalid(`its shapefile has a record of shape type ${kind}`);
    offset = end;
  }
  return positions;
}

function readNumericColumn(bytes: Uint8Array, column: string): Array<number | undefined> {
  if (bytes.byteLength < 33) throw invalid("its table is shorter than a header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rows = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const rowLength = view.getUint16(10, true);
  if (headerLength > bytes.byteLength || headerLength + rows * rowLength > bytes.byteLength) throw invalid("its table is shorter than its header states");
  let start: number | undefined;
  let width = 0;
  let fieldOffset = 1;
  for (let at = 32; at + 32 <= headerLength && bytes[at] !== DBF_HEADER_END; at += 32) {
    const name = ascii(bytes.subarray(at, at + 11)).replace(/\0.*$/su, "");
    const type = String.fromCharCode(bytes[at + 11] ?? 0);
    const length = bytes[at + 16] ?? 0;
    if (name.toLowerCase() === column.toLowerCase()) {
      if (type !== "N" && type !== "F") throw invalid(`its column ${column} is not numeric`);
      start = fieldOffset;
      width = length;
    }
    fieldOffset += length;
  }
  if (start === undefined) throw invalid(`its table has no ${column} column`);
  if (fieldOffset > rowLength) throw invalid("its table's columns are wider than its rows");
  const values: Array<number | undefined> = [];
  for (let row = 0; row < rows; row += 1) {
    const at = headerLength + row * rowLength;
    // A row marked `*` was deleted from the table.
    if (bytes[at] === 0x2a) {
      values.push(undefined);
      continue;
    }
    const text = ascii(bytes.subarray(at + start, at + start + width)).trim();
    const value = text === "" ? Number.NaN : Number(text);
    values.push(Number.isFinite(value) ? value : undefined);
  }
  return values;
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function invalid(reason: string): GatekeeperError {
  return new GatekeeperError(`IPMA fire list is malformed: ${reason}`, "invalid-response");
}
