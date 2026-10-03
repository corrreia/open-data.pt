import {
  GatekeeperError,
  contentEtag,
  fixedOrigin,
  invalidResponse,
  isJsonObject,
  isJsonString,
  readBoundedJson,
  readBoundedResponse,
  retryAfterSeconds,
  toByteStream,
  type FeedKindDescription,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
} from "#/index";
// A ZIP is read the way GTFS archives are: entry by entry, bounded, inflating only the one asked for.
import { gtfsZipEntries } from "#/formats/gtfs/zip";

/** STAT.ANACOM, a Microsoft Power Pages site whose Dataverse Web API answers anonymously. */
export const DATAVERSE_API_ORIGIN = "https://stat.anacom.pt";

/**
 * What a browser can open for every indicator: the open-data page that lists their files. A file's own link names a
 * record ID that ANACOM's nightly rebuild may replace, so it is never a link to keep.
 */
export const STAT_OPEN_DATA_PAGE = "https://stat.anacom.pt/en-US/Explora%C3%A7%C3%A3o-de-dados/Dados-abertos/";

/** Largest inflated CSV: the largest of them, the fixed broadband market shares, is about 150 KB. */
export const DATAVERSE_MAX_BYTES = 4 * 1024 * 1024;
/** Largest ZIP: the files compress about tenfold. */
const ARCHIVE_MAX_BYTES = 1024 * 1024;
/** The index answer for one indicator is a few hundred bytes. */
const INDEX_MAX_BYTES = 64 * 1024;

export const DATAVERSE_FEEDS = {
  // One STAT.ANACOM indicator file: every period it covers, one series per breakdown and operator.
  indicator: {
    kind: "indicator",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "time-series",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

/** ANACOM's indicator codes, as the index names them: `IndI_P064`. */
const INDICATOR_CODE = /^IndI_P\d{3}$/;
const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNIT_MAX_LENGTH = 40;

type Fetcher = (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;

/** An indicator feed reads one file. The unit is the feed's to state: ANACOM's CSVs carry none. */
export interface IndicatorConfig {
  indicator: string;
  unit: string;
}

/** A feed's configuration in its canonical form: the indicator's code and the unit its values are in. */
export function validateDataverseFeedConfig(config: SourceConfig): SourceConfig & IndicatorConfig {
  const unknown = Object.keys(config).find((key) => key !== "indicator" && key !== "unit");
  if (unknown) {
    throw new GatekeeperError(`Unsupported STAT.ANACOM configuration field: ${unknown}`, unknown === "host" || unknown === "url" ? "source-denied" : "invalid-config");
  }
  const indicator = config.indicator?.trim() ?? "";
  if (!INDICATOR_CODE.test(indicator)) throw new GatekeeperError("indicator must be a STAT.ANACOM code such as IndI_P064", "invalid-config");
  const unit = config.unit?.trim() ?? "";
  if (unit === "" || unit.length > UNIT_MAX_LENGTH) throw new GatekeeperError(`unit must name what the values count, in at most ${UNIT_MAX_LENGTH} characters`, "invalid-config");
  return { indicator, unit };
}

/**
 * One indicator's file, read in two requests: the index row for its code, which names the file's current record,
 * then the file, a ZIP holding one tab-separated CSV. The record is looked up every time because ANACOM rebuilds the
 * files every night, so neither a stored ID nor `modifiedon` says anything. What is compared instead is the inflated
 * CSV: an unchanged one is `not-modified`, whatever the archive's own timestamps.
 */
export async function collectIndicator(config: SourceConfig, checkpoint: SourceValidator | undefined, apiOrigin: string, fetcher: Fetcher): Promise<SourceFetch> {
  const { indicator } = validateDataverseFeedConfig(config);
  const origin = fixedOrigin(apiOrigin, DATAVERSE_API_ORIGIN);
  const recordId = await indicatorRecord(origin, indicator, fetcher);
  const response = await fetcher(new URL(`/_api/cr8db_stat_popupfileses(${recordId})/cr8db_fileen/$value`, origin), {
    headers: { Accept: "application/zip, application/octet-stream" },
  });
  requireOk(response, `the ${indicator} file`);
  const csv = await csvEntry(await readBoundedResponse(response, ARCHIVE_MAX_BYTES, `STAT.ANACOM ${indicator} archive`), indicator);
  const etag = await contentEtag(csv);
  if (checkpoint?.etag === etag) return { kind: "not-modified", validator: { etag } };
  return {
    kind: "body",
    body: csv,
    provenance: { sourceUrl: STAT_OPEN_DATA_PAGE },
    completeness: "complete",
    validator: { etag },
  };
}

/** The URL of the index row for one indicator: its record ID, code and English file name, nothing else. */
export function indexUrl(origin: string, indicator: string): URL {
  const url = new URL("/_api/cr8db_stat_popupfileses", origin);
  url.searchParams.set("$select", "cr8db_stat_popupfilesid,cr8db_indicador,cr8db_fileen_name");
  url.searchParams.set("$filter", `cr8db_indicador eq '${indicator}'`);
  return url;
}

async function indicatorRecord(origin: string, indicator: string, fetcher: Fetcher): Promise<string> {
  const response = await fetcher(indexUrl(origin, indicator), { headers: { Accept: "application/json" } });
  requireOk(response, "the indicator index");
  const answer = await readBoundedJson(response, INDEX_MAX_BYTES, "STAT.ANACOM indicator index");
  if (!isJsonObject(answer) || !Array.isArray(answer.value)) throw invalidResponse("STAT.ANACOM's index did not answer with an OData value list");
  const rows = answer.value.filter((row) => isJsonObject(row) && row.cr8db_indicador === indicator);
  if (rows.length !== answer.value.length) throw invalidResponse(`STAT.ANACOM's index answered ${indicator} with another indicator's row`);
  const [row, ...others] = rows;
  if (!row || !isJsonObject(row)) throw new GatekeeperError(`STAT.ANACOM no longer lists ${indicator}`, "invalid-config");
  if (others.length > 0) throw invalidResponse(`STAT.ANACOM lists ${indicator} more than once`);
  const id = row.cr8db_stat_popupfilesid;
  if (!isJsonString(id) || !RECORD_ID.test(id)) throw invalidResponse(`STAT.ANACOM's index row for ${indicator} has no record ID`);
  if (row.cr8db_fileen_name !== `${indicator}_EN.zip`) throw invalidResponse(`STAT.ANACOM holds no English file for ${indicator}`);
  return id;
}

/** The archive's one CSV, `<code>_CSV_EN.csv`, inflated under the byte cap. */
async function csvEntry(archive: Uint8Array, indicator: string): Promise<Uint8Array> {
  const name = `${indicator}_csv_en.csv`.toLowerCase();
  const entries = gtfsZipEntries(toByteStream(archive), new Set([name]), { maximumArchiveBytes: ARCHIVE_MAX_BYTES, maximumEntryBytes: DATAVERSE_MAX_BYTES });
  for await (const entry of entries) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of entry.chunks) chunks.push(chunk);
    const csv = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      csv.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return csv;
  }
  throw invalidResponse(`STAT.ANACOM's ${indicator} archive holds no ${indicator}_CSV_EN.csv`);
}

function requireOk(response: Response, what: string): void {
  if (response.ok) return;
  throw new GatekeeperError(`STAT.ANACOM answered HTTP ${response.status} for ${what}`, "upstream-error", retryAfterSeconds(response.headers));
}
