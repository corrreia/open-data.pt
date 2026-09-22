import { jsonAs } from "./support";
import { describe, expect, it, vi } from "vitest";
import type { JsonObject, JsonValue, SourceBody, SourceFetch, TransformContext } from "@open-data-pt/contract";
import {
  REN_DATAHUB_URL,
  collectRenFeed,
  collectRenHistory,
  defaultCollectionDays,
  dotNetTicks,
  REN_FEEDS,
  REN_MAX_BYTES,
  validateRenFeedConfig,
} from "../apps/gatekeeper/src/sources/ren/ren";
import { RenTransformer } from "../apps/gatekeeper/src/sources/ren/transform";

function completeChart(): JsonObject {
  return {
    xAxis: {
      categories: Array.from({ length: 96 }, (_, index) => {
        const minutes = index * 15;
        return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      }),
    },
    yAxis: { title: { text: "MW" } },
    series: [
      {
        name: "Consumption",
        data: Array.from({ length: 96 }, () => 1),
        color: "#0D2965",
      },
    ],
  };
}

function jsonResponse(value: JsonValue | undefined, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

function transformContext(service: string): TransformContext {
  return {
    feed: {
      id: `feed_${service}`,
      slug: `ren-${service}-feed`,
      title: service,
      description: "test feed",
      config: { service },
      // SAFETY: every `service` this helper is called with is a REN feed kind.
      semantics: REN_FEEDS[service as keyof typeof REN_FEEDS].semantics,
    },
    observedAt: "2026-09-08T00:00:00.000Z",
  };
}

/** The body a fetch carried, failing the test when the adapter returned anything else. */
function sourceBody(fetched: SourceFetch): SourceBody & { body: Uint8Array } {
  if (fetched.kind !== "body") throw new Error(`Expected a source body, got ${fetched.kind}`);
  const { body } = fetched;
  if (!(body instanceof Uint8Array)) throw new Error("Expected a buffered source body");
  return { ...fetched, body };
}

describe("REN Gatekeeper", () => {
  it("normalizes valid configurations and rejects malformed service or day values", () => {
    expect(
      validateRenFeedConfig({
        service: "production-breakdown",
        day: "2026-09-06",
      }),
    ).toEqual({ feed: "production-breakdown", service: "production-breakdown", day: "2026-09-06" });
    expect(validateRenFeedConfig({ feed: "consumption" })).toEqual({
      feed: "consumption",
      service: "consumption",
    });
    expect(() => validateRenFeedConfig({ service: "unknown" })).toThrow("REN feeds require service=");
    expect(() => validateRenFeedConfig({ service: "consumption", day: "2026-02-30" })).toThrow("valid date");
  });

  it("selects yesterday and, after 06:00 Lisbon time, today", () => {
    expect(defaultCollectionDays(new Date("2026-01-15T05:59:00Z"))).toEqual(["2026-01-14"]);
    expect(defaultCollectionDays(new Date("2026-01-15T06:00:00Z"))).toEqual(["2026-01-14", "2026-01-15"]);
    expect(defaultCollectionDays(new Date("2026-07-15T04:59:00Z"))).toEqual(["2026-07-14"]);
    expect(defaultCollectionDays(new Date("2026-07-15T05:00:00Z"))).toEqual(["2026-07-14", "2026-07-15"]);
  });

  it("rejects caller-provided hosts and non-allowlisted deployment origins", async () => {
    expect(() =>
      validateRenFeedConfig({
        service: "consumption",
        host: "evil.example",
      }),
    ).toThrow("hosts and URLs are fixed");

    await expect(collectRenFeed({ service: "consumption", day: "2026-09-06" }, undefined, "https://evil.example", vi.fn(), new Date("2026-09-07T12:00:00Z"))).rejects.toMatchObject(
      { code: "source-denied" },
    );
  });

  it("posts the verified query contract and returns provenance and a content validator", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input.toString());
      expect(url.origin).toBe("https://datahub.ren.pt");
      expect(url.pathname).toBe("/service/Electricity/ProductionBreakdown/1354");
      expect(url.searchParams.get("culture")).toBe("en-GB");
      expect(url.searchParams.get("dayToSearchString")).toBe(dotNetTicks("2026-09-06"));
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe("{}");
      return jsonResponse(completeChart(), {
        headers: { "Last-Modified": "Mon, 07 Sep 2026 00:10:00 GMT" },
      });
    });

    const fetched = sourceBody(
      await collectRenFeed({ service: "production-breakdown", day: "2026-09-06" }, undefined, "https://datahub.ren.pt", fetcher, new Date("2026-09-07T12:00:00Z")),
    );

    expect(fetched.provenance.sourceUrl).toBe(REN_DATAHUB_URL);
    expect(fetched.completeness).toBe("complete");
    expect(fetched.validator?.etag).toMatch(/^"sha256-[a-f0-9]{64}"$/);
    expect(fetched.validator?.lastModified).toBe("Mon, 07 Sep 2026 00:10:00 GMT");
    expect(fetched.next).toBeUndefined();
    expect(jsonAs(fetched.body)).toMatchObject({
      service: "production-breakdown",
      days: [{ day: "2026-09-06" }],
    });
  });

  it("marks a window that includes today as partial", async () => {
    const fetched = sourceBody(
      await collectRenFeed(
        { service: "consumption", day: "2026-09-07" },
        undefined,
        "https://datahub.ren.pt",
        vi.fn(async () => jsonResponse(completeChart())),
        new Date("2026-09-07T12:00:00Z"),
      ),
    );
    expect(fetched.completeness).toBe("partial");
  });

  it("uses the synthetic content ETag as a checkpoint and reports not modified", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, _init?: RequestInit) => jsonResponse(completeChart()));
    const config = { service: "consumption", day: "2026-09-06" };
    const first = sourceBody(await collectRenFeed(config, undefined, "https://datahub.ren.pt", fetcher, new Date("2026-09-07T12:00:00Z")));
    const etag = first.validator?.etag;
    if (!etag) throw new Error("Expected a synthetic ETag");

    const second = await collectRenFeed(config, { etag }, "https://datahub.ren.pt", fetcher, new Date("2026-09-07T12:00:00Z"));

    expect(second).toEqual({ kind: "not-modified", validator: { etag } });
    const secondHeaders = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    expect(secondHeaders.get("if-none-match")).toBe(etag);
  });

  it("reports an upstream 304 as not modified and forwards Last-Modified checkpoints", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("if-modified-since")).toBe("Sun, 06 Sep 2026 00:00:00 GMT");
      return new Response(null, {
        status: 304,
        headers: { ETag: '"provider"' },
      });
    });
    const fetched = await collectRenFeed({ service: "consumption", day: "2026-09-06" }, { lastModified: "Sun, 06 Sep 2026 00:00:00 GMT" }, "https://datahub.ren.pt", fetcher);
    expect(fetched).toEqual({
      kind: "not-modified",
      validator: { etag: '"provider"', lastModified: "Sun, 06 Sep 2026 00:00:00 GMT" },
    });
  });

  it("enforces the 2 MiB collection cap", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(completeChart(), {
        headers: { "Content-Length": String(REN_MAX_BYTES + 1) },
      }),
    );
    await expect(collectRenFeed({ service: "consumption", day: "2026-09-06" }, undefined, "https://datahub.ren.pt", fetcher)).rejects.toMatchObject({ code: "response-too-large" });
  });

  it.each([
    ["400 with its notice", 400],
    ["204 with no body at all", 204],
  ])("treats a gas day REN has not published yet, answered %s, as an empty day rather than a failure", async (_case, status) => {
    const noData = { message: '<div><p class="main-text">There is no data<br>for the selected date</p></div>' };
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const day = new URL(input.toString()).searchParams.get("dayToSearchString");
      if (day === dotNetTicks("2026-09-07")) return jsonResponse(completeChart());
      return status === 204 ? new Response(null, { status }) : jsonResponse(noData, { status });
    });
    // 06:04 Lisbon on a summer morning: the new gas day has started, REN publishes its chart about two hours later.
    const fetched = sourceBody(await collectRenFeed({ service: "gas-consumption" }, undefined, "https://datahub.ren.pt", fetcher, new Date("2026-09-08T05:04:00Z")));

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetched.completeness).toBe("partial");
    expect(jsonAs(fetched.body)).toMatchObject({
      service: "gas-consumption",
      days: [{ day: "2026-09-07" }, { day: "2026-09-08" }],
    });
    const transformed = new RenTransformer().transform(fetched.body, transformContext("gas-consumption"));
    expect(transformed.products[0]?.points).toHaveLength(96);
  });

  it("maps provider failures to an upstream error carrying the retry delay", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ message: "unavailable" }, { status: 503, headers: { "Retry-After": "90" } }));
    await expect(collectRenFeed({ service: "gas-consumption", day: "2026-09-06" }, undefined, "https://datahub.ren.pt", fetcher)).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: 90,
      message: "REN Data Hub returned HTTP 503 for gas-consumption",
    });
  });
});

