/**
 * Usage baseline: Cloudflare consumption per UTC day and,
 * for the kernel's FeedRunner objects, per feed and per collection.
 *
 *   node tools/usage-report.ts [--days 7] [--from <ISO> --to <ISO>] [--top 30] [--json] [--skip-acquisitions]
 *
 * Strictly read-only: Cloudflare GraphQL Analytics queries plus public GET requests to
 * https://open-data.pt/api. Auth is CLOUDFLARE_API_TOKEN when set, otherwise the Wrangler OAuth
 * token in ~/.config/.wrangler/config/default.toml (`pnpm exec wrangler whoami` refreshes an expired
 * one). The token is never printed.
 *
 * Measured: every Cloudflare number. FeedRunner objects are named after their feed id
 * (`getServerByName(env.FeedRunner, feed.id)`), and the DO analytics `name` dimension carries it, so
 * per-feed attribution is exact. Collection counts come from each runner's last 200 acquisitions
 * (`/api/feeds/<id>/acquisitions`, one small request per runner); spans that list does not reach
 * are filled from policy cadence and labelled as estimates.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const ACCOUNT_ID = "cc05ea77c39684419e087c3b78b5177d";
const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";
const PUBLIC_API = "https://open-data.pt/api";
const KERNEL_SCRIPT = "open-data-pt-kernel";
const PROJECT_PREFIX = "open-data-pt-";
const PROJECT_PREFIX_END = "open-data-pt-~";
const REGISTRY_OBJECT = "main";
const FEED_OBJECT_PREFIX = "feed_";
const ACQUISITION_LIMIT = 200;
const ACQUISITION_CONCURRENCY = 8;
const R2_SQL_MINIMUM_BILLED_BYTES = 10_000_000;
const DAY_MS = 86_400_000;
const ROW_LIMIT = 10_000;
const WINDOW_KEY = "window";

const HELP = `Usage: node tools/usage-report.ts [options]

  --days <n>            completed UTC days to report (default 7); the partial current day is added
  --from <ISO> --to <ISO>
                        extra explicit window (e.g. a healthy post-incident span) reported beside the days
  --top <n>             FeedRunner objects listed per period (default 30)
  --json                print raw and derived numbers as JSON instead of Markdown
  --skip-acquisitions   do not read per-feed acquisition lists; every collection count becomes an estimate
`;

/* ---------- JSON boundary ---------- */

type Json = null | boolean | number | string | Json[] | JsonRecord;
interface JsonRecord {
  [key: string]: Json;
}

function isRecord(value: Json): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isNumber(value: Json): value is number {
  return typeof value === "number";
}
function isString(value: Json): value is string {
  return typeof value === "string";
}
function isBoolean(value: Json): value is boolean {
  return typeof value === "boolean";
}
function field(value: Json, key: string): Json {
  return isRecord(value) ? (value[key] ?? null) : null;
}
function numberAt(value: Json, key: string): number {
  const found = field(value, key);
  if (isNumber(found)) return found;
  if (isString(found) && found.trim() !== "" && Number.isFinite(Number(found))) return Number(found);
  return 0;
}
function textAt(value: Json, key: string): string {
  const found = field(value, key);
  return isString(found) ? found : "";
}
function listAt(value: Json, key: string): Json[] {
  const found = field(value, key);
  return Array.isArray(found) ? found : [];
}
async function readJson(response: Response): Promise<Json> {
  const parsed: Json = JSON.parse(await response.text());
  return parsed;
}

/* ---------- Options and credentials ---------- */

interface Options {
  days: number;
  from: number | null;
  to: number | null;
  top: number;
  json: boolean;
  skipAcquisitions: boolean;
}

function readOptions(nowMs: number): Options {
  const { values } = parseArgs({
    options: {
      days: { type: "string", default: "7" },
      from: { type: "string" },
      to: { type: "string" },
      top: { type: "string", default: "30" },
      json: { type: "boolean", default: false },
      "skip-acquisitions": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  const days = Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("--days must be an integer from 1 to 30");
  const top = Number(values.top);
  if (!Number.isInteger(top) || top < 1) throw new Error("--top must be a positive integer");
  if ((values.from === undefined) !== (values.to === undefined)) throw new Error("--from and --to go together");
  let from: number | null = null;
  let to: number | null = null;
  if (values.from !== undefined && values.to !== undefined) {
    from = Date.parse(values.from);
    to = Math.min(Date.parse(values.to), nowMs);
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to) throw new Error("--from and --to must be ISO instants with from < to");
  }
  return { days, from, to, top, json: values.json, skipAcquisitions: values["skip-acquisitions"] };
}

interface Credentials {
  token: string;
  source: string;
}

function readCredentials(nowMs: number): Credentials {
  const envToken = process.env.CLOUDFLARE_API_TOKEN;
  if (envToken) return { token: envToken, source: "CLOUDFLARE_API_TOKEN" };
  const file = join(homedir(), ".config", ".wrangler", "config", "default.toml");
  const toml = readFileSync(file, "utf8");
  const token = /^oauth_token\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!token) throw new Error(`no oauth_token in ${file}; run \`pnpm exec wrangler login\` or set CLOUDFLARE_API_TOKEN`);
  const expiresAt = /^expiration_time\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (expiresAt && Date.parse(expiresAt) <= nowMs) {
    throw new Error(`the Wrangler OAuth token expired at ${expiresAt}; run \`pnpm exec wrangler whoami\` to refresh it`);
  }
  return { token, source: "wrangler OAuth token" };
}

/* ---------- GraphQL ---------- */

interface RangeVariables {
  account: string;
  from: string;
  to: string;
}

async function queryAccount(credentials: Credentials, query: string, variables: RangeVariables): Promise<JsonRecord> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${credentials.token}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await readJson(response);
  const errors = listAt(body, "errors");
  if (!response.ok || errors.length > 0) {
    const messages = errors.map((error) => textAt(error, "message")).join("; ");
    throw new Error(`GraphQL HTTP ${response.status}: ${messages || "no error message"}`);
  }
  const account = listAt(field(field(body, "data"), "viewer"), "accounts")[0];
  if (account === undefined || !isRecord(account)) throw new Error(`GraphQL returned no account ${ACCOUNT_ID}`);
  return account;
}

function stringList(ids: string[]): string {
  return `[${ids.map((id) => JSON.stringify(id)).join(", ")}]`;
}

const DAILY_HEADER = "query ($account: String!, $from: Date!, $to: Date!) { viewer { accounts(filter: {accountTag: $account}) {";
const WINDOW_HEADER = "query ($account: String!, $from: Time!, $to: Time!) { viewer { accounts(filter: {accountTag: $account}) {";
const FOOTER = "} } }";
const DAILY_RANGE = "date_geq: $from, date_leq: $to";
const WINDOW_RANGE = "datetime_geq: $from, datetime_leq: $to";
const PROJECT_BUCKETS = `bucketName_geq: "${PROJECT_PREFIX}", bucketName_leq: "${PROJECT_PREFIX_END}"`;

function durableObjectSelections(range: string, namespaces: string, dateDimension: string): string {
  return `
  doObjects: durableObjectsPeriodicGroups(limit: ${ROW_LIMIT}, filter: {${range}, namespaceId_in: ${namespaces}}) {
    dimensions { ${dateDimension} namespaceId name objectId }
    sum { duration activeTime cpuTime rowsRead rowsWritten subrequests exceededMemoryErrors exceededCpuErrors }
    max { memoryUsageBytes }
  }
  doInvocations: durableObjectsInvocationsAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {${range}, namespaceId_in: ${namespaces}}) {
    dimensions { ${dateDimension} namespaceId name objectId type }
    sum { requests errors wallTime }
  }`;
}

