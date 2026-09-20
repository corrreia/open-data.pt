import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asStringList, parseJson, type ExampleFeed } from "@open-data-pt/gatekeeper-shared";
import { CARRIED } from "./catalog";

interface LibraryExamples {
  library: string;
  examples: ExampleFeed[];
}
const libraries: LibraryExamples[] = CARRIED.map((library) => ({ library: library.deployment.source, examples: [...library.examples] }));
const baseline = new Set(asStringList(parseJson(readFileSync(new URL("./fixtures/source-expansion-baseline-slugs.json", import.meta.url), "utf8"))));

describe("source expansion inventory", () => {
  it("retains every previously installed feed and assigns each slug to exactly one library", () => {
    // Two feeds left the baseline as duplicates of another feed's values: ren-consumption-feed (the Consumption series
    // of ren-production-breakdown) and dgeg-gasolina-98-lisboa (a district subset of dgeg-gasolina-98). A third,
    // porto-museums-feed, left because its dataset did not survive Porto's September 2026 move to
    // dadosabertos.cm-porto.pt: the municipality publishes no museum inventory there under any name.
    // A fourth, lime-lisbon, left in September 2026 because Lime's Public GBFS Terms — the document its
    // own feed names in `license_url` — forbid redistributing the data, building a dataset from it, and
    // storing it for more than ten minutes. This service does all three, so the feed cannot be carried.
    expect(baseline.size).toBe(166);
    const examples = libraries.flatMap((library) => library.examples);
    const slugs = new Set(examples.map((example) => example.slug));
    expect(slugs.size).toBe(examples.length);
    for (const slug of baseline) expect(slugs.has(slug), `Removing ${slug} would retire production state`).toBe(true);
    expect(examples.filter((example) => !baseline.has(example.slug)).length).toBeGreaterThanOrEqual(84);
  });

  it("gives every added feed an explicit source, positive bounded policy and attribution", () => {
    const additions = libraries.flatMap(({ library, examples }) => examples.filter((example) => !baseline.has(example.slug)).map((example) => ({ library, ...example })));
    for (const example of additions) {
      expect(example.config.source).toBeTruthy();
      expect(example.publisher).toBeTruthy();
      expect(example.policy.serving.attribution).toBeTruthy();
      expect(example.policy.serving.licence).toBeTruthy();
      expect(Number.isSafeInteger(example.policy.collection.cadenceSeconds)).toBe(true);
      expect(example.policy.collection.cadenceSeconds).toBeGreaterThanOrEqual(60);
      expect(example.policy.collection.maxBytes).toBeGreaterThan(0);
      expect(example.policy.collection.timeoutSeconds).toBeGreaterThan(0);
    }
    // Optional release evidence, never an automatic change to application state.
    if (process.env.SOURCE_EXPANSION_REPORT)
      writeFileSync(process.env.SOURCE_EXPANSION_REPORT, JSON.stringify({ baselineCount: baseline.size, addedCount: additions.length, additions }, null, 2));
  });
});
