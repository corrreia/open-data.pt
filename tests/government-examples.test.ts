import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ExampleFeed, type NormalizedRow, type TransformContext } from "@open-data-pt/gatekeeper-shared";
import { UDATA_EXAMPLES, udataCollector } from "@open-data-pt/gatekeeper-shared/formats/udata";
import { INSTALLED } from "./catalog";
import { INE_EXAMPLES } from "../packages/gatekeeper-shared/src/sources/ine/examples";

/** Topics are catalog tags now, so these are the installed feeds carrying each tag, whatever Worker reads them. */
const tagged = (topic: string): ExampleFeed[] => INSTALLED.filter((example) => example.topics?.includes(topic));
const GOVERNMENT_EXAMPLES = tagged("government");
const CITIES_EXAMPLES = tagged("cities");
const TELECOM_EXAMPLES = tagged("telecom");
const government = UDATA_EXAMPLES.filter((example) => example.topics?.includes("government"));

async function normalized(example: ExampleFeed, observedAt: string) {
  const text = readFileSync(new URL(example.config.format === "csv" ? "./fixtures/cada-opinions.csv" : "./fixtures/government-registry-sample.json", import.meta.url), "utf8");
  const collector = udataCollector({
    config: example.config,
    hosts: "dados.gov.pt",
    fetcher: async (input) => {
      const url = new URL(input.toString());
      expect(url.origin).toBe("https://dados.gov.pt");
      if (url.pathname.startsWith("/api/1/datasets/r/")) return new Response(text, { headers: { etag: '"fixture"' } });
      return new Response(
        JSON.stringify({ resources: [{ id: example.config.distributionId ?? "rotating-id", format: example.config.format, url: "https://dados.gov.pt/example-data" }] }),
      );
    },
  });
  const resolved = await collector.resolve(example.config);
  const source = await collector.source(undefined, { kind: "live" }, new AbortController().signal);
  if (source.kind !== "body" || collector.normalize.kind !== "streaming") throw new Error("Expected streaming table");
  const context: TransformContext = {
    observedAt,
    feed: { slug: example.slug, title: example.title, description: example.description, config: resolved.config, semantics: resolved.semantics },
  };
  const result = await collector.normalize.transform(new Response(source.body).body!, context);
  const rows: NormalizedRow[] = [];
  for await (const row of result.rows) rows.push(row);
  return { products: result.products, rows, summary: result.finish() };
}

describe("government distribution examples", () => {
  it("tags government distributions as government, never as cities", () => {
    expect(government).toHaveLength(5);
    for (const example of government) {
      expect(GOVERNMENT_EXAMPLES.filter((candidate) => candidate.slug === example.slug)).toHaveLength(1);
      expect(CITIES_EXAMPLES.some((candidate) => candidate.slug === example.slug)).toBe(false);
      expect(example.policy.collection.cadenceSeconds).toBeGreaterThanOrEqual(604_800);
    }
    expect(government.find((example) => example.slug === "base-procurement-entities-feed")?.policy.collection.cadenceSeconds).toBe(30 * 86_400);
    expect(government.find((example) => example.slug === "recognised-startups-feed")?.policy.serving.licence).toBe("source-terms");
  });

  it.each(government)("normalizes $slug as one table without acquisition-time churn", async (example) => {
    const first = await normalized(example, "2026-09-15T12:00:00Z");
    expect(first.products).toHaveLength(1);
    expect(first.products[0]).toMatchObject({ kind: "record", updateMode: "authoritative-snapshot" });
    expect(first.rows).toHaveLength(2);
    const identity = example.config.keyField!;
    expect(first.products[0]?.schema.fields.find((field) => field.name === identity)?.type).toBe("identifier");
    expect(first.rows[0]?.record?.payload[identity]).toBe(first.rows[0]?.record?.entityKey);
    expect(first).toEqual(await normalized(example, "2027-01-01T00:00:00Z"));
  });

  it("uses keyless government telecom statistics without claiming live coverage", () => {
    const telecom = INE_EXAMPLES.filter((example) => example.topics?.includes("telecom"));
    expect(telecom).toHaveLength(6);
    expect(TELECOM_EXAMPLES.map((example) => example.slug).toSorted()).toEqual(telecom.map((example) => example.slug).toSorted());
    for (const example of telecom) {
      expect(example.policy.collection.cadenceSeconds).toBe(30 * 86_400);
      expect(example.policy.serving.licence).toBe("cc-by-4.0");
      expect(example.config.indicator).not.toBe("0006853");
    }
  });

  it("uses the current income series and a monthly poll for annual releases", () => {
    const slugs = [
      "ine-taxpayer-income-distribution",
      "ine-median-household-income-after-tax",
      "ine-household-income-gini",
      "ine-declared-income-per-inhabitant",
      "ine-household-income-p90-p10",
    ];
    const examples = INE_EXAMPLES.filter((example) => slugs.includes(example.slug));
    expect(examples).toHaveLength(5);
    for (const example of examples) {
      expect(example.config.indicator).not.toBe("0009940");
      expect(example.config.dims).toBeUndefined();
      expect(example.policy.collection.cadenceSeconds).toBe(30 * 86_400);
    }
  });
});