function dailyQuery(namespaceIds: string[]): string {
  const namespaces = stringList(namespaceIds);
  return `${DAILY_HEADER}
  ${durableObjectSelections(DAILY_RANGE, namespaces, "date")}
  doSqlStorage: durableObjectsSqlStorageGroups(limit: ${ROW_LIMIT}, filter: {${DAILY_RANGE}, namespaceId_in: ${namespaces}}) {
    dimensions { date namespaceId } max { storedBytes }
  }
  r2Operations: r2OperationsAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {${DAILY_RANGE}, ${PROJECT_BUCKETS}}) {
    dimensions { date bucketName actionType } sum { requests responseObjectSize }
  }
  r2Storage: r2StorageAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {${DAILY_RANGE}, ${PROJECT_BUCKETS}}) {
    dimensions { date bucketName } max { payloadSize metadataSize objectCount }
  }
  r2Sql: r2sqlOperationsAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {${DAILY_RANGE}, bucket_geq: "${PROJECT_PREFIX}", bucket_leq: "${PROJECT_PREFIX_END}"}) {
    count dimensions { date bucket table httpStatus } sum { r2BytesRead r2ScannedFiles latencyMs }
  }
  pipelineOperators: pipelinesOperatorAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {${DAILY_RANGE}}) {
    dimensions { date pipelineId streamId } sum { bytesIn recordsIn decodeErrors }
  }
  pipelineIngestion: pipelinesIngestionAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {${DAILY_RANGE}}) {
    dimensions { date pipelineId } sum { ingestedBytes ingestedRecords }
  }
  pipelineDelivery: pipelinesDeliveryAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {${DAILY_RANGE}}) {
    dimensions { date pipelineId } sum { deliveredBytes }
  }
  pipelineSinks: pipelinesSinkAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {${DAILY_RANGE}}) {
    dimensions { date pipelineId } sum { bytesWritten uncompressedBytesWritten recordsWritten filesWritten }
  }
  workers: workersInvocationsAdaptive(limit: ${ROW_LIMIT}, filter: {${DAILY_RANGE}, scriptName_geq: "${PROJECT_PREFIX}", scriptName_leq: "${PROJECT_PREFIX_END}"}) {
    dimensions { date scriptName } sum { requests errors cpuTimeUs duration wallTime subrequests }
  }
  workflows: workflowsAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {${DAILY_RANGE}}) {
    count dimensions { date workflowName } sum { stepCount allStepCount cpuTime executionDuration }
  }
  catalogOperations: r2CatalogDataOperationsAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {${DAILY_RANGE}, warehouseName_geq: "${ACCOUNT_ID}_${PROJECT_PREFIX}", warehouseName_leq: "${ACCOUNT_ID}_${PROJECT_PREFIX_END}"}) {
    count dimensions { date operation }
  }
  catalogMaintenance: r2CatalogTableMaintenanceAdaptiveGroups(limit: ${ROW_LIMIT}, filter: {${DAILY_RANGE}, warehouseName_geq: "${ACCOUNT_ID}_${PROJECT_PREFIX}", warehouseName_leq: "${ACCOUNT_ID}_${PROJECT_PREFIX_END}"}) {
    count dimensions { date jobType } sum { inputBytes outputBytes filesProcessed }
  }
${FOOTER}`;
}

function windowQuery(namespaceIds: string[]): string {
  // Periodic and invocation groups are the only datasets needed for the per-collection window.
  return `${WINDOW_HEADER}${durableObjectSelections(WINDOW_RANGE, stringList(namespaceIds), "")}\n${FOOTER}`;
}

async function discoverKernelNamespaces(credentials: Credentials, variables: RangeVariables): Promise<string[]> {
  const account = await queryAccount(
    credentials,
    `${DAILY_HEADER}
  namespaces: durableObjectsInvocationsAdaptiveGroups(limit: 100, filter: {${DAILY_RANGE}, scriptName: "${KERNEL_SCRIPT}"}) {
    dimensions { namespaceId } sum { requests }
  }
${FOOTER}`,
    variables,
  );
  const ids = listAt(account, "namespaces").map((row) => textAt(field(row, "dimensions"), "namespaceId"));
  return [...new Set(ids.filter((id) => id !== ""))].toSorted();
}

/* ---------- Decoded analytics rows ---------- */

interface DoObjectRow {
  period: string;
  namespaceId: string;
  name: string;
  objectId: string;
  gbSeconds: number;
  activeUs: number;
  cpuUs: number;
  rowsRead: number;
  rowsWritten: number;
  subrequests: number;
  memoryErrors: number;
  cpuErrors: number;
  maxMemoryBytes: number;
}

interface DoInvocationRow {
  period: string;
  namespaceId: string;
  name: string;
  objectId: string;
  type: string;
  requests: number;
  errors: number;
  wallTimeUs: number;
}

function periodOf(dimensions: Json, fixedPeriod: string | null): string {
  return fixedPeriod ?? textAt(dimensions, "date");
}

function decodeDoObjects(rows: Json[], fixedPeriod: string | null): DoObjectRow[] {
  return rows.map((row) => {
    const dimensions = field(row, "dimensions");
    const sum = field(row, "sum");
    return {
      period: periodOf(dimensions, fixedPeriod),
      namespaceId: textAt(dimensions, "namespaceId"),
      name: textAt(dimensions, "name"),
      objectId: textAt(dimensions, "objectId"),
      gbSeconds: numberAt(sum, "duration"),
      activeUs: numberAt(sum, "activeTime"),
      cpuUs: numberAt(sum, "cpuTime"),
      rowsRead: numberAt(sum, "rowsRead"),
      rowsWritten: numberAt(sum, "rowsWritten"),
      subrequests: numberAt(sum, "subrequests"),
      memoryErrors: numberAt(sum, "exceededMemoryErrors"),
      cpuErrors: numberAt(sum, "exceededCpuErrors"),
      maxMemoryBytes: numberAt(field(row, "max"), "memoryUsageBytes"),
    };
  });
}

function decodeDoInvocations(rows: Json[], fixedPeriod: string | null): DoInvocationRow[] {
  return rows.map((row) => {
    const dimensions = field(row, "dimensions");
    const sum = field(row, "sum");
    return {
      period: periodOf(dimensions, fixedPeriod),
      namespaceId: textAt(dimensions, "namespaceId"),
      name: textAt(dimensions, "name"),
      objectId: textAt(dimensions, "objectId"),
      type: textAt(dimensions, "type"),
      requests: numberAt(sum, "requests"),
      errors: numberAt(sum, "errors"),
      wallTimeUs: numberAt(sum, "wallTime"),
    };
  });
}

interface SqlStorageRow {
  date: string;
  namespaceId: string;
  storedBytes: number;
}
interface R2OperationRow {
  date: string;
  bucket: string;
  action: string;
  requests: number;
  objectBytes: number;
}
interface R2StorageRow {
  date: string;
  bucket: string;
  payloadBytes: number;
  metadataBytes: number;
  objects: number;
}
interface R2SqlRow {
  date: string;
  bucket: string;
  table: string;
  httpStatus: number;
  queries: number;
  bytesRead: number;
  filesScanned: number;
  latencyMs: number;
}
interface PipelineOperatorRow {
  date: string;
  pipelineId: string;
  streamId: string;
  bytesIn: number;
  recordsIn: number;
  decodeErrors: number;
}
interface PipelineIngestionRow {
  date: string;
  pipelineId: string;
  bytes: number;
  records: number;
}
interface PipelineSinkRow {
  date: string;
  pipelineId: string;
  bytes: number;
  uncompressedBytes: number;
  records: number;
  files: number;
}
interface WorkerRow {
  date: string;
  script: string;
  requests: number;
  errors: number;
  cpuUs: number;
  gbSeconds: number;
  wallUs: number;
  subrequests: number;
}
interface WorkflowRow {
  date: string;
  workflow: string;
  events: number;
  steps: number;
  allSteps: number;
  cpuMs: number;
  gbSeconds: number;
}
interface CatalogOperationRow {
  date: string;
  operation: string;
  count: number;
}
interface CatalogMaintenanceRow {
  date: string;
  jobType: string;
  jobs: number;
  inputBytes: number;
  outputBytes: number;
  filesProcessed: number;
}

interface DailyAnalytics {
  doObjects: DoObjectRow[];
  doInvocations: DoInvocationRow[];
  doSqlStorage: SqlStorageRow[];
  r2Operations: R2OperationRow[];
  r2Storage: R2StorageRow[];
  r2Sql: R2SqlRow[];
  pipelineOperators: PipelineOperatorRow[];
  pipelineIngestion: PipelineIngestionRow[];
  pipelineDelivery: PipelineIngestionRow[];
  pipelineSinks: PipelineSinkRow[];
  workers: WorkerRow[];
  workflows: WorkflowRow[];
  catalogOperations: CatalogOperationRow[];
  catalogMaintenance: CatalogMaintenanceRow[];
}

