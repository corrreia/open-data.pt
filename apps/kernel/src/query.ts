import { asObject, asArray, asNumber, asString, isJsonObject, parseJson, type JsonObject } from "@open-data-pt/gatekeeper-shared";

/**
 * Internal R2 SQL client used only by typed, bounded HTTP handlers and the
 * Registry's daily lake audit. The SQL token and SQL text are never exposed as
 * a public query capability.
 */

/** The most rows one history page returns. */
export const MAX_HISTORY_PAGE = 1000;
/** A page's query reads one row more than the page, to know whether another page follows. */
const MAX_LIMIT = MAX_HISTORY_PAGE + 1;
const MAX_SQL_LENGTH = 4000;
/** How long a query may run before it is given up. */
export const QUERY_DEADLINE_SECONDS = 30;

export interface LakeQueryResult {
  rows: Array<JsonObject>;
  rowCount: number;
  bytesScanned: number;
  durationMs: number;
  sql: string;
}

export async function runLakeQuery(env: Pick<Env, "CATALOG_TOKEN" | "LAKE_BUCKET" | "CLOUDFLARE_ACCOUNT_ID">, sql: string, clientKey: string, fetcher: typeof fetch = (input, init) => fetch(input, init)): Promise<LakeQueryResult> {
  if (!env.CATALOG_TOKEN || !env.LAKE_BUCKET) {
    throw new QueryError("Lake queries are not enabled on this deployment", "disabled");
  }
  const cleaned = validate(sql);
  void clientKey;
  const started = Date.now();
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort("R2 SQL query deadline exceeded"), QUERY_DEADLINE_SECONDS * 1000);
  try {
    let status: number;
    let text: string;
    try {
      const response = await fetcher(
        `https://api.sql.cloudflarestorage.com/api/v1/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/r2-sql/query/${env.LAKE_BUCKET}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${env.CATALOG_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: cleaned }),
          signal: aborter.signal,
        },
      );
      status = response.status;
      text = await response.text();
    } catch (error) {
      if (aborter.signal.aborted) throw new QueryError(`R2 SQL did not answer within ${QUERY_DEADLINE_SECONDS} seconds`, "timeout");
      throw new QueryError(`R2 SQL could not be reached: ${error instanceof Error ? error.message : String(error)}`, "store");
    }
    let payload: JsonObject | undefined;
    try {
      payload = asObject(parseJson(text));
    } catch {
      throw new QueryError(`R2 SQL answered HTTP ${status} with something other than JSON`, status < 400 ? "unreadable" : "store");
    }
    const result = asObject(payload?.result);
    const bytesScanned = Math.max(0, asNumber(asObject(result?.metrics)?.bytes_scanned) ?? 0);
    if (status >= 400 || payload?.success === false) {
      const message = asArray(payload?.errors)?.map((error) => asString(asObject(error)?.message)).filter(Boolean).join("; ") || `R2 SQL returned HTTP ${status}`;
      throw new QueryError(message, "store");
    }
    const rows = asArray(result?.rows);
    if (!rows || !rows.every(isJsonObject)) throw new QueryError("R2 SQL returned an invalid result", "unreadable");
    return { rows, rowCount: rows.length, bytesScanned, durationMs: Date.now() - started, sql: cleaned };
  } finally { clearTimeout(timer); }
}

/**
 * Single SELECT, no statements chained, LIMIT present and bounded. Keywords
 * and semicolons are looked for outside quoted literals only, so a series key
 * or cursor that contains "update" or ";" is still a valid value.
 */
export function validate(sql: string): string {
  const cleaned = sql.trim().replace(/;\s*$/, "");
  if (cleaned.length === 0 || cleaned.length > MAX_SQL_LENGTH) throw new QueryError("sql must be between 1 and 4000 characters", "refused");
  const unquoted = withoutStringLiterals(cleaned);
  if (unquoted === undefined) throw new QueryError("A string literal is not closed", "refused");
  if (unquoted.includes(";")) throw new QueryError("Only one statement is allowed", "refused");
  if (!/^\s*(select|with)\b/i.test(unquoted)) throw new QueryError("Only SELECT queries are allowed", "refused");
  if (/\b(insert|update|delete|drop|alter|create|merge|grant|truncate|copy)\b/i.test(unquoted)) {
    throw new QueryError("Only read queries are allowed", "refused");
  }
  const limit = cleaned.match(/\blimit\s+(\d+)\s*$/i);
  if (!limit) throw new QueryError(`Add LIMIT n (n ≤ ${MAX_LIMIT}) at the end of the query`, "refused");
  if (Number(limit[1]) > MAX_LIMIT) throw new QueryError(`LIMIT must be at most ${MAX_LIMIT}`, "refused");
  return cleaned;
}

/**
 * The query with every single-quoted literal (with '' escapes) replaced by an
 * empty literal, or undefined when a literal is left open.
 */
function withoutStringLiterals(sql: string): string | undefined {
  let output = "";
  let index = 0;
  while (index < sql.length) {
    const character = sql[index]!;
    if (character !== "'") {
      output += character;
      index += 1;
      continue;
    }
    index += 1;
    let closed = false;
    while (index < sql.length) {
      if (sql[index] === "'" && sql[index + 1] === "'") {
        index += 2;
        continue;
      }
      if (sql[index] === "'") {
        closed = true;
        index += 1;
        break;
      }
      index += 1;
    }
    if (!closed) return undefined;
    output += "''";
  }
  return output;
}

/**
 * Why a lake query failed: lake queries are not configured here (`disabled`),
 * the query failed this module's own guard (`refused`, a bug in whatever built
 * it), R2 SQL refused, failed or could not be reached (`store`), it ran past the
 * deadline (`timeout`), or R2 SQL answered with something unreadable (`unreadable`).
 */
export type QueryFailure = "disabled" | "refused" | "store" | "timeout" | "unreadable";

export class QueryError extends Error {
  constructor(
    message: string,
    readonly failure: QueryFailure,
  ) {
    super(message);
    this.name = "QueryError";
  }
}
