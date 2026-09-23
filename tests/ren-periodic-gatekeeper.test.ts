import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  NORMALIZED_PROTOCOL,
  collectNormalized,
  feedCollector,
  isNormalizedFrame,
  parseJson,
  resolveLibraryFeed,
  type CollectionRequest,
  type NormalizedRow,
  type RunnableFeed,
  type TransformContext,
} from "@open-data-pt/gatekeeper";
import { RUNNABLE } from "@open-data-pt/gatekeeper/catalog";
import { resolveRenFeed } from "../apps/gatekeeper/src/publishers/ren/ren/collector";
import { carriedLibraries } from "./catalog";
import {
  REN_PERIODIC_ORIGIN,
  REN_PERIODIC_FEEDS,
  collectRenPeriodic,
  validateRenPeriodicConfig,
  type RenPeriodicService,
} from "../apps/gatekeeper/src/publishers/ren/ren/periodic";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const NOW = new Date("2026-09-16T12:00:00Z");

/** The feed file that reads one periodic service, to run with a configuration no feed has. */
function periodicFeed(service: RenPeriodicService): RunnableFeed {
  const feed = RUNNABLE.get(`ren-${service}-feed`);
  if (!feed) throw new Error(`No feed file reads ${service}`);
  return feed;
}

function context(service: RenPeriodicService, observedAt: string): TransformContext {
  return {
    observedAt,
    feed: { slug: `ren-${service}-feed`, title: service, description: service, config: { service, feed: service }, semantics: REN_PERIODIC_FEEDS[service].semantics },
  };
}

async function normalized(service: RenPeriodicService, observedAt = NOW.toISOString()) {
  const collector = feedCollector(periodicFeed(service), { service, day: "2026-09-14", source: "ren" }, carriedLibraries("ren"), {
    fetcher: async () => new Response(fixture(service === "installed-capacity" ? "ren-installed-capacity.json" : "ren-daily-storage.json")),
    now: () => NOW,
  });
  const fetched = await collector.source(undefined, { kind: "live" }, new AbortController().signal);
  if (fetched.kind !== "body" || collector.normalize.kind !== "streaming") throw new Error("Expected streaming body");
  const body = new Response(fetched.body).body!;
  const result = await collector.normalize.transform(body, context(service, observedAt));
  const rows: NormalizedRow[] = [];
  for await (const row of result.rows) rows.push(row);
  return { products: result.products, rows, summary: result.finish() };
}

