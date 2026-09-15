/** Tables a Durable Object created itself, leaving out SQLite's and Cloudflare's internal ones. */
export function userTables(sql: SqlStorage): string[] {
  return sql
    .exec<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name != '__miniflare_do_name'`)
    .toArray()
    .map((row) => row.name);
}

/**
 * Drop every table this Durable Object created. SQLite in Durable Objects
 * always enforces foreign keys, and dropping a table first deletes its rows,
 * so a table cannot go while another table's rows still reference it. Tables
 * are dropped in passes: one a remaining child still references waits for the
 * next pass, after that child is gone.
 */
export function dropAllTables(sql: SqlStorage): void {
  let remaining = userTables(sql);
  while (remaining.length > 0) {
    const blocked: string[] = [];
    let lastError: Error | undefined;
    for (const name of remaining) {
      try {
        sql.exec(`DROP TABLE IF EXISTS "${name.replaceAll("\"", "")}"`);
      } catch (error) {
        blocked.push(name);
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    if (blocked.length === remaining.length) {
      throw new Error(`Cannot drop tables ${blocked.join(", ")}`, { cause: lastError });
    }
    remaining = blocked;
  }
}
