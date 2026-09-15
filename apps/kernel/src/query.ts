import { asObject, asArray, asNumber, asString, isJsonObject, parseJson, type JsonObject } from "@open-data-pt/gatekeeper-shared";

/**
 * Internal R2 SQL client used only by typed, bounded HTTP handlers and the
 * Registry's daily lake audit. The SQL token and SQL text are never exposed as
 * a public query capability.
 */

const MAX_LIMIT = 1000;
const MAX_SQL_LENGTH = 4000;

export interface LakeQueryResult {
  rows: Array<JsonObject>;
  rowCount: number;
  bytesScanned: number;
  durationMs: number;
  sql: string;
}

export async function runLakeQuery(env: Pick<Env, "CATALOG_TOKEN" | "LAKE_BUCKET" | "CLOUDFLARE_ACCOUNT_ID">, sql: string, clientKey: string, fetcher: typeof fetch = (input, init) => fetch(input, init)): Promise<LakeQueryResult> {
  if (!env.CATALOG_TOKEN || !env.LAKE_BUCKET) {
    throw new QueryError("Lake queries are not enabled on this deployment", 503);
  }
  const cleaned = validate(sql);
  void clientKey;
  const started = Date.now();
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort("R2 SQL query deadline exceeded"), 30_000);
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
    const payload = asObject(parseJson(await response.text()));
    const result = asObject(payload?.result);
    const bytesScanned = Math.max(0, asNumber(asObject(result?.metrics)?.bytes_scanned) ?? 0);
    if (!response.ok || payload?.success === false) {
      const message = asArray(payload?.errors)?.map((error) => asString(asObject(error)?.message)).filter(Boolean).join("; ") || `R2 SQL returned HTTP ${response.status}`;
      throw new QueryError(message, 400);
    }
    const rows = asArray(result?.rows);
    if (!rows || !rows.every(isJsonObject)) throw new QueryError("R2 SQL returned an invalid result", 502);
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
  if (cleaned.length === 0 || cleaned.length > MAX_SQL_LENGTH) throw new QueryError("sql must be between 1 and 4000 characters", 400);
  const unquoted = withoutStringLiterals(cleaned);
  if (unquoted === undefined) throw new QueryError("A string literal is not closed", 400);
  if (unquoted.includes(";")) throw new QueryError("Only one statement is allowed", 400);
  if (!/^\s*(select|with)\b/i.test(unquoted)) throw new QueryError("Only SELECT queries are allowed", 400);
  if (/\b(insert|update|delete|drop|alter|create|merge|grant|truncate|copy)\b/i.test(unquoted)) {
    throw new QueryError("Only read queries are allowed", 400);
  }
  const limit = cleaned.match(/\blimit\s+(\d+)\s*$/i);
  if (!limit) throw new QueryError(`Add LIMIT n (n ≤ ${MAX_LIMIT}) at the end of the query`, 400);
  if (Number(limit[1]) > MAX_LIMIT) throw new QueryError(`LIMIT must be at most ${MAX_LIMIT}`, 400);
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

export class QueryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "QueryError";
  }
}
