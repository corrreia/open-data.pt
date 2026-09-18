import { jsonAs } from "./support";
import { describe, expect, it, vi } from "vitest";
import { GBFS_MAX_BYTES, collectGbfsFeed, validateGbfsFeedConfig } from "../packages/gatekeeper-shared/src/formats/gbfs/gbfs";
import { GBFS_EXAMPLES } from "../packages/gatekeeper-shared/src/formats/gbfs/examples";

import type { JsonObject, JsonValue, SourceBody, SourceFetch } from "@open-data-pt/gatekeeper-shared";
import { libraryConfig } from "@open-data-pt/gatekeeper-shared";
const DISCOVERY_URL = "https://mds.bird.co/gbfs/v2/public/lisbon/gbfs.json";
const ALLOWED_HOSTS = "data.lime.bike,mds.bird.co,gbfs.primelayer.pt,gbfs.nextbike.net";
const allowedHosts = new Set(ALLOWED_HOSTS.split(","));
const newExampleSlugs = new Set(["bird-cascais", "bird-matosinhos", "bird-porto", "tubabike-barcelos"]);
const newExamples = GBFS_EXAMPLES.filter((example) => newExampleSlugs.has(example.slug));

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

function successfulFetcher(options?: { oversizedVehicles?: boolean; restamped?: boolean }) {
  const bump = options?.restamped ? 600 : 0;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url === DISCOVERY_URL) {
      const headers = new Headers(init?.headers);
      expect(headers.get("accept")).toBe("application/json");
      expect(headers.get("if-none-match")).toBeNull();
      expect(headers.get("if-modified-since")).toBeNull();
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
            name: "station_information",
            url: "https://mds.bird.co/station_information.json",
          },
          {
            name: "station_status",
            url: "https://mds.bird.co/station_status.json",
          },
          {
            name: "free_bike_status",
            url: "https://mds.bird.co/free_bike_status.json",
          },
        ]),
        { "Last-Modified": "Mon, 07 Sep 2026 20:56:00 GMT" },
      );
    }
    if (url.endsWith("/station_information.json")) {
      return jsonResponse(
        envelope(
          {
            stations: [{ station_id: "dock-1", name: "Cais do Sodré", lat: 38.7, lon: -9.14, capacity: 12 }],
          },
          1_788_814_600 + bump,
        ),
      );
    }
    if (url.endsWith("/station_status.json")) {
      return jsonResponse(
        envelope(
          {
            stations: [
              {
                station_id: "dock-1",
                num_bikes_available: 4,
                num_docks_available: 8,
                is_installed: true,
                is_renting: true,
                is_returning: true,
                last_reported: 1_788_814_600 + bump,
              },
            ],
          },
          1_788_814_600 + bump,
        ),
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
          1_788_814_620 + bump,
        ),
      );
    }
    throw new Error(`Unexpected URL ${url}`);
  });
}

