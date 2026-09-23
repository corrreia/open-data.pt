import { DatabaseSync, type StatementSync } from "node:sqlite";
import { isJsonString } from "@open-data-pt/contract";
import type { SqlExec } from "../src/sqlite-reset";

/** https://developers.cloudflare.com/durable-objects/platform/limits/ — "Maximum string, BLOB or table row size: 2 MB". */
const DURABLE_OBJECT_VALUE_BYTES = 2_000_000;
const encoder = new TextEncoder();

/** The bytes a bound value takes in a row: a string's UTF-8, a BLOB's length, nothing for a number or null. */
function valueBytes(value: SqlStorageValue): number {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (value === null) return 0;
  return isJsonString(value) ? encoder.encode(value).byteLength : 0;
}

/**
 * Real SQLite engine, behind the one call the stores make of a Durable Object's `SqlStorage`.
 * Statements are prepared once per query text, as the Durable Object runtime
 * caches them, so benchmarks measure the kernel rather than re-parsing SQL.
 */
export function sqliteStorage(database: DatabaseSync): SqlExec {
  const statements = new Map<string, StatementSync>();
  return {
    exec<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: SqlStorageValue[]) {
      // Durable Object SQLite refuses any string or BLOB over 2 MB; node:sqlite allows 1 GB.
      for (const value of bindings) {
        if (valueBytes(value) > DURABLE_OBJECT_VALUE_BYTES) throw new Error("string or blob too big: SQLITE_TOOBIG");
      }
      let statement = statements.get(query);
      if (!statement) {
        statement = database.prepare(query);
        statements.set(query, statement);
      }
      const rows = statement.all(...bindings.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value)));
      // SAFETY: SQL and its row type are supplied together by each store, as with SqlStorage.exec<T>.
      const result = rows as T[];
      return { toArray: () => result };
    },
  };
}
