import { jsonAs } from "./support";
import { describe, expect, it, vi } from "vitest";
import {
  GBFS_MAX_BYTES,
  collectGbfsFeed,
  validateGbfsFeedConfig,
} from "../packages/gatekeeper-shared/src/formats/gbfs/gbfs";
import { GBFS_EXAMPLES } from "../packages/gatekeeper-shared/src/formats/gbfs/examples";

import type {
  JsonObject,
  JsonValue,
  SourceBody,
  SourceFetch,
} from "@open-data-pt/gatekeeper-shared";
import { libraryConfig } from "@open-data-pt/gatekeeper-shared";
const DISCOVERY_URL = "https://mds.bird.co/gbfs/v2/public/lisbon/gbfs.json";
const ALLOWED_HOSTS =
  "data.lime.bike,mds.bird.co,gbfs.primelayer.pt,gbfs.nextbike.net";
const allowedHosts = new Set(ALLOWED_HOSTS.split(","));
const newExampleSlugs = new Set([
  "bird-cascais",
  "bird-matosinhos",
  "bird-porto",
  "tubabike-barcelos",
]);
const newExamples = GBFS_EXAMPLES.filter((example) =>
  newExampleSlugs.has(example.slug)
);

function jsonResponse(value: JsonValue, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function sourceBody(fetched: SourceFetch): SourceBody {
  if (fetched.kind !== "body") {
    throw new Error(`Expected a source body, got ${fetched.kind}`);
  }
  return fetched;
}

async function bodyBytes(fetched: SourceBody): Promise<Uint8Array> {
  return new Uint8Array(await new Response(fetched.body).arrayBuffer());
}

function envelope(data: JsonObject, lastUpdated = 1_788_814_600) {
  return { last_updated: lastUpdated, ttl: 60, version: "2.3", data };
}

function discovery(feeds: Array<{ name: string; url: string }>) {
  return envelope({ en: { feeds } });
}

function successfulFetcher(options?: { oversizedVehicles?: boolean }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url === DISCOVERY_URL) {
      const headers = new Headers(init?.headers);
      expect(headers.get("accept")).toBe("application/json");
      return jsonResponse(
        discovery([
          {
            name: "system_information",
            url: "https://mds.bird.co/system_information.json",
          },
          {
            name: "vehicle_types",
            url: "https://mds.bird.co/vehicle_types.json",
          },
          {
            name: "free_bike_status",
            url: "https://mds.bird.co/free_bike_status.json",
          },
        ]),
        { "Last-Modified": "Mon, 07 Sep 2026 20:56:00 GMT" },
      );
    }
    if (url.endsWith("/system_information.json")) {
      return jsonResponse(
        envelope({
          system_id: "bird-lisbon",
          name: "Bird Lisbon",
          timezone: "Europe/Lisbon",
        }),
      );
    }
    if (url.endsWith("/vehicle_types.json")) {
      return jsonResponse(
        envelope({
          vehicle_types: [
            {
              vehicle_type_id: "scooter",
              form_factor: "scooter-standing",
              propulsion_type: "electric",
            },
          ],
        }),
      );
    }
    if (url.endsWith("/free_bike_status.json")) {
      if (options?.oversizedVehicles) {
        return jsonResponse(envelope({ bikes: [] }), {
          "Content-Length": String(GBFS_MAX_BYTES),
        });
      }
      return jsonResponse(
        envelope(
          {
            bikes: [
              {
                bike_id: "opaque-1",
                lat: 38.72,
                lon: -9.14,
                is_reserved: false,
                is_disabled: false,
                vehicle_type_id: "scooter",
              },
            ],
          },
          1_788_814_620,
        ),
      );
    }
    throw new Error(`Unexpected URL ${url}`);
  });
}