function decodeDaily(account: JsonRecord): DailyAnalytics {
  const rows = (alias: string) => listAt(account, alias).map((row) => ({ row, dimensions: field(row, "dimensions"), sum: field(row, "sum"), max: field(row, "max") }));
  return {
    doObjects: decodeDoObjects(listAt(account, "doObjects"), null),
    doInvocations: decodeDoInvocations(listAt(account, "doInvocations"), null),
    doSqlStorage: rows("doSqlStorage").map(({ dimensions, max }) => ({
      date: textAt(dimensions, "date"),
      namespaceId: textAt(dimensions, "namespaceId"),
      storedBytes: numberAt(max, "storedBytes"),
    })),
    r2Operations: rows("r2Operations").map(({ dimensions, sum }) => ({
      date: textAt(dimensions, "date"),
      bucket: textAt(dimensions, "bucketName"),
      action: textAt(dimensions, "actionType"),
      requests: numberAt(sum, "requests"),
      objectBytes: numberAt(sum, "responseObjectSize"),
    })),
    r2Storage: rows("r2Storage").map(({ dimensions, max }) => ({
      date: textAt(dimensions, "date"),
      bucket: textAt(dimensions, "bucketName"),
      payloadBytes: numberAt(max, "payloadSize"),
      metadataBytes: numberAt(max, "metadataSize"),
      objects: numberAt(max, "objectCount"),
    })),
    r2Sql: rows("r2Sql").map(({ row, dimensions, sum }) => ({
      date: textAt(dimensions, "date"),
      bucket: textAt(dimensions, "bucket"),
      table: textAt(dimensions, "table"),
      httpStatus: numberAt(dimensions, "httpStatus"),
      queries: numberAt(row, "count"),
      bytesRead: numberAt(sum, "r2BytesRead"),
      filesScanned: numberAt(sum, "r2ScannedFiles"),
      latencyMs: numberAt(sum, "latencyMs"),
    })),
    pipelineOperators: rows("pipelineOperators").map(({ dimensions, sum }) => ({
      date: textAt(dimensions, "date"),
      pipelineId: textAt(dimensions, "pipelineId"),
      streamId: textAt(dimensions, "streamId"),
      bytesIn: numberAt(sum, "bytesIn"),
      recordsIn: numberAt(sum, "recordsIn"),
      decodeErrors: numberAt(sum, "decodeErrors"),
    })),
    pipelineIngestion: rows("pipelineIngestion").map(({ dimensions, sum }) => ({
      date: textAt(dimensions, "date"),
      pipelineId: textAt(dimensions, "pipelineId"),
      bytes: numberAt(sum, "ingestedBytes"),
      records: numberAt(sum, "ingestedRecords"),
    })),
    pipelineDelivery: rows("pipelineDelivery").map(({ dimensions, sum }) => ({
      date: textAt(dimensions, "date"),
      pipelineId: textAt(dimensions, "pipelineId"),
      bytes: numberAt(sum, "deliveredBytes"),
      records: 0,
    })),
    pipelineSinks: rows("pipelineSinks").map(({ dimensions, sum }) => ({
      date: textAt(dimensions, "date"),
      pipelineId: textAt(dimensions, "pipelineId"),
      bytes: numberAt(sum, "bytesWritten"),
      uncompressedBytes: numberAt(sum, "uncompressedBytesWritten"),
      records: numberAt(sum, "recordsWritten"),
      files: numberAt(sum, "filesWritten"),
    })),
    workers: rows("workers").map(({ dimensions, sum }) => ({
      date: textAt(dimensions, "date"),
      script: textAt(dimensions, "scriptName"),
      requests: numberAt(sum, "requests"),
      errors: numberAt(sum, "errors"),
      cpuUs: numberAt(sum, "cpuTimeUs"),
      gbSeconds: numberAt(sum, "duration"),
      wallUs: numberAt(sum, "wallTime"),
      subrequests: numberAt(sum, "subrequests"),
    })),
    workflows: rows("workflows").map(({ row, dimensions, sum }) => ({
      date: textAt(dimensions, "date"),
      workflow: textAt(dimensions, "workflowName"),
      events: numberAt(row, "count"),
      steps: numberAt(sum, "stepCount"),
      allSteps: numberAt(sum, "allStepCount"),
      cpuMs: numberAt(sum, "cpuTime"),
      gbSeconds: numberAt(sum, "executionDuration"),
    })),
    catalogOperations: rows("catalogOperations").map(({ row, dimensions }) => ({
      date: textAt(dimensions, "date"),
      operation: textAt(dimensions, "operation"),
      count: numberAt(row, "count"),
    })),
    catalogMaintenance: rows("catalogMaintenance").map(({ row, dimensions, sum }) => ({
      date: textAt(dimensions, "date"),
      jobType: textAt(dimensions, "jobType"),
      jobs: numberAt(row, "count"),
      inputBytes: numberAt(sum, "inputBytes"),
      outputBytes: numberAt(sum, "outputBytes"),
      filesProcessed: numberAt(sum, "filesProcessed"),
    })),
  };
}

/* ---------- Feeds, policies, acquisitions (public API) ---------- */

type FeedClass = "minute" | "hourly" | "daily+" | "other";
const FEED_CLASSES: FeedClass[] = ["minute", "hourly", "daily+", "other"];
const FEED_CLASS_LABELS = {
  minute: "minute-cadence current state (cadence ≤ 60 s)",
  hourly: "hourly snapshots (cadence 3600 s)",
  "daily+": "daily or slower (cadence ≥ 86400 s)",
  other: "other cadences (180 s – 21600 s)",
} satisfies Record<FeedClass, string>;

function classify(cadenceSeconds: number | null): FeedClass {
  if (cadenceSeconds === null) return "other";
  if (cadenceSeconds <= 60) return "minute";
  if (cadenceSeconds === 3600) return "hourly";
  if (cadenceSeconds >= 86_400) return "daily+";
  return "other";
}

interface FeedInfo {
  id: string;
  slug: string;
  enabled: boolean;
  createdAt: number;
  cadenceSeconds: number | null;
  feedClass: FeedClass;
}

async function getPublic(path: string): Promise<Json> {
  const response = await fetch(`${PUBLIC_API}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${PUBLIC_API}${path} returned HTTP ${response.status}`);
  return readJson(response);
}

async function loadFeeds(): Promise<FeedInfo[]> {
  const [feeds, policies] = await Promise.all([getPublic("/feeds"), getPublic("/policies")]);
  const cadenceByPolicy = new Map(listAt(policies, "data").map((policy) => [textAt(policy, "id"), numberAt(field(policy, "collection"), "cadenceSeconds")]));
  return listAt(feeds, "data").map((feed) => {
    const cadence = cadenceByPolicy.get(textAt(feed, "policyId"));
    const cadenceSeconds = cadence === undefined || cadence <= 0 ? null : cadence;
    const enabled = field(feed, "enabled");
    return {
      id: textAt(feed, "id"),
      slug: textAt(feed, "slug"),
      enabled: isBoolean(enabled) && enabled,
      createdAt: Date.parse(textAt(feed, "createdAt")),
      cadenceSeconds,
      feedClass: classify(cadenceSeconds),
    };
  });
}

interface AcquisitionHistory {
  available: boolean;
  /** Start of each listed acquisition (startedAt, else requestedAt), epoch ms. */
  times: number[];
  /** Earliest instant from which the list holds every acquisition. */
  coverageStart: number;
}

async function loadAcquisitionHistory(feed: FeedInfo): Promise<AcquisitionHistory> {
  try {
    const body = await getPublic(`/feeds/${encodeURIComponent(feed.id)}/acquisitions?limit=${ACQUISITION_LIMIT}`);
    const times = listAt(body, "data")
      .map((acquisition) => Date.parse(textAt(acquisition, "startedAt") || textAt(acquisition, "requestedAt")))
      .filter((time) => !Number.isNaN(time));
    // The runner keeps its last 500; fewer than the page limit means the list reaches back to creation.
    const coverageStart = times.length < ACQUISITION_LIMIT ? feed.createdAt : Math.min(...times);
    return { available: true, times, coverageStart };
  } catch {
    return { available: false, times: [], coverageStart: Number.POSITIVE_INFINITY };
  }
}

