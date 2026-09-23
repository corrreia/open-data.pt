import { readFixtureBytes } from "#/tests/support";
import { describe, expect, it } from "vitest";
import { MunicipalAccessibilityTransformer } from "#/publishers/demarca-design/municipal-accessibility";
import type { CanonicalRecord, TransformContext } from "@open-data-pt/contract";

const feed: TransformContext["feed"] = {
  slug: "municipal-accessibility-feed",
  title: "Municipal accessibility",
  description: "test feed",
  config: { feed: "distribution" },
  semantics: { domainSubject: "reference", defaultProductRole: "reference" },
};

function fixtureStream(chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = readFixtureBytes(new URL("./fixtures/municipal-accessibility.csv", import.meta.url));
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

describe("Municipal accessibility transformer", () => {
  it("turns Portuguese source columns into a typed public product, row by row", async () => {
    for (const chunkSize of [1, 64 * 1024]) {
      const transform = await new MunicipalAccessibilityTransformer().transform(fixtureStream(chunkSize), {
        feed,
        observedAt: "2026-09-07T00:00:00Z",
      });
      expect(transform.products.map((product) => product.productKey)).toEqual(["municipal-accessibility"]);
      const records: CanonicalRecord[] = [];
      for await (const row of transform.rows) if (row.record) records.push(row.record);
      expect(records[0]).toEqual({
        entityKey: "Amadora",
        payload: {
          municipality: "Amadora",
          accessibilityScore: 7.8,
          pagesEvaluated: 248,
          aaCompliantPages: 0,
          declarationStatus: null,
          accessibilitySeal: null,
          websiteCount: 1,
        },
      });
      expect(records).toHaveLength(4);
      expect(records[3]?.payload.declarationStatus).toBe("plenamente conforme");
      expect(transform.finish().quality).toEqual({ acceptedRecords: 4, rejectedRecords: 0 });
    }
  });
});
