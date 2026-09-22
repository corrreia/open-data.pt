import {
  GatekeeperError,
  contentEtag,
  fixedOrigin,
  readBoundedResponse,
  responseValidator,
  retryAfterSeconds,
  type FeedKindDescription,
  type HistoryCursor,
  type SourceFetch,
  type SourceNotModified,
  type SourceValidator,
  type SourceConfig,
} from "../../../index";
import { marketDateBefore, marketPeriodStart, OMIE_HISTORY_EARLIEST_MARKET_DATE, shiftMarketDate } from "./market-time";

const ALLOWED_ORIGIN = "https://www.omie.es";
const MAX_MISSING_DAYS = 7;

export const OMIE_MAX_BYTES = 1024 * 1024;
export const OMIE_HISTORY_SLICE_DAYS = 7;
export const OMIE_HISTORY_EARLIEST = marketPeriodStart(OMIE_HISTORY_EARLIEST_MARKET_DATE, 1);

export const OMIE_SERIES = ["marginalpdbc", "marginalpdbcpt"] as const;
export type OmieSeries = (typeof OMIE_SERIES)[number];

export const OMIE_FEEDS = {
  prices: {
    kind: "prices",
    title: "Day-ahead electricity prices",
    description: "Hourly through 2025-09-30 and quarter-hourly from 2025-10-01: day-ahead market prices for the Portuguese and Spanish bidding zones.",
    history: {
      // Seven reports stay around 20-80 KB and at most 1,400 points, well below
      // the 1 MiB policy cap while avoiding an overly chatty one-day walk.
      earliest: OMIE_HISTORY_EARLIEST,
    },
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "time-series",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

interface CollectedFile {
  date: string;
  filename: string;
  text: string;
  lastModified?: string;
  url: URL;
}

export function validateOmieFeedConfig(config: SourceConfig): SourceConfig {
  const unsupported = Object.keys(config).filter((key) => key !== "series" && key !== "days");
  if (unsupported.length > 0) {
    throw new GatekeeperError(`OMIE feed configuration does not accept ${unsupported.join(", ")}`, "source-denied");
  }

  if (!isOmieSeries(config.series)) {
    throw new GatekeeperError("OMIE feeds require series=marginalpdbc or marginalpdbcpt", "invalid-config");
  }

  const days = config.days ?? "2";
  if (!/^[1-7]$/u.test(days)) {
    throw new GatekeeperError("OMIE feeds require days to be an integer from 1 to 7", "invalid-config");
  }
  return { series: config.series, days };
}

export async function collectOmieFeed(
  config: SourceConfig,
  checkpoint: SourceValidator | undefined,
  apiOrigin: string,
  fetcher: typeof fetch,
  now: () => Date = () => new Date(),
): Promise<SourceFetch> {
  const validated = validateOmieFeedConfig(config);
  // SAFETY: `validateOmieFeedConfig` has just confirmed `series` names one of
  // the series OMIE_SERIES declares.
  const series = validated.series as OmieSeries;
  const days = Number(validated.days);
  const origin = fixedOrigin(apiOrigin, ALLOWED_ORIGIN);
  const requestHeaders = new Headers({ Accept: "application/octet-stream" });
  if (checkpoint?.etag) requestHeaders.set("If-None-Match", checkpoint.etag);
  if (checkpoint?.lastModified) {
    requestHeaders.set("If-Modified-Since", checkpoint.lastModified);
  }

  const files: CollectedFile[] = [];
  let sourceBytes = 0;
  const candidates = candidateDates(now(), days + MAX_MISSING_DAYS);
  for (const date of candidates) {
    const filename = `${series}_${date.replaceAll("-", "")}.1`;
    const url = downloadUrl(origin, series, filename);
    const response = await fetcher(url, { headers: requestHeaders });
    if (response.status === 304) return notModified(response, checkpoint);
    if (response.status === 404) continue;
    if (!response.ok || !response.body) {
      throw new GatekeeperError(`OMIE returned HTTP ${response.status} for ${filename}`, "upstream-error", retryAfterSeconds(response.headers));
    }

    const remaining = OMIE_MAX_BYTES - sourceBytes;
    if (remaining <= 0) throw tooLarge(filename);
    const bytes = await readBoundedResponse(response, remaining, `OMIE response for ${filename}`);
    sourceBytes += bytes.byteLength;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    } catch {
      throw new GatekeeperError(`OMIE returned non-UTF-8 text for ${filename}`, "invalid-response");
    }
    validateSourceText(text, series, filename);
    const lastModified = response.headers.get("last-modified") ?? undefined;
    const file: CollectedFile = { date, filename, text, url };
    if (lastModified) file.lastModified = lastModified;
    files.push(file);
    if (files.length === days) break;
  }

  if (files.length === 0) {
    throw new GatekeeperError(`OMIE did not publish a ${series} file in the bounded lookup window`, "upstream-error");
  }

  files.sort((left, right) => left.date.localeCompare(right.date));
  const document = {
    series,
    files: files.map(({ date, filename, text }) => ({ date, filename, text })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  if (bytes.byteLength > OMIE_MAX_BYTES) {
    throw new GatekeeperError(`OMIE ${series} response exceeded ${OMIE_MAX_BYTES} bytes`, "response-too-large");
  }

  // The document's content hash is the validator: OMIE files rarely carry one,
  // and an identical document is unchanged whatever the transport says.
  const validator: SourceValidator = { etag: await contentEtag(bytes) };
  const lastModified = latestLastModified(files);
  if (lastModified) validator.lastModified = lastModified;
  if (checkpoint?.etag === validator.etag) return { kind: "not-modified", validator };
  return {
    kind: "body",
    body: bytes,
    provenance: { sourceUrl: files.at(-1)!.url.toString() },
    completeness: files.length === days ? "complete" : "partial",
    validator,
  };
}

/**
 * Collect seven complete market days. The `file-download` tree only retains a
 * rolling archive, so history uses OMIE's stable per-day public report path;
 * both formats are retained in the same `{ series, files }` envelope.
 */
export async function collectOmieHistory(config: SourceConfig, cursor: HistoryCursor, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateOmieFeedConfig(config);
  // SAFETY: `validateOmieFeedConfig` has just confirmed `series` names one of
  // the series OMIE_SERIES declares.
  const series = validated.series as OmieSeries;
  const origin = fixedOrigin(apiOrigin, ALLOWED_ORIGIN);
  const before = new Date(cursor.before);
  if (Number.isNaN(before.getTime())) {
    throw new GatekeeperError("OMIE history requires cursor.before to be an ISO 8601 date-time", "invalid-config");
  }

  const newestDate = marketDateBefore(before);
  const dates = Array.from({ length: OMIE_HISTORY_SLICE_DAYS }, (_, index) => shiftMarketDate(newestDate, -index)).filter((date) => date >= OMIE_HISTORY_EARLIEST_MARKET_DATE);
  const boundaryDate = dates.at(-1);
  if (!boundaryDate) return { kind: "exhausted" };

  const files: CollectedFile[] = [];
  let sourceBytes = 0;
  let missingFiles = 0;
  for (const date of dates) {
    const filename = historyReportFilename(date);
    const url = historyReportUrl(origin, date);
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { Accept: "application/octet-stream" },
      });
    } catch (error) {
      throw new GatekeeperError(`OMIE history request failed for ${filename}: ${error instanceof Error ? error.message : String(error)}`, "upstream-error");
    }
    if (response.status === 404) {
      missingFiles += 1;
      continue;
    }
    if (!response.ok || !response.body) {
      throw new GatekeeperError(`OMIE returned HTTP ${response.status} for ${filename}`, "upstream-error", retryAfterSeconds(response.headers));
    }

    const remaining = OMIE_MAX_BYTES - sourceBytes;
    if (remaining <= 0) throw tooLarge(filename);
    const bytes = await readBoundedResponse(response, remaining, `OMIE response for ${filename}`);
    sourceBytes += bytes.byteLength;
    const text = new TextDecoder("windows-1252", {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes);
    validateHistorySourceText(text, filename, date);
    files.push({ date, filename, text, url });
  }

  if (files.length === 0) return { kind: "exhausted" };
  files.sort((left, right) => left.date.localeCompare(right.date));
  const document = {
    series,
    files: files.map(({ date, filename, text }) => ({ date, filename, text })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  if (bytes.byteLength > OMIE_MAX_BYTES) {
    throw new GatekeeperError(`OMIE ${series} history response exceeded ${OMIE_MAX_BYTES} bytes`, "response-too-large");
  }

  const oldestFile = files[0]!;
  return {
    kind: "body",
    body: bytes,
    provenance: { sourceUrl: oldestFile.url.toString() },
    completeness: missingFiles === 0 ? "complete" : "partial",
    next: { before: marketPeriodStart(boundaryDate, 1) },
  };
}

function historyReportFilename(date: string): string {
  const [year, month, day] = date.split("-");
  return `INT_PBC_EV_H_1_${day}_${month}_${year}_${day}_${month}_${year}.TXT`;
}

function historyReportUrl(origin: string, date: string): URL {
  const [year, month] = date.split("-");
  return new URL(`/sites/default/files/dados/AGNO_${year}/MES_${month}/TXT/${historyReportFilename(date)}`, origin);
}

function validateHistorySourceText(text: string, filename: string, date: string): void {
  const lines = text.split(/\r?\n/u).map((line) => line.trim());
  const [year, month, day] = date.split("-");
  const periodHeader = lines.findIndex((line) => line.startsWith(";"));
  const priceLines = lines
    .slice(periodHeader + 1)
    .filter((line) => line !== "")
    .slice(0, 2);
  if (
    !/^(OMIE|OMEL) - Mercado de electricidad;/u.test(lines[0] ?? "") ||
    (!(lines[0] ?? "").includes(`;${day}/${month}/${year};`) && !(lines[0] ?? "").includes(`;${date};`)) ||
    periodHeader < 0 ||
    priceLines.length !== 2 ||
    priceLines.some((line) => !line.toLocaleLowerCase("es").startsWith("precio marginal"))
  ) {
    throw new GatekeeperError(`OMIE returned an invalid historical price report for ${filename}`, "invalid-response");
  }
}

function isOmieSeries(value: string | undefined): value is OmieSeries {
  return value !== undefined && OMIE_SERIES.some((series) => series === value);
}

function candidateDates(now: Date, count: number): string[] {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Array.from({ length: count }, (_, index) => new Date(start - index * 86_400_000).toISOString().slice(0, 10));
}

function downloadUrl(origin: string, series: OmieSeries, filename: string): URL {
  const url = new URL("/en/file-download", origin);
  url.searchParams.set("parents", series);
  url.searchParams.set("filename", filename);
  return url;
}

/** An upstream 304: the provider's validators win, the checkpoint's fill any gap. */
function notModified(response: Response, checkpoint: SourceValidator | undefined): SourceNotModified {
  const fetched: SourceNotModified = { kind: "not-modified" };
  const validator: SourceValidator = { ...checkpoint, ...responseValidator(response.headers) };
  if (validator.etag || validator.lastModified) fetched.validator = validator;
  return fetched;
}

function tooLarge(filename: string): GatekeeperError {
  return new GatekeeperError(`OMIE response for ${filename} exceeded ${OMIE_MAX_BYTES} bytes`, "response-too-large");
}

function validateSourceText(text: string, series: OmieSeries, filename: string): void {
  const lines = text.split(/\r?\n/u).map((line) => line.trim());
  if (lines[0] !== `${series.toUpperCase()};` || !lines.includes("*")) {
    throw new GatekeeperError(`OMIE returned an invalid price file for ${filename}`, "invalid-response");
  }
}

function latestLastModified(files: CollectedFile[]): string | undefined {
  return files
    .flatMap((file) => {
      if (!file.lastModified) return [];
      const milliseconds = Date.parse(file.lastModified);
      return Number.isNaN(milliseconds) ? [] : [{ value: file.lastModified, milliseconds }];
    })
    .sort((left, right) => left.milliseconds - right.milliseconds)
    .at(-1)?.value;
}