async function loadAcquisitionHistories(feeds: FeedInfo[]): Promise<Map<string, AcquisitionHistory>> {
  const histories = new Map<string, AcquisitionHistory>();
  const queue = [...feeds];
  const worker = async () => {
    for (let feed = queue.shift(); feed !== undefined; feed = queue.shift()) {
      histories.set(feed.id, await loadAcquisitionHistory(feed));
    }
  };
  await Promise.all(Array.from({ length: ACQUISITION_CONCURRENCY }, worker));
  return histories;
}

interface CollectionCount {
  measured: number;
  estimated: number;
}

function countCollections(feed: FeedInfo, history: AcquisitionHistory | undefined, period: Period, nowMs: number): CollectionCount {
  const liveStart = Math.max(period.start, feed.createdAt);
  const liveEnd = Math.min(period.end, nowMs);
  if (Number.isNaN(liveStart) || liveEnd <= liveStart) return { measured: 0, estimated: 0 };
  const coverageStart = history?.available ? history.coverageStart : Number.POSITIVE_INFINITY;
  const measuredFrom = Math.max(liveStart, coverageStart);
  const measured = (history?.times ?? []).filter((time) => time >= measuredFrom && time < liveEnd).length;
  const uncoveredMs = Math.max(0, Math.min(liveEnd, coverageStart) - liveStart);
  const estimated = uncoveredMs > 0 ? (uncoveredMs / 1000) * collectionRate(feed, history, nowMs) : 0;
  return { measured, estimated };
}

/**
 * Collections per second for spans the acquisition list does not reach: the rate observed where the
 * list does reach, when that covers at least ten cadences, otherwise the policy cadence.
 */
function collectionRate(feed: FeedInfo, history: AcquisitionHistory | undefined, nowMs: number): number {
  if (!feed.enabled || feed.cadenceSeconds === null) return 0;
  if (history?.available) {
    const coveredSeconds = (nowMs - history.coverageStart) / 1000;
    if (coveredSeconds >= 10 * feed.cadenceSeconds) return history.times.length / coveredSeconds;
  }
  return 1 / feed.cadenceSeconds;
}

/* ---------- Periods and aggregation ---------- */

