import { describe, expect, it } from "vitest";
import { QueryError, runLakeQuery, validate } from "../apps/kernel/src/query";

const env = { CATALOG_TOKEN: "token", LAKE_BUCKET: "history", CLOUDFLARE_ACCOUNT_ID: "account" };

describe("internal R2 SQL client", () => {
  it("returns rows and the provider's scan metric", async () => {
    let requested = "";
    const result = await runLakeQuery(env, "SELECT 1 AS n LIMIT 1", "test", async (input, init) => {
      requested = String(input);
      expect(JSON.parse(String(init?.body))).toEqual({ query: "SELECT 1 AS n LIMIT 1" });
      return Response.json({ success: true, result: { rows: [{ n: 1 }], metrics: { bytes_scanned: 2048 } } });
    });
    expect(requested).toContain("/accounts/account/r2-sql/query/history");
    expect(result.rows).toEqual([{ n: 1 }]);
    expect(result.bytesScanned).toBe(2048);
  });

  it("surfaces provider errors as a rejected query", async () => {
    await expect(runLakeQuery(env, "SELECT 1 LIMIT 1", "test", async () => Response.json({ success: false, errors: [{ message: "failure" }] }, { status: 500 }))).rejects.toThrow(
      QueryError,
    );
  });

  it("says why a query failed: its own guard, the store, an unreachable store, or an unreadable answer", async () => {
    const query = (fetcher: typeof fetch) => runLakeQuery(env, "SELECT 1 LIMIT 1", "test", fetcher);
    await expect((async () => validate("SELECT 1 LIMIT 5000"))()).rejects.toMatchObject({ failure: "refused" });
    await expect(query(async () => Response.json({ success: false, errors: [{ message: "failure" }] }, { status: 500 }))).rejects.toMatchObject({
      failure: "store",
      message: "failure",
    });
    await expect(
      query(async () => {
        throw new TypeError("network down");
      }),
    ).rejects.toMatchObject({ failure: "store" });
    await expect(query(async () => new Response("<html>bad gateway</html>", { status: 502 }))).rejects.toMatchObject({ failure: "store" });
    await expect(query(async () => new Response("<html>not json</html>", { status: 200 }))).rejects.toMatchObject({ failure: "unreadable" });
    await expect(query(async () => Response.json({ success: true, result: { rows: "none" } }))).rejects.toMatchObject({ failure: "unreadable" });
  });

  it("is disabled without a token", async () => {
    await expect(runLakeQuery({ ...env, CATALOG_TOKEN: undefined }, "SELECT 1 LIMIT 1", "test")).rejects.toThrow(/not enabled/);
  });

  it("accepts one bounded read statement only", () => {
    expect(validate("SELECT 1 LIMIT 10;")).toBe("SELECT 1 LIMIT 10");
    for (const sql of [
      "",
      "DELETE FROM t LIMIT 1",
      "SELECT 1",
      "SELECT 1 LIMIT 5000",
      "SELECT 1 LIMIT 1; SELECT 2 LIMIT 1",
      "SELECT 'unclosed LIMIT 1",
      "SELECT 'a;' AS x LIMIT 1; DELETE FROM t LIMIT 1",
    ]) {
      expect(() => validate(sql), sql).toThrow(QueryError);
    }
  });

  it("ignores keywords and semicolons inside quoted literals", () => {
    for (const sql of ["SELECT x FROM t WHERE series_key = 'update; drop' LIMIT 1", "SELECT x FROM t WHERE note = 'it''s a delete' LIMIT 1"]) {
      expect(validate(sql), sql).toBe(sql);
    }
  });
});
