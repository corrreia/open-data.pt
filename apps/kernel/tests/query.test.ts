import { describe, expect, it, vi } from "vitest";
import { QueryError, runLakeQuery, validate } from "../src/query";

/** The kernel's own vars, as its generated `Env` types them from wrangler.jsonc; the token is a test one. */
const env: Pick<Env, "CATALOG_TOKEN" | "LAKE_BUCKET" | "CLOUDFLARE_ACCOUNT_ID"> = {
  CATALOG_TOKEN: "token",
  LAKE_BUCKET: "open-data-pt-history",
  CLOUDFLARE_ACCOUNT_ID: "cc05ea77c39684419e087c3b78b5177d",
};

describe("internal R2 SQL client", () => {
  it("returns rows and the provider's scan metric", async () => {
    let requested = "";
    const result = await runLakeQuery(env, "SELECT 1 AS n LIMIT 1", "test", async (input, init) => {
      requested = String(input);
      expect(JSON.parse(String(init?.body))).toEqual({ query: "SELECT 1 AS n LIMIT 1" });
      return Response.json({ success: true, result: { rows: [{ n: 1 }], metrics: { bytes_scanned: 2048 } } });
    });
    expect(requested).toContain(`/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/r2-sql/query/${env.LAKE_BUCKET}`);
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

  it("logs every query it makes, answered or not, with its label, how long it took and what it cost", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runLakeQuery(env, "SELECT 1 LIMIT 1", "events:anepc", async () =>
      Response.json({ success: true, result: { rows: [], metrics: { bytes_scanned: 4096, files_scanned: 3 } } }),
    );
    await expect(
      runLakeQuery(env, "SELECT 1 LIMIT 1", "series:ren", async () => Response.json({ success: false, errors: [{ message: "no" }] }, { status: 500 })),
    ).rejects.toThrow();
    const lines = log.mock.calls.map((call) => JSON.parse(String(call[0])));
    expect(lines[0]).toMatchObject({ event: "lake_query", label: "events:anepc", outcome: "answered", metrics: { bytes_scanned: 4096, files_scanned: 3 } });
    expect(lines[0].ms).toBeTypeOf("number");
    expect(lines[1]).toMatchObject({ event: "lake_query", label: "series:ren", outcome: "http-500" });
    // A 200 whose rows are not rows is not an answer.
    await expect(runLakeQuery(env, "SELECT 1 LIMIT 1", "changes:x", async () => Response.json({ success: true, result: { rows: "none" } }))).rejects.toThrow();
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({ label: "changes:x", outcome: "invalid-result" });
    log.mockRestore();
  });

  it("is disabled without a token", async () => {
    await expect(runLakeQuery({ ...env, CATALOG_TOKEN: "" }, "SELECT 1 LIMIT 1", "test")).rejects.toThrow(/not enabled/);
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