interface Period {
  key: string;
  label: string;
  start: number;
  end: number;
  partial: boolean;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function utcMinute(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function buildPeriods(options: Options, nowMs: number): Period[] {
  const todayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const periods: Period[] = [];
  for (let day = options.days; day >= 1; day -= 1) {
    const start = todayStart - day * DAY_MS;
    periods.push({ key: utcDay(start), label: utcDay(start), start, end: start + DAY_MS, partial: false });
  }
  periods.push({
    key: utcDay(todayStart),
    label: `${utcDay(todayStart)} (partial to ${utcMinute(nowMs).slice(11)}Z)`,
    start: todayStart,
    end: nowMs,
    partial: true,
  });
  if (options.from !== null && options.to !== null) {
    periods.push({
      key: WINDOW_KEY,
      label: `window ${utcMinute(options.from)}–${utcMinute(options.to)}Z`,
      start: options.from,
      end: options.to,
      partial: true,
    });
  }
  return periods;
}

type NamespaceRole = "Registry" | "FeedRunner" | "kernel (unclassified)";

function namespaceRoles(namespaceIds: string[], objects: DoObjectRow[]): Map<string, NamespaceRole> {
  const roles = new Map<string, NamespaceRole>();
  for (const namespaceId of namespaceIds) {
    const names = objects.filter((row) => row.namespaceId === namespaceId).map((row) => row.name);
    const role = names.includes(REGISTRY_OBJECT) ? "Registry" : names.some((name) => name.startsWith(FEED_OBJECT_PREFIX)) ? "FeedRunner" : "kernel (unclassified)";
    roles.set(namespaceId, role);
  }
  return roles;
}

interface DoTotals {
  requests: number;
  alarms: number;
  rpc: number;
  otherRequests: number;
  errors: number;
  wallUs: number;
  gbSeconds: number;
  activeUs: number;
  cpuUs: number;
  rowsRead: number;
  rowsWritten: number;
  subrequests: number;
  memoryErrors: number;
  maxMemoryBytes: number;
}

function emptyTotals(): DoTotals {
  return {
    requests: 0,
    alarms: 0,
    rpc: 0,
    otherRequests: 0,
    errors: 0,
    wallUs: 0,
    gbSeconds: 0,
    activeUs: 0,
    cpuUs: 0,
    rowsRead: 0,
    rowsWritten: 0,
    subrequests: 0,
    memoryErrors: 0,
    maxMemoryBytes: 0,
  };
}

function addPeriodic(totals: DoTotals, row: DoObjectRow): void {
  totals.gbSeconds += row.gbSeconds;
  totals.activeUs += row.activeUs;
  totals.cpuUs += row.cpuUs;
  totals.rowsRead += row.rowsRead;
  totals.rowsWritten += row.rowsWritten;
  totals.subrequests += row.subrequests;
  totals.memoryErrors += row.memoryErrors;
  totals.maxMemoryBytes = Math.max(totals.maxMemoryBytes, row.maxMemoryBytes);
}

function addInvocation(totals: DoTotals, row: DoInvocationRow): void {
  totals.requests += row.requests;
  totals.errors += row.errors;
  totals.wallUs += row.wallTimeUs;
  if (row.type === "alarm") totals.alarms += row.requests;
  else if (row.type === "jsrpc") totals.rpc += row.requests;
  else totals.otherRequests += row.requests;
}

function mergeTotals(target: DoTotals, source: DoTotals): void {
  target.requests += source.requests;
  target.alarms += source.alarms;
  target.rpc += source.rpc;
  target.otherRequests += source.otherRequests;
  target.errors += source.errors;
  target.wallUs += source.wallUs;
  target.gbSeconds += source.gbSeconds;
  target.activeUs += source.activeUs;
  target.cpuUs += source.cpuUs;
  target.rowsRead += source.rowsRead;
  target.rowsWritten += source.rowsWritten;
  target.subrequests += source.subrequests;
  target.memoryErrors += source.memoryErrors;
  target.maxMemoryBytes = Math.max(target.maxMemoryBytes, source.maxMemoryBytes);
}

interface ObjectUsage {
  period: string;
  namespaceId: string;
  role: NamespaceRole;
  objectId: string;
  name: string;
  feed: FeedInfo | null;
  totals: DoTotals;
}

function objectUsage(objects: DoObjectRow[], invocations: DoInvocationRow[], roles: Map<string, NamespaceRole>, feedsById: Map<string, FeedInfo>): ObjectUsage[] {
  const usage = new Map<string, ObjectUsage>();
  const entry = (period: string, namespaceId: string, objectId: string, name: string) => {
    const key = `${period}|${objectId}`;
    let found = usage.get(key);
    if (found === undefined) {
      found = {
        period,
        namespaceId,
        role: roles.get(namespaceId) ?? "kernel (unclassified)",
        objectId,
        name,
        feed: null,
        totals: emptyTotals(),
      };
      usage.set(key, found);
    }
    if (found.name === "" && name !== "") found.name = name;
    return found;
  };
  for (const row of objects) addPeriodic(entry(row.period, row.namespaceId, row.objectId, row.name).totals, row);
  for (const row of invocations) addInvocation(entry(row.period, row.namespaceId, row.objectId, row.name).totals, row);
  for (const item of usage.values()) item.feed = feedsById.get(item.name) ?? null;
  return [...usage.values()];
}

interface NamespaceDay {
  period: string;
  namespaceId: string;
  role: NamespaceRole;
  objects: number;
  storedBytes: number | null;
  totals: DoTotals;
}

function namespaceDays(usage: ObjectUsage[], sqlStorage: SqlStorageRow[]): NamespaceDay[] {
  const days = new Map<string, NamespaceDay>();
  for (const item of usage) {
    const key = `${item.period}|${item.namespaceId}`;
    let day = days.get(key);
    if (day === undefined) {
      day = { period: item.period, namespaceId: item.namespaceId, role: item.role, objects: 0, storedBytes: null, totals: emptyTotals() };
      days.set(key, day);
    }
    day.objects += 1;
    mergeTotals(day.totals, item.totals);
  }
  for (const row of sqlStorage) {
    const day = days.get(`${row.date}|${row.namespaceId}`);
    if (day !== undefined) day.storedBytes = Math.max(day.storedBytes ?? 0, row.storedBytes);
  }
  return [...days.values()].toSorted((a, b) => a.period.localeCompare(b.period) || a.role.localeCompare(b.role));
}

interface ClassUsage {
  period: string;
  feedClass: FeedClass;
  feedsWithUsage: number;
  collections: CollectionCount;
  totals: DoTotals;
}

interface FeedPeriodUsage {
  period: string;
  feed: FeedInfo;
  objectId: string;
  collections: CollectionCount;
  totals: DoTotals;
}

interface FeedAttribution {
  classes: ClassUsage[];
  feeds: FeedPeriodUsage[];
  unattributed: ObjectUsage[];
}

function attributeFeeds(periods: Period[], usage: ObjectUsage[], feeds: FeedInfo[], histories: Map<string, AcquisitionHistory>, nowMs: number): FeedAttribution {
  const classes: ClassUsage[] = [];
  const perFeed: FeedPeriodUsage[] = [];
  for (const period of periods) {
    const runners = new Map(usage.filter((item) => item.period === period.key && item.role === "FeedRunner" && item.feed !== null).map((item) => [item.name, item]));
    for (const feedClass of FEED_CLASSES) {
      const summary: ClassUsage = { period: period.key, feedClass, feedsWithUsage: 0, collections: { measured: 0, estimated: 0 }, totals: emptyTotals() };
      for (const feed of feeds.filter((candidate) => candidate.feedClass === feedClass)) {
        const collections = countCollections(feed, histories.get(feed.id), period, nowMs);
        summary.collections.measured += collections.measured;
        summary.collections.estimated += collections.estimated;
        const runner = runners.get(feed.id);
        if (runner === undefined) continue;
        summary.feedsWithUsage += 1;
        mergeTotals(summary.totals, runner.totals);
        perFeed.push({ period: period.key, feed, objectId: runner.objectId, collections, totals: runner.totals });
      }
      classes.push(summary);
    }
  }
  const unattributed = usage.filter((item) => item.role === "FeedRunner" && item.feed === null);
  return { classes, feeds: perFeed, unattributed };
}

/* ---------- R2, pipelines ---------- */

type R2Class = "A" | "B" | "free";

/** R2 pricing classes: deletes and aborts are free; reads (Get*, Head*, UsageSummary) are Class B; writes and lists are Class A. */
function r2Class(action: string): R2Class {
  if (action.startsWith("Delete") || action.startsWith("Abort")) return "free";
  if (action.startsWith("Get") || action.startsWith("Head") || action === "UsageSummary") return "B";
  return "A";
}

interface R2BucketDay {
  date: string;
  bucket: string;
  classA: number;
  classB: number;
  free: number;
  putObjectBytes: number;
  getObjectBytes: number;
  storedBytes: number | null;
  objects: number | null;
  classAByAction: Record<string, number>;
}

function r2BucketDays(operations: R2OperationRow[], storage: R2StorageRow[]): R2BucketDay[] {
  const days = new Map<string, R2BucketDay>();
  const day = (date: string, bucket: string) => {
    const key = `${date}|${bucket}`;
    let found = days.get(key);
    if (found === undefined) {
      found = { date, bucket, classA: 0, classB: 0, free: 0, putObjectBytes: 0, getObjectBytes: 0, storedBytes: null, objects: null, classAByAction: {} };
      days.set(key, found);
    }
    return found;
  };
  for (const row of operations) {
    const found = day(row.date, row.bucket);
    const pricing = r2Class(row.action);
    if (pricing === "A") {
      found.classA += row.requests;
      found.classAByAction[row.action] = (found.classAByAction[row.action] ?? 0) + row.requests;
    } else if (pricing === "B") found.classB += row.requests;
    else found.free += row.requests;
    if (row.action === "PutObject" || row.action === "CompleteMultipartUpload") found.putObjectBytes += row.objectBytes;
    if (row.action === "GetObject") found.getObjectBytes += row.objectBytes;
  }
  for (const row of storage) {
    if (row.payloadBytes === 0 && row.objects === 0 && !days.has(`${row.date}|${row.bucket}`)) continue;
    const found = day(row.date, row.bucket);
    found.storedBytes = Math.max(found.storedBytes ?? 0, row.payloadBytes + row.metadataBytes);
    found.objects = Math.max(found.objects ?? 0, row.objects);
  }
  return [...days.values()].toSorted((a, b) => a.date.localeCompare(b.date) || a.bucket.localeCompare(b.bucket));
}

/** Kernel lake bindings (`"binding": "LAKE_RECORDS", "stream": "<id>"`), read from the checked-in Wrangler config. */
function lakeStreamBindings(): Map<string, string> {
  const bindings = new Map<string, string>();
  try {
    const config = readFileSync(new URL("../apps/kernel/wrangler.jsonc", import.meta.url), "utf8");
    for (const match of config.matchAll(/"binding"\s*:\s*"(LAKE_[A-Z_]+)"\s*,\s*"stream"\s*:\s*"([0-9a-f]+)"/g)) {
      const [, binding, stream] = match;
      if (binding !== undefined && stream !== undefined) bindings.set(stream, binding);
    }
  } catch {
    // Without the config the report names pipelines by id only.
  }
  return bindings;
}

interface PipelineDay {
  date: string;
  pipelineId: string;
  label: string;
  streamBytesIn: number;
  streamRecordsIn: number;
  operatorBytesIn: number;
  operatorRecordsIn: number;
  decodeErrors: number;
  sinkBytes: number;
  sinkUncompressedBytes: number;
  sinkRecords: number;
  sinkFiles: number;
}

function pipelineDays(daily: DailyAnalytics, bindings: Map<string, string>): PipelineDay[] {
  const streamByPipeline = new Map<string, string>();
  for (const row of daily.pipelineOperators) if (row.streamId !== "") streamByPipeline.set(row.pipelineId, row.streamId);
  const label = (pipelineId: string) => {
    const stream = streamByPipeline.get(pipelineId);
    const binding = stream === undefined ? undefined : bindings.get(stream);
    if (binding !== undefined) return `${binding.slice("LAKE_".length).toLowerCase()} (${binding}, pipeline ${pipelineId.slice(0, 8)})`;
    return `pipeline ${pipelineId.slice(0, 8)} (not a current kernel binding${stream === undefined ? "" : `; stream ${stream.slice(0, 8)}`})`;
  };
  const days = new Map<string, PipelineDay>();
  const day = (date: string, pipelineId: string) => {
    const key = `${date}|${pipelineId}`;
    let found = days.get(key);
    if (found === undefined) {
      found = {
        date,
        pipelineId,
        label: label(pipelineId),
        streamBytesIn: 0,
        streamRecordsIn: 0,
        operatorBytesIn: 0,
        operatorRecordsIn: 0,
        decodeErrors: 0,
        sinkBytes: 0,
        sinkUncompressedBytes: 0,
        sinkRecords: 0,
        sinkFiles: 0,
      };
      days.set(key, found);
    }
    return found;
  };
  for (const row of daily.pipelineOperators) {
    const found = day(row.date, row.pipelineId);
    if (row.streamId === "") {
      found.operatorBytesIn += row.bytesIn;
      found.operatorRecordsIn += row.recordsIn;
    } else {
      found.streamBytesIn += row.bytesIn;
      found.streamRecordsIn += row.recordsIn;
    }
    found.decodeErrors += row.decodeErrors;
  }
  for (const row of daily.pipelineSinks) {
    const found = day(row.date, row.pipelineId);
    found.sinkBytes += row.bytes;
    found.sinkUncompressedBytes += row.uncompressedBytes;
    found.sinkRecords += row.records;
    found.sinkFiles += row.files;
  }
  return [...days.values()].toSorted((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label));
}

/* ---------- Formatting ---------- */

const integerFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatInteger(value: number): string {
  return integerFormat.format(Math.round(value));
}
function formatDecimal(value: number, digits: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}
function formatBytes(value: number | null): string {
  if (value === null) return "–";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1000 && unit < units.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? formatInteger(scaled) : formatDecimal(scaled, 2)} ${units[unit]}`;
}
function perUnit(value: number, units: number, digits: number): string {
  return units > 0 ? formatDecimal(value / units, digits) : "–";
}
function ratio(numerator: number, denominator: number): string {
  return denominator > 0 ? `${formatDecimal(numerator / denominator, 1)}×` : "–";
}
function seconds(microseconds: number): number {
  return microseconds / 1_000_000;
}
function collectionsText(count: CollectionCount): string {
  const total = count.measured + count.estimated;
  if (count.estimated === 0) return formatInteger(total);
  if (count.measured === 0) return `≈${formatInteger(total)} (est.)`;
  return `≈${formatInteger(total)} (${formatInteger(count.estimated)} est.)`;
}

function markdownTable(headers: string[], rows: string[][], textColumns: number): string[] {
  if (rows.length === 0) return ["_No rows._", ""];
  const escape = (cell: string) => cell.replaceAll("|", "\\|");
  const align = headers.map((_, index) => (index < textColumns ? "---" : "---:"));
  return [`| ${headers.map(escape).join(" | ")} |`, `| ${align.join(" | ")} |`, ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`), ""];
}

