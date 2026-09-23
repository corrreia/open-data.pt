import { readFixture } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import { ANEPC_API_ORIGIN, collectAnepcFeed, validateAnepcFeedConfig } from "#/publishers/anepc/anepc/index";

describe("ANEPC source boundary", () => {
  it("normalizes its fixed configuration and rejects a caller-controlled source", () => {
    expect(validateAnepcFeedConfig({ feed: "active-occurrences" })).toEqual({ feed: "active-occurrences" });
    expect(() => validateAnepcFeedConfig({ feed: "active-occurrences", host: "evil.example" })).toThrow(expect.objectContaining({ code: "source-denied" }));
  });

  it("collects the ANEPC authoritative snapshot without treating its wrapper clock as a record change", async () => {
    let requests = 0;
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.origin).toBe(ANEPC_API_ORIGIN);
      expect(url.searchParams.get("where")).toBe("1=1");
      expect(url.searchParams.get("resultRecordCount")).toBe("2000");
      const original = readFixture(new URL("./fixtures/active-occurrences.json", import.meta.url));
      requests += 1;
      const response = requests === 1 ? original : original.replaceAll("1789755840000", "1789755900000");
      return new Response(response, { headers: { "content-type": "application/geo+json" } });
    });
    const fetched = await collectAnepcFeed({ feed: "active-occurrences" }, undefined, ANEPC_API_ORIGIN, fetcher);
    expect(fetched).toMatchObject({
      kind: "body",
      completeness: "complete",
      provenance: { sourcePublishedAt: "2026-09-18T18:24:00.000Z" },
      validator: { etag: expect.stringMatching(/^"sha256-/u) },
    });
    if (fetched.kind !== "body") throw new Error("Expected ANEPC source body");
    await expect(collectAnepcFeed({ feed: "active-occurrences" }, fetched.validator, ANEPC_API_ORIGIN, fetcher)).resolves.toEqual({
      kind: "not-modified",
      validator: fetched.validator,
    });
  });

  it("rejects a truncated upstream response", async () => {
    await expect(
      collectAnepcFeed(
        { feed: "active-occurrences" },
        undefined,
        ANEPC_API_ORIGIN,
        async () => new Response(JSON.stringify({ type: "FeatureCollection", properties: { exceededTransferLimit: true }, features: [] })),
      ),
    ).rejects.toMatchObject({ code: "upstream-error" });
  });
});
