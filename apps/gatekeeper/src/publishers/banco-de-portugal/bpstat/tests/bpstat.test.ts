import { parseJson } from "@open-data-pt/contract";
import type { JsonValue, SourceBody, SourceFetch } from "@open-data-pt/contract";
import { describe, expect, it, vi } from "vitest";
import { BPSTAT_MAX_BYTES, collectBpstatDataset, validateBpstatFeedConfig } from "#/publishers/banco-de-portugal/bpstat/bpstat";

const DATASET_ID = "7f13efcd65fc6bd0c5adb0e8d29d9b44";
const SOURCE_URL = `https://bpstat.bportugal.pt/data/v1/domains/12/datasets/${DATASET_ID}/?lang=EN`;
const PAGE = {
  version: "2.0",
  class: "dataset",
  label: "Consumer price index",
  href: SOURCE_URL,
  id: ["metric", "reference_date"],
  size: [1, 1],
  dimension: {
    metric: {
      label: "Metric",
      category: { index: ["rate"], label: { rate: "Rate" } },
    },
    reference_date: {
      label: "Date",
      category: {
        index: ["2026-07-31"],
        label: { "2026-07-31": "2026-07-31" },
      },
    },
  },
  role: { metric: ["metric"], time: ["reference_date"] },
  value: [2.6],
  extension: { obs_updated_at: "2026-08-20T16:00:00Z" },
};

