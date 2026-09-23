import { readFixture } from "#/tests/support";
import { describe, expect, it } from "vitest";
import { isJsonObject, libraryConfig, parseJson, type ExampleFeed, type JsonObject, type JsonValue, type SourceConfig, type TransformContext } from "#/index";
import { datasetOf, feedsOf } from "#/tests/catalog";
import { collectBpstatDataset, validateBpstatFeedConfig } from "#/publishers/banco-de-portugal/bpstat/bpstat";
import { transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/transform";

const BPSTAT_EXAMPLES = feedsOf("bpstat");
/** The feeds that select series and their latest observations: the catalog expansion. */
const CATALOG_EXAMPLES = BPSTAT_EXAMPLES.filter((example) => example.config.seriesIds !== undefined);

function fixture(slug: string): JsonObject {
  const value = parseJson(readFixture(new URL(`./fixtures/examples/${slug}.json`, import.meta.url)));
  if (!isJsonObject(value)) throw new Error("Invalid fixture");
  return value;
}

function context(example: ExampleFeed, observedAt = "2026-09-16T00:00:00Z"): TransformContext {
  return {
    feed: {
      slug: example.slug,
      title: example.title ?? datasetOf(example).title,
      description: example.description ?? datasetOf(example).description,
      config: { ...libraryConfig(example.config), lastN: "2" },
      semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
    },
    observedAt,
  };
}

function encode(value: JsonObject): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

const BANKNOTES: SourceConfig = { domain: "9", dataset: "002abf63d5a4efb3e35ab5321251d7c5", lang: "EN", seriesIds: "12468838,12468839", lastN: "2" };
const BANKNOTES_URL = `https://bpstat.bportugal.pt/data/v1/domains/9/datasets/${BANKNOTES.dataset}/?lang=EN&series_ids=12468838%2C12468839&obs_last_n=2`;

describe("BPstat catalog expansion", () => {
  it("adds ten precise selections without duplicate dataset or series identities", () => {
    expect(CATALOG_EXAMPLES).toHaveLength(10);
    expect(BPSTAT_EXAMPLES).toHaveLength(14);
    expect(new Set(BPSTAT_EXAMPLES.map((example) => example.slug)).size).toBe(14);
    expect(new Set(BPSTAT_EXAMPLES.map((example) => example.config.dataset)).size).toBe(14);
    const ids = new Set<string>();
    for (const example of CATALOG_EXAMPLES) {
      const config = validateBpstatFeedConfig(libraryConfig(example.config));
      for (const id of config.seriesIds!.split(",")) {
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }
      expect(Number(config.lastN) * config.seriesIds!.split(",").length).toBeLessThanOrEqual(example.policy.collection.maxRecords!);
      expect(example.policy.collection.cadenceSeconds).toBeGreaterThanOrEqual(86_400);
    }
  });

  for (const example of CATALOG_EXAMPLES) {
    it(`decodes only the selected actual series for ${example.slug}`, () => {
      const document = fixture(example.slug);
      const extension = document.extension;
      if (!isJsonObject(extension) || !Array.isArray(extension.series)) throw new Error("Missing series metadata");
      const actualIds = extension.series.map((entry) => (isJsonObject(entry) ? String(entry.id) : "")).sort();
      expect(actualIds).toEqual(example.config.seriesIds!.split(",").sort());
      const first = transformBpstatDataset(encode(document), context(example));
      const second = transformBpstatDataset(encode(document), context(example, "2040-01-01T00:00:00Z"));
      expect(first).toEqual(second);
      expect(first.quality.rejectedRecords).toBe(0);
      expect(first.products).toHaveLength(1);
      const product = first.products[0];
      if (product?.kind !== "series") throw new Error("Expected one series product");
      expect(product.updateMode).toBe("source-window");
      expect(product.points.length).toBeGreaterThan(0);
      expect(product.points.length).toBeLessThanOrEqual(actualIds.length * 2);
      const keys = new Set(product.points.map((point) => `${point.seriesKey}|${point.eventTime}`));
      expect(keys.size).toBe(product.points.length);
      for (const point of product.points) {
        expect(point.unit).not.toBe("unknown");
        expect(point.seriesKey.length).toBeGreaterThan(0);
      }
    });
  }

  it("selects international trade from domain 53, not identically shaped vehicle registrations in domain 50", () => {
    const example = CATALOG_EXAMPLES.find((item) => item.slug === "bpstat-goods-trade-growth")!;
    expect(example.config.domain).toBe("53");
    const result = transformBpstatDataset(encode(fixture(example.slug)), context(example));
    expect(result.products[0]?.description).toContain("Cumulative year-on-year");
    expect(new Set(result.products[0]?.points?.map((point) => point.dimensions.Indicators))).toEqual(new Set(["Exports", "Imports"]));
    expect(result.products[0]?.points?.every((point) => point.unit === "Percentage")).toBe(true);
  });

  it("rejects malformed series and latest-observation scopes and canonicalizes series ordering", () => {
    expect(validateBpstatFeedConfig({ ...BANKNOTES, seriesIds: "12468839, 12468838,12468839" }).seriesIds).toBe("12468838,12468839");
    for (const options of [
      { seriesIds: "" },
      { seriesIds: "1;drop" },
      { seriesIds: "-1" },
      { seriesIds: "9007199254740992" },
      { lastN: "0" },
      { lastN: "367" },
      { lastN: "2.5" },
    ]) {
      expect(() => validateBpstatFeedConfig({ ...BANKNOTES, ...options })).toThrow();
    }
  });

  it("forwards filters on every page and does not trust a continuation that drops them", async () => {
    const document = fixture("bpstat-banknotes-issued");
    const next = `${BANKNOTES_URL}&page=2`;
    const seen: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      seen.push(String(input));
      return Response.json(seen.length === 1 ? { ...document, extension: { ...object(document.extension), next_page: next } } : document);
    };
    const fetched = await collectBpstatDataset(BANKNOTES, undefined, "https://bpstat.bportugal.pt", fetcher);
    expect(fetched.kind).toBe("body");
    expect(seen).toEqual([BANKNOTES_URL, next]);
    const unsafe: typeof fetch = async () =>
      Response.json({
        ...document,
        extension: { ...object(document.extension), next_page: `https://bpstat.bportugal.pt/data/v1/domains/9/datasets/${BANKNOTES.dataset}/?lang=EN&page=2` },
      });
    await expect(collectBpstatDataset(BANKNOTES, undefined, "https://bpstat.bportugal.pt", unsafe)).rejects.toThrow("unsafe next-page");
  });

  it("rejects an upstream response that ignores the selected series", async () => {
    const document = fixture("bpstat-banknotes-issued");
    const fetcher: typeof fetch = async () => Response.json({ ...document, extension: { ...object(document.extension), series: [{ id: 1 }] } });
    await expect(collectBpstatDataset(BANKNOTES, undefined, "https://bpstat.bportugal.pt", fetcher)).rejects.toThrow("outside the requested selection");
  });

  it("fails oversized per-series windows instead of publishing old observations as a latest slice", () => {
    const example = CATALOG_EXAMPLES.find((item) => item.slug === "bpstat-banknotes-issued")!;
    const configured = context(example);
    configured.feed.config.lastN = "1";
    expect(() => transformBpstatDataset(encode(fixture(example.slug)), configured)).toThrow("exceeded the requested latest-observation window");
  });
});

function object(value: JsonValue | undefined): JsonObject {
  if (!isJsonObject(value)) throw new Error("Expected object");
  return value;
}