describe("REN periodic public API", () => {
  it("validates services and dates, rejecting caller-controlled URLs and conflicting kinds", () => {
    expect(validateRenPeriodicConfig({ service: "gas-storage" })).toEqual({ service: "gas-storage", feed: "gas-storage" });
    expect(() => validateRenPeriodicConfig({ service: "gas-storage", day: "2026-02-31" })).toThrow("valid YYYY-MM-DD");
    expect(() => validateRenPeriodicConfig({ service: "gas-storage", url: "https://evil.example" })).toThrow("does not accept url");
    expect(() => validateRenPeriodicConfig({ service: "gas-storage", feed: "installed-capacity" })).toThrow("must match");
  });

  it("canonicalizes equivalent monthly pins to one resource and configuration", async () => {
    const first = await resolveRenFeed({ service: "installed-capacity", day: "2026-03-01" });
    const later = await resolveRenFeed({ service: "installed-capacity", day: "2026-03-17" });
    expect(later.config.day).toBe("2026-03-01");
    expect(later.configHash).toBe(first.configHash);
    expect(later.resourceKey).toBe(first.resourceKey);
  });

  it("collects all seven closed days without reusing a one-day transport validator", async () => {
    const days: string[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(input.toString());
      days.push(url.searchParams.get("date")!);
      expect(url.origin).toBe(REN_PERIODIC_ORIGIN);
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
      return new Response(fixture("ren-daily-storage.json"));
    });
    const options = { config: { service: "gas-storage" }, apiOrigin: REN_PERIODIC_ORIGIN, fetcher, now: () => NOW };
    const first = await collectRenPeriodic(options, { etag: '"old"' });
    expect(days).toEqual(["2026-09-15", "2026-09-14", "2026-09-13", "2026-09-12", "2026-09-11", "2026-09-10", "2026-09-09"]);
    if (first.kind !== "body") throw new Error("Expected body");
    expect(first.completeness).toBe("complete");
    expect(await collectRenPeriodic(options, first.validator)).toMatchObject({ kind: "not-modified" });
    expect(fetcher).toHaveBeenCalledTimes(14);
  });

  it("handles an unpublished latest day without inventing zeroes or claiming complete coverage", async () => {
    const result = await collectRenPeriodic(
      {
        config: { service: "gas-storage" },
        apiOrigin: REN_PERIODIC_ORIGIN,
        now: () => NOW,
        fetcher: async (input) =>
          new URL(input.toString()).searchParams.get("date") === "2026-09-15"
            ? new Response('{"message":"No data available for the selected date."}', { status: 404 })
            : new Response(fixture("ren-daily-storage.json")),
      },
      undefined,
    );
    if (result.kind !== "body") throw new Error("Expected body");
    expect(result.completeness).toBe("partial");
    expect((await new Response(result.body).text()).trim().split("\n")).toHaveLength(6);
  });

  it("retries when every requested period is unpublished and rejects provider errors", async () => {
    await expect(
      collectRenPeriodic(
        {
          config: { service: "gas-storage" },
          apiOrigin: REN_PERIODIC_ORIGIN,
          now: () => NOW,
          fetcher: async () => new Response('{"message":"No data available for the selected date."}'),
        },
        undefined,
      ),
    ).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 21_600 });
    await expect(
      collectRenPeriodic(
        { config: { service: "gas-storage" }, apiOrigin: REN_PERIODIC_ORIGIN, fetcher: async () => new Response("oops", { status: 429, headers: { "retry-after": "60" } }) },
        undefined,
      ),
    ).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 60 });
  });

  it("refuses a redirect without using the edge-unsupported error redirect mode", async () => {
    const fetcher = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "https://evil.example/data" } });
    });
    await expect(collectRenPeriodic({ config: { service: "gas-storage" }, apiOrigin: REN_PERIODIC_ORIGIN, fetcher, now: () => NOW }, undefined)).rejects.toMatchObject({
      code: "upstream-error",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses completed calendar months across a year boundary", async () => {
    const requested: string[] = [];
    await collectRenPeriodic(
      {
        config: { service: "installed-capacity" },
        apiOrigin: REN_PERIODIC_ORIGIN,
        now: () => new Date("2026-01-01T00:30:00Z"),
        fetcher: async (input) => {
          const url = new URL(input.toString());
          requested.push(`${url.searchParams.get("year")}-${url.searchParams.get("month")}`);
          return new Response(fixture("ren-installed-capacity.json"));
        },
      },
      undefined,
    );
    expect(requested).toEqual(["2025-12", "2025-11", "2025-10"]);
  });

  it("preserves daily GWh and percentage units, zero flows, and source dates", async () => {
    const result = await normalized("gas-storage");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ kind: "series", updateMode: "source-window" });
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0]?.point).toMatchObject({ seriesKey: "stored-energy", value: 3354, unit: "GWh", eventTime: "2026-09-14T00:00:00.000Z" });
    expect(result.rows[1]?.point?.value).toBe(0);
    expect(result.rows[3]?.point).toMatchObject({ value: 93.9, unit: "%" });
    expect(result).toEqual(await normalized("gas-storage", "2030-01-01T00:00:00Z"));
  });

  it("does not turn missing generating capacity into zero", async () => {
    const result = await normalized("installed-capacity");
    expect(result.rows).toHaveLength(4);
    expect(result.rows.every((row) => row.point?.unit === "MW")).toBe(true);
    expect(result.rows.find((row) => row.point?.seriesKey === "COAL")).toBeUndefined();
    expect(result.rows.find((row) => row.point?.seriesKey === "WAVE")?.point?.value).toBe(0);
    expect(result.rows[0]?.point?.eventTime).toBe("2026-09-01T00:00:00.000Z");
  });

  it("enforces per-response byte bounds and validates the configured origin", async () => {
    const options = { config: { service: "gas-storage" }, apiOrigin: REN_PERIODIC_ORIGIN, fetcher: async () => new Response("{}", { headers: { "content-length": "999999" } }) };
    await expect(collectRenPeriodic(options, undefined)).rejects.toMatchObject({ code: "response-too-large" });
    await expect(collectRenPeriodic({ ...options, apiOrigin: "https://evil.example" }, undefined)).rejects.toMatchObject({ code: "source-denied" });
  });

  it("runs through a periodic feed's own file and emits valid normalized frames", async () => {
    const libraries = carriedLibraries("ren");
    const resolved = await resolveLibraryFeed({ service: "gas-storage", day: "2026-09-14", source: "ren" }, libraries);
    const request: CollectionRequest = {
      protocol: NORMALIZED_PROTOCOL,
      collectionId: "ren-periodic",
      feed: { id: "test", slug: "ren-gas-storage-feed", title: "Storage", description: "Storage" },
      resolved,
      feedEpoch: "test",
      mode: { kind: "live" },
      observedAt: NOW.toISOString(),
      deadline: new Date(Date.now() + 30_000).toISOString(),
      limits: { sourceBytes: 100_000, outputBytes: 100_000, frameBytes: 50_000, recordBytes: 20_000, products: 10, records: 1000 },
    };
    const collector = feedCollector(periodicFeed("gas-storage"), resolved.config, libraries, { fetcher: async () => new Response(fixture("ren-daily-storage.json")) });
    const result = await collectNormalized(request, collector);
    if (result.kind !== "batch") throw new Error(`Expected batch, got ${result.kind}`);
    const lines = (await new Response(result.stream).text()).trim().split("\n");
    expect(lines.every((line) => isNormalizedFrame(parseJson(line)))).toBe(true);
    expect(parseJson(lines.at(-1)!)).toMatchObject({ type: "complete", counts: { points: 4, records: 0 } });
    expect(await collectNormalized({ ...request, mode: { kind: "history", cursor: { before: "2025-01-01T00:00:00Z" } } }, collector)).toMatchObject({
      kind: "failure",
      code: "history-unsupported",
    });
  });
});