describe("GBFS Gatekeeper", () => {
  it("normalizes an allowlisted discovery URL and optional language, defaulting to the status part", () => {
    expect(validateGbfsFeedConfig({ url: DISCOVERY_URL, language: " EN-gb " }, allowedHosts)).toEqual({ url: DISCOVERY_URL, language: "en-gb", feed: "status" });
    expect(validateGbfsFeedConfig({ url: DISCOVERY_URL, feed: "reference" }, allowedHosts)).toEqual({ url: DISCOVERY_URL, feed: "reference" });
    expect(() => validateGbfsFeedConfig({ url: DISCOVERY_URL, feed: "stations" }, allowedHosts)).toThrow("GBFS feed must be one of");
  });

  it("pairs every system with a daily reference feed that keeps the status slug's history", () => {
    const status = GBFS_EXAMPLES.filter((example) => example.config.feed === "status");
    const reference = GBFS_EXAMPLES.filter((example) => example.config.feed === "reference");

    expect(status.map((example) => example.slug).toSorted()).toEqual([
      "bird-braga",
      "bird-cascais",
      "bird-lisbon",
      "bird-matosinhos",
      "bird-porto",
      "bora-viseu",
      "lime-lisbon",
      "tubabike-barcelos",
    ]);
    expect(reference.map((example) => example.slug).toSorted()).toEqual(status.map((example) => `${example.slug}-reference`).toSorted());
    expect(reference.every((example) => example.policy.collection.cadenceSeconds === 86_400)).toBe(true);
    for (const example of reference) {
      const partner = status.find((candidate) => `${candidate.slug}-reference` === example.slug);
      expect(example.config.url).toBe(partner?.config.url);
      expect(example.config.language).toBe(partner?.config.language);
    }
  });

  it("polls each system as fast as its data really moves", () => {
    const cadence = (slug: string) => GBFS_EXAMPLES.find((example) => example.slug === slug)?.policy.collection.cadenceSeconds;

    expect(cadence("bird-lisbon")).toBe(180);
    expect(cadence("bird-cascais")).toBe(300);
    expect(cadence("bird-matosinhos")).toBe(300);
    expect(cadence("bird-porto")).toBe(300);
    // Lime answers HTTP 429 at five minutes, TubaBike changed once in 459 station revisions, and Braga is empty.
    expect(cadence("lime-lisbon")).toBe(600);
    expect(cadence("tubabike-barcelos")).toBe(600);
    expect(cadence("bora-viseu")).toBe(600);
    expect(cadence("bird-braga")).toBe(86_400);
  });

  it.each(newExamples)("validates the curated $title example", (example) => {
    const config = libraryConfig(example.config);
    expect(validateGbfsFeedConfig(config, allowedHosts)).toEqual(config);
  });

  it("ships every working additional Portuguese system", () => {
    expect(newExamples.map((example) => example.slug)).toEqual(["bird-cascais", "bird-matosinhos", "bird-porto", "tubabike-barcelos"]);
    expect(GBFS_EXAMPLES.some((example) => example.slug === "bird-braga")).toBe(true);
    expect(newExamples.every((example) => example.policy.collection.cadenceSeconds === (example.publisher === "bird" ? 300 : 600))).toBe(true);
    expect(
      newExamples
        .filter((example) => example.publisher === "bird")
        .every((example) => example.policy.collection.withoutHistory?.includes("vehicles") && example.policy.collection.withoutHistory.includes("stations")),
    ).toBe(true);
  });

  it("rejects malformed configuration and non-allowlisted hosts", () => {
    expect(() => validateGbfsFeedConfig({ url: "http://mds.bird.co/gbfs.json" }, allowedHosts)).toThrow("must be an HTTPS URL");
    expect(() => validateGbfsFeedConfig({ url: "https://example.com/gbfs.json" }, allowedHosts)).toThrow("host example.com is not allowed");
    expect(() => validateGbfsFeedConfig({ url: DISCOVERY_URL, arbitrary: "value" }, allowedHosts)).toThrow("does not accept arbitrary");
  });

  it("collects only the fast half for the status part, with typed provenance", async () => {
    const fetcher = successfulFetcher();
    const fetched = sourceBody(await collectGbfsFeed({ url: DISCOVERY_URL, language: "en" }, undefined, ALLOWED_HOSTS, fetcher));
    const document = jsonAs<JsonObject>(await bodyBytes(fetched));

    expect(fetched.provenance).toEqual({
      sourceUrl: DISCOVERY_URL,
      sourcePublishedAt: "2026-09-07T20:57:00.000Z",
    });
    expect(fetched.completeness).toBe("complete");
    expect(fetched.validator).toEqual({ etag: expect.stringMatching(/^"sha256-[0-9a-f]{64}"$/u) });
    expect(Object.keys(document)).toEqual(["discovery", "system_information", "vehicle_types", "station_status", "free_bike_status"]);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("collects only the slow half for the reference part", async () => {
    const fetcher = successfulFetcher();
    const fetched = sourceBody(await collectGbfsFeed({ url: DISCOVERY_URL, feed: "reference" }, undefined, ALLOWED_HOSTS, fetcher));
    const document = jsonAs<JsonObject>(await bodyBytes(fetched));

    expect(Object.keys(document)).toEqual(["discovery", "system_information", "station_information"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("reports unchanged when only the publication timestamps moved", async () => {
    const first = sourceBody(await collectGbfsFeed({ url: DISCOVERY_URL }, undefined, ALLOWED_HOSTS, successfulFetcher()));
    const again = await collectGbfsFeed({ url: DISCOVERY_URL }, first.validator, ALLOWED_HOSTS, successfulFetcher({ restamped: true }));

    expect(again).toEqual({ kind: "not-modified", validator: first.validator });
  });

  it("collects again when a station's counts moved under an unchanged timestamp", async () => {
    const first = sourceBody(await collectGbfsFeed({ url: DISCOVERY_URL }, undefined, ALLOWED_HOSTS, successfulFetcher()));
    const changed = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await successfulFetcher()(input, init);
      if (!input.toString().endsWith("/station_status.json")) return response;
      const text = (await response.text()).replace('"num_bikes_available":4', '"num_bikes_available":5');
      return new Response(text, { headers: { "Content-Type": "application/json" } });
    });

    const again = await collectGbfsFeed({ url: DISCOVERY_URL }, first.validator, ALLOWED_HOSTS, changed);

    expect(again.kind).toBe("body");
    expect(again.validator?.etag).not.toBe(first.validator?.etag);
  });

  it("marks a compound document partial when an optional feed exceeds the cap", async () => {
    const fetched = sourceBody(await collectGbfsFeed({ url: DISCOVERY_URL }, undefined, ALLOWED_HOSTS, successfulFetcher({ oversizedVehicles: true })));
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
    await expect(collectGbfsFeed({ url: DISCOVERY_URL }, undefined, ALLOWED_HOSTS, fetcher)).rejects.toThrow("exceeded");
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
    await expect(collectGbfsFeed({ url: DISCOVERY_URL }, undefined, ALLOWED_HOSTS, fetcher)).rejects.toThrow("host example.com is not allowed");
  });

  it("turns provider failures into an upstream error", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));
    await expect(collectGbfsFeed({ url: DISCOVERY_URL }, undefined, ALLOWED_HOSTS, fetcher)).rejects.toMatchObject({ code: "upstream-error" });
  });
});
