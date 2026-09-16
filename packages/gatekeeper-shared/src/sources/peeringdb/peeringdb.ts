import {
  GatekeeperError, fixedOrigin, isJsonArray, isJsonObject, parseJsonBytes, readBoundedResponse, retryAfterSeconds,
  type FeedKindDescription, type JsonObject, type JsonValue, type SourceConfig, type SourceFetch,
} from "../../index";

export const PEERINGDB_ORIGIN = "https://www.peeringdb.com";
export const PEERINGDB_PAGE_SIZE = 100;
export const PEERINGDB_MAX_RECORDS = 1000;
const MAX_REQUESTS = 11;
export const PEERINGDB_MAX_BYTES = 1024 * 1024;
export const PEERINGDB_PUBLIC_FIELDS = "id,name,name_long,city,country,website,media,proto_unicast,proto_multicast,proto_ipv6,created,updated,status";

export const PEERINGDB_FEEDS = {
  exchanges: {
    kind: "exchanges", title: "Portuguese Internet exchange directory",
    description: "Public non-contact metadata for PeeringDB Internet exchanges in Portugal; no traffic, speed or outage measurements.",
    semantics: { domainSubject: "reference", defaultProductRole: "reference" },
  },
} as const satisfies Record<string, FeedKindDescription>;

export function validatePeeringdbFeedConfig(config: SourceConfig): SourceConfig {
  for (const key of Object.keys(config)) if (key !== "feed" && key !== "country") throw new GatekeeperError(`Unsupported PeeringDB field: ${key}`, "invalid-config");
  if ((config.feed?.trim() ?? "exchanges") !== "exchanges" || config.country?.trim().toUpperCase() !== "PT") throw new GatekeeperError("PeeringDB requires feed=exchanges and country=PT", "invalid-config");
  return { feed: "exchanges", country: "PT" };
}

/** PeeringDB has offset pagination, not documented total/next metadata. Drain to an explicit empty page. */
export async function collectPeeringdbFeed(config: SourceConfig, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  validatePeeringdbFeedConfig(config);
  const origin = fixedOrigin(apiOrigin, PEERINGDB_ORIGIN);
  const base = new URL("/api/ix", origin);
  base.searchParams.set("country", "PT"); base.searchParams.set("status", "ok"); base.searchParams.set("depth", "0");
  base.searchParams.set("fields", PEERINGDB_PUBLIC_FIELDS); base.searchParams.set("limit", String(PEERINGDB_PAGE_SIZE));
  const encoder = new TextEncoder();
  async function* pages(): AsyncGenerator<Uint8Array> {
    yield encoder.encode('{"pages":[');
    let offset = 0;
    let consumedBytes = 0;
    let separator = "";
    for (let page = 0; page < MAX_REQUESTS; page += 1) {
      const url = new URL(base); url.searchParams.set("skip", String(offset));
      let response: Response;
      try { response = await fetcher(url, { headers: { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(30_000) }); }
      catch (error) { throw new GatekeeperError(`PeeringDB request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error"); }
      if (response.status >= 300 && response.status < 400 || response.url && new URL(response.url).origin !== origin) throw new GatekeeperError("PeeringDB redirects and unsolicited 304s are not allowed", "source-denied");
      if (!response.ok) throw new GatekeeperError(`PeeringDB returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
      const bytes = await readBoundedResponse(response, Math.min(256 * 1024, PEERINGDB_MAX_BYTES - consumedBytes), "PeeringDB page");
      consumedBytes += bytes.byteLength;
      let document: JsonValue;
      try { document = parseJsonBytes(bytes); }
      catch { throw new GatekeeperError("PeeringDB page is not JSON", "invalid-response"); }
      const records = pageRecords(document);
      if (records.length > PEERINGDB_PAGE_SIZE || offset + records.length > PEERINGDB_MAX_RECORDS) throw new GatekeeperError("PeeringDB directory exceeds its bounded scope", "response-too-large");
      yield encoder.encode(`${separator}${JSON.stringify(document)}`); separator = ",";
      if (records.length === 0) { yield encoder.encode("]}"); return; }
      offset += records.length;
      // A short page is not assumed to be the last: lower server-side caps must not truncate Portugal.
    }
    throw new GatekeeperError("PeeringDB pagination exceeded eleven requests", "response-too-large");
  }
  const iterator = pages();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try { const result = await iterator.next(); if (result.done) controller.close(); else controller.enqueue(result.value); }
      catch (error) { controller.error(error); }
    },
    async cancel() { await iterator.return(undefined); },
  });
  // One page's validators cannot validate an offset-paginated directory. Every weekly
  // collection reads every page; per-record source timestamps prevent acquisition-time churn.
  return { kind: "body", body, provenance: { sourceUrl: base.toString() }, completeness: "complete", state: {} };
}

export function pageRecords(value: JsonValue | undefined): JsonObject[] {
  if (!isJsonObject(value) || !isJsonArray(value.data) || !value.data.every(isJsonObject)) throw new GatekeeperError("PeeringDB returned an invalid directory envelope", "invalid-response");
  if (value.meta !== undefined) {
    if (!isJsonObject(value.meta)) throw new GatekeeperError("PeeringDB returned invalid metadata", "invalid-response");
    const meta = value.meta;
    if (meta.error !== undefined || meta.errors !== undefined || meta.next !== undefined && meta.next !== null && meta.next !== "" || meta.status !== undefined && meta.status !== "ok" && meta.status !== "success" && meta.status !== 200) throw new GatekeeperError("PeeringDB reported an API error or unsupported continuation", "invalid-response");
  }
  return value.data;
}