describe("REN history", () => {
  it("declares history reaching back to a stated earliest day on every chart feed", () => {
    const chartFeeds = Object.values(REN_FEEDS).filter((feed) => "history" in feed);
    expect(chartFeeds).toHaveLength(6);
    expect(Object.values(REN_FEEDS)).toHaveLength(9);
    for (const feed of chartFeeds) {
      expect(feed.history?.earliest).toMatch(/^(?:2010|2014)-01-01T00:00:00\.000Z$/);
    }
  });

  it("collects one older civil day with its range, next cursor, and transform-compatible bytes", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.searchParams.get("dayToSearchString")).toBe(dotNetTicks("2026-09-05"));
      return jsonResponse(completeChart());
    });
    const before = "2026-09-05T23:00:00.000Z";
    const fetched = sourceBody(await collectRenHistory({ service: "consumption" }, { before }, "https://datahub.ren.pt", fetcher));

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetched.next).toEqual({ before: "2026-09-04T23:00:00.000Z" });
    expect(fetched.exhausted).toBeUndefined();
    expect(fetched.provenance.sourceUrl).toBe(REN_DATAHUB_URL);
    expect(fetched.completeness).toBe("complete");
    expect(fetched.validator).toBeUndefined();

    expect(jsonAs(fetched.body)).toMatchObject({
      service: "consumption",
      days: [{ day: "2026-09-05" }],
    });
    const transformed = new RenTransformer().transform(fetched.body, transformContext("consumption"));
    expect(transformed.products[0]?.points).toHaveLength(96);
    expect(transformed.products[0]?.points?.every((point) => point.eventTime < before)).toBe(true);
  });

  it("uses Lisbon civil-day boundaries across the 25-hour DST fallback day", async () => {
    const fetcher = vi.fn(async () => jsonResponse(completeChart()));
    const fetched = sourceBody(await collectRenHistory({ service: "consumption" }, { before: "2026-10-26T00:00:00.000Z" }, "https://datahub.ren.pt", fetcher));

    expect(fetched.next).toEqual({ before: "2026-10-24T23:00:00.000Z" });
  });

  it("requires two consecutive empty source days before reporting exhaustion", async () => {
    const noData = {
      message: "<div><p>There is no data<br>for the selected date</p></div>",
    };
    const fetcher = vi.fn(async () => jsonResponse(noData, { status: 400 }));
    const first = sourceBody(await collectRenHistory({ service: "consumption" }, { before: "2026-09-05T23:00:00.000Z" }, "https://datahub.ren.pt", fetcher));

    expect(first.completeness).toBe("complete");
    expect(first.next).toEqual({
      before: "2026-09-04T23:00:00.000Z",
      token: "ren-empty-day:2026-09-05",
    });
    const transformed = new RenTransformer().transform(first.body, transformContext("consumption"));
    expect(transformed.products[0]?.points).toEqual([]);

    const next = first.next;
    if (!next) throw new Error("Expected a next cursor");
    const second = await collectRenHistory({ service: "consumption" }, next, "https://datahub.ren.pt", fetcher);
    expect(second).toEqual({
      kind: "exhausted",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports exhaustion without another source request past the probed earliest day", async () => {
    const fetcher = vi.fn();
    const fetched = await collectRenHistory({ service: "gas-consumption" }, { before: "2014-01-01T00:00:00.000Z" }, "https://datahub.ren.pt", fetcher);

    expect(fetched).toEqual({
      kind: "exhausted",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([429, 503])("maps history HTTP %i to a retryable upstream error with its retry delay", async (status) => {
    const fetcher = vi.fn(async () => jsonResponse({ message: "retry later" }, { status, headers: { "Retry-After": "30" } }));
    await expect(collectRenHistory({ service: "gas-network-balance" }, { before: "2026-09-05T23:00:00.000Z" }, "https://datahub.ren.pt", fetcher)).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: 30,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