/* ---------- Report ---------- */

interface Report {
  generatedAt: string;
  credentialSource: string;
  periods: Period[];
  kernelNamespaces: { namespaceId: string; role: NamespaceRole }[];
  namespaceDays: NamespaceDay[];
  objects: ObjectUsage[];
  attribution: FeedAttribution;
  acquisitionsRead: number;
  acquisitionsUnavailable: string[];
  r2: R2BucketDay[];
  pipelines: PipelineDay[];
  daily: DailyAnalytics;
  gbSecondsPerActiveSecond: number | null;
}

function periodLabel(periods: Period[], key: string): string {
  return periods.find((period) => period.key === key)?.label ?? key;
}

function doSection(report: Report): string[] {
  const rows = report.namespaceDays.map((day) => [
    periodLabel(report.periods, day.period),
    day.role,
    formatInteger(day.objects),
    formatInteger(day.totals.requests),
    formatInteger(day.totals.alarms),
    formatInteger(day.totals.rpc),
    formatDecimal(day.totals.gbSeconds, 1),
    formatInteger(seconds(day.totals.activeUs)),
    formatDecimal(seconds(day.totals.cpuUs), 1),
    ratio(day.totals.activeUs, day.totals.cpuUs),
    formatInteger(day.totals.rowsRead),
    formatInteger(day.totals.rowsWritten),
    formatBytes(day.storedBytes),
    formatInteger(day.totals.memoryErrors),
  ]);
  const factor = report.gbSecondsPerActiveSecond;
  return [
    "## Durable Objects: kernel namespaces per UTC day",
    "",
    `Measured (\`durableObjectsPeriodicGroups\` + \`durableObjectsInvocationsAdaptiveGroups\` + \`durableObjectsSqlStorageGroups\`). GB-s is Cloudflare's own \`sum.duration\`; ` +
      `\`sum.activeTime\` and \`sum.cpuTime\` are microseconds. Observed GB-s per active second: ${factor === null ? "–" : formatDecimal(factor, 4)} ` +
      "(128 MB taken as 0.128 GB; a 0.125 conversion would read 2.3% lower). Requests include every caller's RPCs, including gatekeeper callbacks into FeedRunner objects. " +
      "Active time is wall time inside requests and alarms (the kernel does not sleep inside handlers), so active time far above CPU time is time spent awaiting I/O.",
    "",
    ...markdownTable(
      ["UTC day", "Namespace", "Objects", "Requests", "Alarms", "RPC", "GB-s", "Active s", "CPU s", "Active:CPU", "Rows read", "Rows written", "SQLite stored", "OOM"],
      rows,
      2,
    ),
  ];
}

function topObjectsSection(report: Report, top: number): string[] {
  const lines = ["## FeedRunner objects: top by GB-s per period", ""];
  lines.push(
    "Object names are feed ids, so the feed column is exact. Collections are counted from the runner's acquisition list; `est.` marks the part filled from policy cadence.",
    "",
  );
  for (const period of report.periods) {
    const runners = report.objects.filter((item) => item.period === period.key && item.role === "FeedRunner").toSorted((a, b) => b.totals.gbSeconds - a.totals.gbSeconds);
    if (runners.length === 0) continue;
    const totalGbSeconds = runners.reduce((total, item) => total + item.totals.gbSeconds, 0);
    lines.push(`### ${period.label}: ${formatInteger(runners.length)} runners, ${formatDecimal(totalGbSeconds, 1)} GB-s`, "");
    const rows = runners.slice(0, top).map((item) => {
      const feedUsage = report.attribution.feeds.find((candidate) => candidate.period === period.key && candidate.objectId === item.objectId);
      const collections = feedUsage?.collections ?? { measured: 0, estimated: 0 };
      const count = collections.measured + collections.estimated;
      return [
        item.feed?.slug ?? `${item.name || "(unnamed)"} (not a current feed)`,
        item.feed?.feedClass ?? "–",
        item.objectId.slice(0, 12),
        item.feed?.cadenceSeconds === null || item.feed === null ? "–" : formatInteger(item.feed.cadenceSeconds),
        formatInteger(item.totals.requests),
        formatInteger(item.totals.alarms),
        formatDecimal(item.totals.gbSeconds, 1),
        formatDecimal(seconds(item.totals.cpuUs), 1),
        ratio(item.totals.activeUs, item.totals.cpuUs),
        formatInteger(item.totals.rowsWritten),
        collectionsText(collections),
        perUnit(item.totals.gbSeconds, count, 2),
      ];
    });
    lines.push(
      ...markdownTable(
        ["Feed", "Class", "Object id", "Cadence s", "Requests", "Alarms", "GB-s", "CPU s", "Active:CPU", "Rows written", "Collections", "GB-s / collection"],
        rows,
        3,
      ),
    );
  }
  return lines;
}

function perCollectionSection(report: Report): string[] {
  const rows = report.attribution.classes
    .filter((summary) => summary.feedsWithUsage > 0 || summary.collections.measured + summary.collections.estimated > 0)
    .map((summary) => {
      const count = summary.collections.measured + summary.collections.estimated;
      return [
        periodLabel(report.periods, summary.period),
        summary.feedClass,
        formatInteger(summary.feedsWithUsage),
        collectionsText(summary.collections),
        formatDecimal(summary.totals.gbSeconds, 1),
        perUnit(summary.totals.gbSeconds, count, 3),
        perUnit(seconds(summary.totals.activeUs), count, 2),
        perUnit(seconds(summary.totals.cpuUs) * 1000, count, 1),
        ratio(summary.totals.activeUs, summary.totals.cpuUs),
        perUnit(summary.totals.requests, count, 2),
        perUnit(summary.totals.rowsRead, count, 1),
        perUnit(summary.totals.rowsWritten, count, 1),
      ];
    });
  return [
    "## Per collection, by feed class",
    "",
    ...FEED_CLASSES.map((feedClass) => `- **${feedClass}**: ${FEED_CLASS_LABELS[feedClass]}`),
    "",
    "Measured: FeedRunner GB-s, active and CPU time, requests, rows (sum over the class's runner objects). " +
      "Collections: measured from acquisition lists where they reach, estimated from cadence elsewhere (marked `≈`/`est.`). " +
      "Per-collection values divide measured usage by that count.",
    "",
    ...markdownTable(
      [
        "Period",
        "Class",
        "Feeds",
        "Collections",
        "GB-s",
        "GB-s / coll.",
        "Active s / coll.",
        "CPU ms / coll.",
        "Active:CPU",
        "Requests / coll.",
        "Rows read / coll.",
        "Rows written / coll.",
      ],
      rows,
      2,
    ),
  ];
}