function jsonResponse(value: JsonValue | undefined, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

function sourceBody(fetched: SourceFetch): SourceBody {
  if (fetched.kind !== "body") throw new Error(`Expected a source body, got ${fetched.kind}`);
  return fetched;
}

async function bodyJson(fetched: SourceBody): Promise<JsonValue> {
  return parseJson(await new Response(fetched.body).text());
}

describe("BPstat Gatekeeper", () => {
  it("normalizes a strict dataset configuration", () => {
    expect(
      validateBpstatFeedConfig({
        domain: " 12 ",
        dataset: DATASET_ID.toUpperCase(),
        lang: "en",
      }),
    ).toEqual({ domain: "12", dataset: DATASET_ID, lang: "EN" });
    expect(validateBpstatFeedConfig({ domain: "12", dataset: DATASET_ID })).toEqual({ domain: "12", dataset: DATASET_ID, lang: "PT" });
  });

  it("rejects malformed configs and caller-provided hosts", () => {
    expect(() => validateBpstatFeedConfig({ domain: "0", dataset: DATASET_ID })).toThrow("positive integer");
    expect(() => validateBpstatFeedConfig({ domain: "12", dataset: "not-an-id" })).toThrow("32-character hexadecimal");
    expect(() =>
      validateBpstatFeedConfig({
        domain: "12",
        dataset: DATASET_ID,
        host: "attacker.example",
      }),
    ).toThrow("does not accept host");
  });

  it("rejects a deployment origin outside the BPstat allowlist", async () => {
    await expect(collectBpstatDataset({ domain: "12", dataset: DATASET_ID }, undefined, "https://attacker.example", vi.fn())).rejects.toMatchObject({ code: "source-denied" });
  });

  it("collects JSON-stat bytes with provenance and checkpoint validators", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(input.toString()).toBe(SOURCE_URL);
      const headers = new Headers(init?.headers);
      expect(headers.get("if-none-match")).toBe('"old"');
      expect(headers.get("if-modified-since")).toBe("Wed, 19 Aug 2026 16:00:00 GMT");
      return jsonResponse(PAGE, {
        headers: {
          "Last-Modified": "Thu, 20 Aug 2026 16:00:00 GMT",
        },
      });
    });

    const fetched = sourceBody(
      await collectBpstatDataset(
        { domain: "12", dataset: DATASET_ID, lang: "EN" },
        {
          etag: '"old"',
          lastModified: "Wed, 19 Aug 2026 16:00:00 GMT",
        },
        "https://bpstat.bportugal.pt",
        fetcher,
      ),
    );

    expect(fetched.provenance).toEqual({
      sourceUrl: SOURCE_URL,
      sourcePublishedAt: "2026-08-20T16:00:00.000Z",
    });
    expect(fetched.completeness).toBe("complete");
    expect(fetched.validator).toEqual({
      etag: `"bpstat:12:${DATASET_ID}:EN:2026-08-20T16:00:00.000Z"`,
      lastModified: "Thu, 20 Aug 2026 16:00:00 GMT",
    });
    await expect(bodyJson(fetched)).resolves.toEqual(PAGE);
  });

  it("reports not-modified when the source publication checkpoint is unchanged", async () => {
    const etag = `"bpstat:12:${DATASET_ID}:EN:2026-08-20T16:00:00.000Z"`;
    const fetcher = vi.fn(async () => jsonResponse(PAGE));
    const fetched = await collectBpstatDataset({ domain: "12", dataset: DATASET_ID, lang: "EN" }, { etag }, "https://bpstat.bportugal.pt", fetcher);

    expect(fetched).toEqual({ kind: "not-modified", validator: { etag } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("reports an upstream 304 as not-modified with its validators", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 304,
          headers: { ETag: '"upstream"', "Last-Modified": "Thu, 20 Aug 2026 16:00:00 GMT" },
        }),
    );
    const fetched = await collectBpstatDataset({ domain: "12", dataset: DATASET_ID, lang: "EN" }, { etag: '"upstream"' }, "https://bpstat.bportugal.pt", fetcher);
    expect(fetched).toEqual({
      kind: "not-modified",
      validator: { etag: '"upstream"', lastModified: "Thu, 20 Aug 2026 16:00:00 GMT" },
    });
  });

  it("concatenates paginated source pages into a deterministic document", async () => {
    const first = {
      ...PAGE,
      extension: {
        ...PAGE.extension,
        next_page: `${SOURCE_URL}&page=2`,
      },
    };
    const second = {
      ...PAGE,
      href: `${SOURCE_URL}&page=2`,
      extension: PAGE.extension,
      value: [2.7],
    };
    const fetcher = vi.fn().mockResolvedValueOnce(jsonResponse(first)).mockResolvedValueOnce(jsonResponse(second));

    const fetched = sourceBody(await collectBpstatDataset({ domain: "12", dataset: DATASET_ID, lang: "EN" }, undefined, "https://bpstat.bportugal.pt", fetcher));

    expect(fetched.completeness).toBe("complete");
    expect(fetched.provenance.sourceUrl).toBe(SOURCE_URL);
    await expect(bodyJson(fetched)).resolves.toEqual({ pages: [first, second] });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0].toString()).toBe(`${SOURCE_URL}&page=2`);
  });

  it("enforces the byte cap and marks a capped pagination snapshot partial", async () => {
    const first = {
      ...PAGE,
      extension: {
        ...PAGE.extension,
        next_page: `${SOURCE_URL}&page=2`,
      },
    };
    const oversizedPage = new Response("{}", {
      headers: { "Content-Length": String(BPSTAT_MAX_BYTES) },
    });
    const paginatedFetcher = vi.fn().mockResolvedValueOnce(jsonResponse(first)).mockResolvedValueOnce(oversizedPage);
    const partial = sourceBody(await collectBpstatDataset({ domain: "12", dataset: DATASET_ID, lang: "EN" }, undefined, "https://bpstat.bportugal.pt", paginatedFetcher));
    expect(partial.completeness).toBe("partial");
    await expect(bodyJson(partial)).resolves.toEqual({ pages: [first] });

    const tooLargeFetcher = vi.fn(
      async () =>
        new Response("{}", {
          headers: { "Content-Length": String(BPSTAT_MAX_BYTES + 1) },
        }),
    );
    await expect(collectBpstatDataset({ domain: "12", dataset: DATASET_ID, lang: "EN" }, undefined, "https://bpstat.bportugal.pt", tooLargeFetcher)).rejects.toMatchObject({
      code: "response-too-large",
    });
  });

  it("rejects malformed successful provider payloads", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ ...PAGE, role: {} }));
    await expect(collectBpstatDataset({ domain: "12", dataset: DATASET_ID, lang: "EN" }, undefined, "https://bpstat.bportugal.pt", fetcher)).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it("maps provider HTTP and request failures to retryable upstream errors", async () => {
    const httpFailure = vi.fn(async () => new Response("temporary failure", { status: 503 }));
    await expect(collectBpstatDataset({ domain: "12", dataset: DATASET_ID, lang: "EN" }, undefined, "https://bpstat.bportugal.pt", httpFailure)).rejects.toMatchObject({
      code: "upstream-error",
    });

    const requestFailure = vi.fn(async () => {
      throw new Error("request timed out");
    });
    await expect(collectBpstatDataset({ domain: "12", dataset: DATASET_ID, lang: "EN" }, undefined, "https://bpstat.bportugal.pt", requestFailure)).rejects.toMatchObject({
      code: "upstream-error",
    });
  });
});