describe("GBFS Gatekeeper", () => {
  it("normalizes an allowlisted discovery URL and optional language", () => {
    expect(
      validateGbfsFeedConfig(
        { url: DISCOVERY_URL, language: " EN-gb " },
        allowedHosts,
      ),
    ).toEqual({ url: DISCOVERY_URL, language: "en-gb" });
  });

  it.each(newExamples)("validates the curated $title example", (example) => {
    const config = libraryConfig(example.config);
    expect(validateGbfsFeedConfig(config, allowedHosts)).toEqual(config);
  });

  it("ships every working additional Portuguese system", () => {
    expect(newExamples.map((example) => example.slug)).toEqual([
      "bird-cascais",
      "bird-matosinhos",
      "bird-porto",
      "tubabike-barcelos",
    ]);
    expect(GBFS_EXAMPLES.some((example) => example.slug === "bird-braga")).toBe(true);
    expect(newExamples.every((example) =>
      example.policy.collection.cadenceSeconds === (example.publisher === "Bird" ? 300 : 180)
    )).toBe(true);
    expect(newExamples.filter((example) => example.publisher === "Bird").every((example) =>
      example.policy.collection.withoutHistory?.includes("vehicles")
      && example.policy.collection.withoutHistory.includes("stations")
    )).toBe(true);
  });

  it("rejects malformed configuration and non-allowlisted hosts", () => {
    expect(() =>
      validateGbfsFeedConfig(
        { url: "http://mds.bird.co/gbfs.json" },
        allowedHosts,
      ),
    ).toThrow("must be an HTTPS URL");
    expect(() =>
      validateGbfsFeedConfig(
        { url: "https://example.com/gbfs.json" },
        allowedHosts,
      ),
    ).toThrow("host example.com is not allowed");
    expect(() =>
      validateGbfsFeedConfig(
        { url: DISCOVERY_URL, arbitrary: "value" },
        allowedHosts,
      ),
    ).toThrow("does not accept arbitrary");
  });

  it("collects a deterministic compound document with typed provenance", async () => {
    const fetcher = successfulFetcher();
    const fetched = sourceBody(
      await collectGbfsFeed(
        { url: DISCOVERY_URL, language: "en" },
        undefined,
        ALLOWED_HOSTS,
        fetcher,
      ),
    );
    const document = jsonAs<JsonObject>(await bodyBytes(fetched));

    expect(fetched.provenance).toEqual({
      sourceUrl: DISCOVERY_URL,
      sourcePublishedAt: "2026-09-07T20:57:00.000Z",
    });
    expect(fetched.completeness).toBe("complete");
    expect(fetched.validator?.etag).toMatch(/^"gbfs-[0-9a-f]{16}"$/u);
    expect(fetched.validator?.lastModified).toBe(
      "Mon, 07 Sep 2026 20:56:00 GMT",
    );
    expect(Object.keys(document)).toEqual([
      "discovery",
      "system_information",
      "vehicle_types",
      "free_bike_status",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("forwards a checkpoint and passes through an upstream 304", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("if-none-match")).toBe('"previous"');
      expect(headers.get("if-modified-since")).toBe(
        "Mon, 07 Sep 2026 20:50:00 GMT",
      );
      return new Response(null, {
        status: 304,
        headers: { ETag: '"current"' },
      });
    });

    const fetched = await collectGbfsFeed(
      { url: DISCOVERY_URL },
      {
        etag: '"previous"',
        lastModified: "Mon, 07 Sep 2026 20:50:00 GMT",
      },
      ALLOWED_HOSTS,
      fetcher,
    );

    expect(fetched).toEqual({
      kind: "not-modified",
      validator: {
        etag: '"current"',
        lastModified: "Mon, 07 Sep 2026 20:50:00 GMT",
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("reports unchanged when the newest feed's last_updated did not move", async () => {
    const first = sourceBody(
      await collectGbfsFeed(
        { url: DISCOVERY_URL },
        undefined,
        ALLOWED_HOSTS,
        successfulFetcher(),
      ),
    );
    const again = await collectGbfsFeed(
      { url: DISCOVERY_URL },
      first.validator,
      ALLOWED_HOSTS,
      successfulFetcher(),
    );

    expect(again).toEqual({ kind: "not-modified", validator: first.validator });
  });

  it("marks a compound document partial when an optional feed exceeds the cap", async () => {
    const fetched = sourceBody(
      await collectGbfsFeed(
        { url: DISCOVERY_URL },
        undefined,
        ALLOWED_HOSTS,
        successfulFetcher({ oversizedVehicles: true }),
      ),
    );
    const bytes = await bodyBytes(fetched);
    const document = jsonAs<JsonObject>(bytes);

    expect(fetched.completeness).toBe("partial");
    expect(document.free_bike_status).toBeUndefined();
    expect(bytes.byteLength).toBeLessThanOrEqual(GBFS_MAX_BYTES);
  });

  it("rejects a discovery response that exceeds its explicit byte cap", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(discovery([]), {
        "Content-Length": String(GBFS_MAX_BYTES + 1),
      }),
    );
    await expect(
      collectGbfsFeed(
        { url: DISCOVERY_URL },
        undefined,
        ALLOWED_HOSTS,
        fetcher,
      ),
    ).rejects.toThrow("exceeded");
  });

  it("rejects child feed URLs outside the allowlist", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        discovery([
          {
            name: "system_information",
            url: "https://example.com/system_information.json",
          },
        ]),
      ),
    );
    await expect(
      collectGbfsFeed(
        { url: DISCOVERY_URL },
        undefined,
        ALLOWED_HOSTS,
        fetcher,
      ),
    ).rejects.toThrow("host example.com is not allowed");
  });

  it("turns provider failures into an upstream error", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));
    await expect(
      collectGbfsFeed(
        { url: DISCOVERY_URL },
        undefined,
        ALLOWED_HOSTS,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "upstream-error" });
  });
});
