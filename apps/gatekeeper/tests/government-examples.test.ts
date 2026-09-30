import { describe, expect, it } from "vitest";
import { type NormalizedRow, type TransformContext } from "@open-data-pt/contract";
import { feedCollection, feedsOf } from "./catalog";
import { readFixture } from "./support";
import type { DeclaredFeed } from "@open-data-pt/gatekeeper/catalog";

const government = feedsOf("udata").filter((example) => example.topics.includes("government"));

async function normalized(example: DeclaredFeed, observedAt: string) {
  const text = readFixture(new URL(example.config.format === "csv" ? "./fixtures/cada-opinions.csv" : "./fixtures/government-registry-sample.json", import.meta.url));
  const { resolved, collector } = await feedCollection(example.slug, {
    fetcher: async (input) => {
      const url = new URL(input.toString());
      expect(url.origin).toBe("https://dados.gov.pt");
      if (url.pathname.startsWith("/api/1/datasets/r/")) return new Response(text, { headers: { etag: '"fixture"' } });
      return new Response(
        JSON.stringify({ resources: [{ id: example.config.distributionId ?? "rotating-id", format: example.config.format, url: "https://dados.gov.pt/example-data" }] }),
      );
    },
  });
  const source = await collector.source(undefined, { kind: "live" }, new AbortController().signal);
  if (source.kind !== "body" || collector.normalize.kind !== "streaming") throw new Error("Expected streaming table");
  const context: TransformContext = {
    observedAt,
    feed: {
      slug: example.slug,
      title: example.title,
      description: example.description,
      config: resolved.config,
      semantics: resolved.semantics,
    },
  };
  const result = await collector.normalize.transform(new Response(source.body).body!, context);
  const rows: NormalizedRow[] = [];
  for await (const row of result.rows) rows.push(row);
  return { products: result.products, rows, summary: result.finish() };
}

describe("government distribution examples", () => {
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
});