function r2Section(report: Report): string[] {
  const rows = report.r2.map((day) => [
    periodLabel(report.periods, day.date),
    day.bucket,
    formatInteger(day.classA),
    formatInteger(day.classB),
    formatInteger(day.free),
    formatBytes(day.putObjectBytes),
    formatBytes(day.getObjectBytes),
    formatBytes(day.storedBytes),
    day.objects === null ? "–" : formatInteger(day.objects),
    Object.entries(day.classAByAction)
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([action, count]) => `${action} ${formatInteger(count)}`)
      .join(", "),
  ]);
  return [
    "## R2 per bucket per UTC day",
    "",
    "Measured (`r2OperationsAdaptiveGroups` by `actionType`, `r2StorageAdaptiveGroups` max). Class A = writes and lists " +
      "(Put*, CreateMultipartUpload, UploadPart, CompleteMultipartUpload, Copy*, List*); Class B = Get*, Head*; deletes and aborts free. " +
      "Written bytes are object sizes of PutObject + CompleteMultipartUpload, not resident storage. Adaptive data may be sampled.",
    "",
    ...markdownTable(["UTC day", "Bucket", "Class A", "Class B", "Free", "Written", "Read", "Stored (max)", "Objects", "Top Class A actions"], rows, 2),
  ];
}

function pipelinesSection(report: Report): string[] {
  const rows = report.pipelines.map((day) => [
    periodLabel(report.periods, day.date),
    day.label,
    formatBytes(day.streamBytesIn),
    formatInteger(day.streamRecordsIn),
    formatBytes(day.operatorBytesIn),
    formatInteger(day.sinkRecords),
    formatBytes(day.sinkUncompressedBytes),
    formatBytes(day.sinkBytes),
    formatInteger(day.sinkFiles),
    formatInteger(day.decodeErrors),
  ]);
  const ingestion = report.daily.pipelineIngestion.length;
  const delivery = report.daily.pipelineDelivery.length;
  return [
    "## Pipelines per UTC day",
    "",
    "Measured, account-wide. Ingest = `pipelinesOperatorAdaptiveGroups` rows that carry a `streamId` (stream → pipeline); " +
      "operator rows without a `streamId` are shown separately because the dataset does not say which stage they are. " +
      "Delivered = `pipelinesSinkAdaptiveGroups` (records, bytes before and after compression, Parquet files). " +
      `\`pipelinesIngestionAdaptiveGroups\` returned ${formatInteger(ingestion)} rows and \`pipelinesDeliveryAdaptiveGroups\` ${formatInteger(delivery)} rows for this range.`,
    "",
    ...markdownTable(
      [
        "UTC day",
        "Pipeline",
        "Stream bytes in",
        "Stream records in",
        "Operator bytes in (no stream)",
        "Sink records",
        "Sink bytes (raw)",
        "Sink bytes (compressed)",
        "Files",
        "Decode errors",
      ],
      rows,
      2,
    ),
  ];
}

function r2SqlSection(report: Report): string[] {
  const grouped = new Map<string, R2SqlRow>();
  for (const row of report.daily.r2Sql) {
    const key = `${row.date}|${row.bucket}|${row.table}`;
    const found = grouped.get(key) ?? { ...row, httpStatus: 0, queries: 0, bytesRead: 0, filesScanned: 0, latencyMs: 0 };
    found.queries += row.queries;
    found.bytesRead += row.bytesRead;
    found.filesScanned += row.filesScanned;
    found.latencyMs += row.latencyMs;
    if (row.httpStatus !== 200) found.httpStatus += row.queries;
    grouped.set(key, found);
  }
  const rows = [...grouped.values()]
    .toSorted((a, b) => a.date.localeCompare(b.date) || a.bucket.localeCompare(b.bucket) || a.table.localeCompare(b.table))
    .map((row) => [
      periodLabel(report.periods, row.date),
      row.bucket,
      row.table || "(none)",
      formatInteger(row.queries),
      formatInteger(row.httpStatus),
      formatBytes(row.bytesRead),
      formatInteger(row.filesScanned),
      formatBytes(Math.max(row.bytesRead, row.queries * R2_SQL_MINIMUM_BILLED_BYTES)),
      perUnit(row.latencyMs, row.queries, 0),
    ]);
  return [
    "## R2 SQL per UTC day",
    "",
    "Measured: `r2sqlOperationsAdaptiveGroups` `count` and `sum.r2BytesRead` (compressed bytes read from R2). " +
      "Estimated: the billing floor column applies the 10 MB per-query minimum as max(bytes read, queries × 10 MB); the exact billed-bytes definition is not exposed.",
    "",
    ...markdownTable(["UTC day", "Bucket", "Table", "Queries", "Non-200", "Bytes read", "Files scanned", "Billing floor (est.)", "Mean latency ms"], rows, 3),
  ];
}

function workersSection(report: Report): string[] {
  const rows = report.daily.workers
    .toSorted((a, b) => a.date.localeCompare(b.date) || b.requests - a.requests)
    .map((row) => [
      periodLabel(report.periods, row.date),
      row.script,
      formatInteger(row.requests),
      formatInteger(row.errors),
      formatDecimal(seconds(row.cpuUs), 1),
      perUnit(seconds(row.cpuUs) * 1000, row.requests, 1),
      formatDecimal(row.gbSeconds, 1),
      formatInteger(row.subrequests),
    ]);
  return [
    "## Workers per script per UTC day",
    "",
    "Measured (`workersInvocationsAdaptive`; Durable Object work is in the DO tables). Adaptive data may be sampled. " +
      "Gap: gatekeeper RPC entrypoints called from FeedRunner objects were absent from this dataset in the 2026-09-10 baseline " +
      "(their callbacks into the runner do appear as DO `jsrpc` requests with the gatekeeper as `scriptName`), so gatekeeper CPU per collection is not measured here.",
    "",
    ...markdownTable(["UTC day", "Script", "Requests", "Errors", "CPU s", "CPU ms / request", "GB-s", "Subrequests"], rows, 2),
  ];
}

function workflowsAndCatalogSection(report: Report): string[] {
  const workflows = report.daily.workflows.map((row) => [
    periodLabel(report.periods, row.date),
    row.workflow,
    formatInteger(row.events),
    formatInteger(row.steps),
    formatInteger(row.allSteps),
    formatInteger(row.cpuMs),
    formatDecimal(row.gbSeconds, 1),
  ]);
  const catalogByDay = new Map<string, { total: number; commits: number; loads: number }>();
  for (const row of report.daily.catalogOperations) {
    const found = catalogByDay.get(row.date) ?? { total: 0, commits: 0, loads: 0 };
    found.total += row.count;
    if (row.operation === "update-table") found.commits += row.count;
    if (row.operation === "load-table") found.loads += row.count;
    catalogByDay.set(row.date, found);
  }
  const catalog = [...catalogByDay.entries()]
    .toSorted((a, b) => a[0].localeCompare(b[0]))
    .map(([date, counts]) => {
      const jobs = report.daily.catalogMaintenance.filter((row) => row.date === date);
      return [
        periodLabel(report.periods, date),
        formatInteger(counts.total),
        formatInteger(counts.commits),
        formatInteger(counts.loads),
        formatInteger(jobs.reduce((total, row) => total + row.jobs, 0)),
        formatBytes(jobs.reduce((total, row) => total + row.inputBytes, 0)),
      ];
    });
  return [
    "## Workflows per UTC day (account-wide)",
    "",
    ...markdownTable(["UTC day", "Workflow", "Events", "Steps", "All steps", "CPU ms", "GB-s"], workflows, 2),
    "## R2 Data Catalog operations per UTC day",
    "",
    "Measured (`r2CatalogDataOperationsAdaptiveGroups`, `r2CatalogTableMaintenanceAdaptiveGroups`) for open-data-pt warehouses.",
    "",
    ...markdownTable(["UTC day", "Operations", "update-table (commits)", "load-table", "Maintenance jobs", "Maintenance input"], catalog, 1),
  ];
}

