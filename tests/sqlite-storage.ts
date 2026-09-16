import { DatabaseSync, type StatementSync } from "node:sqlite";
import { isJsonString } from "@open-data-pt/gatekeeper-shared";

/** https://developers.cloudflare.com/durable-objects/platform/limits/ — "Maximum string, BLOB or table row size: 2 MB". */
const DURABLE_OBJECT_VALUE_BYTES = 2_000_000;
const encoder = new TextEncoder();

/**
 * Real SQLite engine, with the synchronous cursor surface used by the stores.
 * Statements are prepared once per query text, as the Durable Object runtime
 * caches them, so benchmarks measure the kernel rather than re-parsing SQL.
 */
export function sqliteStorage(database: DatabaseSync): SqlStorage {
  const statements = new Map<string, StatementSync>();
  const changes = database.prepare("SELECT changes() AS count");
  const storage = {
    exec<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: SqlStorageValue[]) {
      // Durable Object SQLite refuses any string or BLOB over 2 MB; node:sqlite allows 1 GB.
      for (const value of bindings) {
        const bytes = isJsonString(value) ? encoder.encode(value).byteLength : value instanceof ArrayBuffer ? value.byteLength : 0;
        if (bytes > DURABLE_OBJECT_VALUE_BYTES) throw new Error("string or blob too big: SQLITE_TOOBIG");
      }
      let statement = statements.get(query);
      if (!statement) {
        statement = database.prepare(query);
        statements.set(query, statement);
      }
      const rows = statement.all(...bindings.map((value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value)));
      // SAFETY: SQL and its row type are supplied together by each store, as with SqlStorage.exec<T>.
      const result = rows as T[];
      const writes = changes.get()?.count ?? 0;
      const columns = statement.columns().map((column) => column.name);
      return {
        toArray: () => result,
        one: () => {
          if (result.length !== 1) throw new Error("Expected one row");
          return result[0]!;
        },
        rowsRead: result.length,
        rowsWritten: Number(writes),
        columnNames: columns,
        [Symbol.iterator]: () => result[Symbol.iterator](),
      };
    },
  };
  // SAFETY: stores use only exec/toArray/rowsRead/rowsWritten, faithfully backed by real SQLite above.
  return storage as SqlStorage;
}