function summarySection(report: Report): string[] {
  const focus = report.periods.at(-1);
  if (focus === undefined) return [];
  const classes = report.attribution.classes.filter((summary) => summary.period === focus.key);
  const runnerTotals = emptyTotals();
  for (const summary of classes) mergeTotals(runnerTotals, summary.totals);
  const collections = classes.reduce((total, summary) => total + summary.collections.measured + summary.collections.estimated, 0);
  const estimated = classes.reduce((total, summary) => total + summary.collections.estimated, 0);
  const lines = [
    `## Summary for ${focus.label}`,
    "",
    `- FeedRunner (current feeds): ${formatDecimal(runnerTotals.gbSeconds, 1)} GB-s over ${collectionsText({ measured: collections - estimated, estimated })} collections = ` +
      `**${perUnit(runnerTotals.gbSeconds, collections, 3)} GB-s per collection** on average; active ${formatInteger(seconds(runnerTotals.activeUs))} s vs CPU ` +
      `${formatDecimal(seconds(runnerTotals.cpuUs), 1)} s (**active:CPU ${ratio(runnerTotals.activeUs, runnerTotals.cpuUs)}**).`,
  ];
  for (const summary of classes) {
    if (summary.totals.gbSeconds === 0) continue;
    const count = summary.collections.measured + summary.collections.estimated;
    lines.push(
      `- ${summary.feedClass}: ${formatDecimal((100 * summary.totals.gbSeconds) / Math.max(runnerTotals.gbSeconds, Number.EPSILON), 1)}% of FeedRunner GB-s, ` +
        `${perUnit(summary.totals.gbSeconds, count, 3)} GB-s and ${perUnit(seconds(summary.totals.cpuUs) * 1000, count, 1)} CPU ms per collection, active:CPU ${ratio(summary.totals.activeUs, summary.totals.cpuUs)}.`,
    );
  }
  const unattributed = report.attribution.unattributed.filter((item) => item.period === focus.key);
  if (unattributed.length > 0) {
    lines.push(
      `- ${formatInteger(unattributed.length)} FeedRunner objects in this period are not current feeds (${formatDecimal(
        unattributed.reduce((total, item) => total + item.totals.gbSeconds, 0),
        1,
      )} GB-s, excluded from classes).`,
    );
  }
  lines.push("");
  return lines;
}

/** One row per class: the latest period in which the class completed a collection (the explicit window first, when given). */
function baselineSection(report: Report): string[] {
  const newestFirst = report.periods.toReversed();
  const rows: string[][] = [];
  for (const feedClass of FEED_CLASSES) {
    const summary = newestFirst
      .map((period) => report.attribution.classes.find((candidate) => candidate.period === period.key && candidate.feedClass === feedClass))
      .find((candidate) => candidate !== undefined && candidate.totals.gbSeconds > 0 && candidate.collections.measured + candidate.collections.estimated >= 1);
    if (summary === undefined) continue;
    const count = summary.collections.measured + summary.collections.estimated;
    rows.push([
      feedClass,
      periodLabel(report.periods, summary.period),
      formatInteger(summary.feedsWithUsage),
      collectionsText(summary.collections),
      perUnit(summary.totals.gbSeconds, count, 3),
      perUnit(seconds(summary.totals.activeUs), count, 2),
      perUnit(seconds(summary.totals.cpuUs) * 1000, count, 1),
      ratio(summary.totals.activeUs, summary.totals.cpuUs),
      perUnit(summary.totals.requests, count, 2),
      perUnit(summary.totals.rowsWritten, count, 1),
    ]);
  }
  return [
    "## Baseline: FeedRunner cost per collection",
    "",
    "Per class, the latest period in which it completed at least one collection (the `--from/--to` window first). Usage measured; collection counts as marked.",
    "",
    ...markdownTable(
      ["Class", "Period", "Feeds", "Collections", "GB-s / coll.", "Active s / coll.", "CPU ms / coll.", "Active:CPU", "DO requests / coll.", "Rows written / coll."],
      rows,
      2,
    ),
  ];
}

function renderMarkdown(report: Report, options: Options): string {
  const first = report.periods[0];
  const lines = [
    "# open-data.pt usage report",
    "",
    `Generated ${report.generatedAt} from Cloudflare GraphQL Analytics (account ${ACCOUNT_ID}, ${report.credentialSource}) and ${PUBLIC_API}. ` +
      `Range: ${first?.label ?? "?"} to now, UTC days. Analytics lag a few minutes; the current day is partial.`,
    "",
    `Kernel namespaces (from \`${KERNEL_SCRIPT}\` invocations): ${report.kernelNamespaces.map((item) => `${item.role} \`${item.namespaceId}\``).join(", ")}.`,
    `Acquisition lists read for ${formatInteger(report.acquisitionsRead)} feeds` +
      (report.acquisitionsUnavailable.length > 0 ? `; unavailable for ${report.acquisitionsUnavailable.join(", ")}` : "") +
      " (each read is one RPC that wakes that FeedRunner, so a run adds about one request and a fraction of a GB-s per runner to the current day). " +
      "These are consumption measurements, not an invoice: allowances, rounding and taxes are not reconstructed.",
    "",
    ...summarySection(report),
    ...baselineSection(report),
    ...perCollectionSection(report),
    ...doSection(report),
    ...topObjectsSection(report, options.top),
    ...r2Section(report),
    ...pipelinesSection(report),
    ...r2SqlSection(report),
    ...workersSection(report),
    ...workflowsAndCatalogSection(report),
  ];
  return `${lines.join("\n")}\n`;
}

/* ---------- Main ---------- */

async function main(): Promise<void> {
  const nowMs = Date.now();
  const options = readOptions(nowMs);
  const credentials = readCredentials(nowMs);
  const periods = buildPeriods(options, nowMs);
  const dayPeriods = periods.filter((period) => period.key !== WINDOW_KEY);
  const firstDay = dayPeriods[0];
  const lastDay = dayPeriods.at(-1);
  if (firstDay === undefined || lastDay === undefined) throw new Error("no periods to report");
  const dayRange = { account: ACCOUNT_ID, from: firstDay.key, to: lastDay.key };

  const namespaceIds = await discoverKernelNamespaces(credentials, dayRange);
  if (namespaceIds.length === 0) throw new Error(`no Durable Object namespaces invoked by ${KERNEL_SCRIPT} in this range`);

  const windowPeriod = periods.find((period) => period.key === WINDOW_KEY);
  const [dailyAccount, windowAccount, feeds] = await Promise.all([
    queryAccount(credentials, dailyQuery(namespaceIds), dayRange),
    windowPeriod === undefined
      ? Promise.resolve(null)
      : queryAccount(credentials, windowQuery(namespaceIds), {
          account: ACCOUNT_ID,
          from: new Date(windowPeriod.start).toISOString(),
          to: new Date(windowPeriod.end).toISOString(),
        }),
    loadFeeds(),
  ]);
  const daily = decodeDaily(dailyAccount);
  const doObjects = [...daily.doObjects];
  const doInvocations = [...daily.doInvocations];
  if (windowAccount !== null) {
    doObjects.push(...decodeDoObjects(listAt(windowAccount, "doObjects"), WINDOW_KEY));
    doInvocations.push(...decodeDoInvocations(listAt(windowAccount, "doInvocations"), WINDOW_KEY));
  }

  const histories = options.skipAcquisitions ? new Map<string, AcquisitionHistory>() : await loadAcquisitionHistories(feeds);
  const roles = namespaceRoles(namespaceIds, doObjects);
  const feedsById = new Map(feeds.map((feed) => [feed.id, feed]));
  const usage = objectUsage(doObjects, doInvocations, roles, feedsById);
  const activeUs = daily.doObjects.reduce((total, row) => total + row.activeUs, 0);
  const gbSeconds = daily.doObjects.reduce((total, row) => total + row.gbSeconds, 0);

  const report: Report = {
    generatedAt: new Date(nowMs).toISOString(),
    credentialSource: credentials.source,
    periods,
    kernelNamespaces: namespaceIds.map((namespaceId) => ({ namespaceId, role: roles.get(namespaceId) ?? "kernel (unclassified)" })),
    namespaceDays: namespaceDays(usage, daily.doSqlStorage),
    objects: usage,
    attribution: attributeFeeds(periods, usage, feeds, histories, nowMs),
    acquisitionsRead: [...histories.values()].filter((history) => history.available).length,
    acquisitionsUnavailable: [...histories.entries()].filter(([, history]) => !history.available).map(([feedId]) => feedsById.get(feedId)?.slug ?? feedId),
    r2: r2BucketDays(daily.r2Operations, daily.r2Storage),
    pipelines: pipelineDays(daily, lakeStreamBindings()),
    daily,
    gbSecondsPerActiveSecond: activeUs > 0 ? gbSeconds / seconds(activeUs) : null,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ accountId: ACCOUNT_ID, feeds, ...report }, null, 2)}\n`);
    return;
  }
  process.stdout.write(renderMarkdown(report, options));
}

main().catch((cause) => {
  process.stderr.write(`usage-report: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exitCode = 1;
});
