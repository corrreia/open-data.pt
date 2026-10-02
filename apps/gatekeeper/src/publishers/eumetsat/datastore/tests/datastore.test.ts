import { jsonAs, readFixture } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import { feedCollection } from "#/tests/catalog";
import { NORMALIZED_PROTOCOL, collectNormalized, isJsonObject, parseJson, type JsonObject, type JsonValue } from "#/index";
import { DATASTORE_API_ORIGIN, collectActiveFires, readCapFires } from "#/publishers/eumetsat/datastore/index";

const SLUG = "eumetsat-active-fires-feed";
const CREDENTIALS = { key: "consumer-key", secret: "consumer-secret" };
const SECRETS = { EUMETSAT_CONSUMER_KEY: CREDENTIALS.key, EUMETSAT_CONSUMER_SECRET: CREDENTIALS.secret };

/** The Data Store's listing of the 15:00 and 15:10 UTC scans of 15 August 2025, the day of the Arganil fire. */
const SEARCH = readFixture(new URL("./fixtures/search-20250815-1500.json", import.meta.url));
/**
 * The 15:00 scan's CAP message, cut to three likely fires near Arganil, one
 * in Cáceres and one in Mozambique, and one possible fire near Arganil and
 * one in Badajoz.
 */
const CAP = readFixture(new URL("./fixtures/fir-cap-20250815-1500.xml", import.meta.url));

/** Answers the token, the search and every file the way the Data Store does, and records what was asked. */
function dataStore(answer?: (url: URL) => Response | undefined) {
  const requested: URL[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    requested.push(url);
    const custom = answer?.(url);
    if (custom) return custom;
    if (url.origin !== DATASTORE_API_ORIGIN) return new Response("Not Found", { status: 404 });
    if (url.pathname === "/token") {
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization !== `Basic ${btoa("consumer-key:consumer-secret")}`) return new Response("{}", { status: 401 });
      return Response.json({ access_token: "token", scope: "default", token_type: "Bearer", expires_in: 3600 });
    }
    if (new Headers(init?.headers).get("authorization") !== "Bearer token") return new Response("Unauthorized", { status: 401 });
    if (url.pathname === "/data/search-products/1.0.0/os") return new Response(SEARCH, { headers: { "Content-Type": "application/json" } });
    if (url.pathname.endsWith("/entry")) return new Response(CAP, { headers: { "Content-Type": "application/xml" } });
    return new Response("Not Found", { status: 404 });
  });
  return { fetcher, requested };
}

const NOW = new Date("2025-08-15T15:40:00Z");

describe("Meteosat active fires", () => {
  it("keeps the fires that fall on Portugal, and counts each region's per scan and certainty", async () => {
    const { fetcher } = dataStore();
    const { resolved, collector } = await feedCollection(SLUG, { fetcher, now: () => NOW }, SECRETS);
    const result = await collectNormalized(
      {
        protocol: NORMALIZED_PROTOCOL,
        slug: SLUG,
        configHash: resolved.configHash,
        mode: { kind: "live" },
        limits: { sourceBytes: 8_388_608, outputBytes: 16_777_216, recordBytes: 4096, records: 50_000 },
        deadline: new Date(Date.now() + 30_000).toISOString(),
        checkpoint: { normalizer: collector.normalizer, state: { after: "2025-08-15T15:00:00.000Z" } },
        observedAt: NOW.toISOString(),
      },
      collector,
    );
    if (result.kind !== "batch") throw new Error(`Expected a batch, got ${result.kind}`);
    const frames = (await new Response(result.stream).text())
      .trim()
      .split("\n")
      .map((line): JsonObject => {
        const frame = parseJson(line);
        if (!isJsonObject(frame)) throw new Error("Every frame is a JSON object");
        return frame;
      });

    expect(frames[0]).toMatchObject({
      type: "header",
      checkpoint: { state: { after: "2025-08-15T15:20:00.000Z" } },
      provenance: { sourcePublishedAt: "2025-08-15T15:28:12.066Z" },
    });
    const records = frames.filter((frame) => frame.type === "record").map((frame) => frame.value);
    // Both listed scans answer with the same message here, so each holds Arganil's four; Spain and Mozambique are left out.
    const arganil = [
      [40.068, -8.234, 1.32, "likely"],
      [40.068, -8.209, 1.32, "likely"],
      [40.096, -8.237, 1.321, "likely"],
      [40.226, -7.883, 1.322, "possible"],
    ] as const;
    expect(records).toEqual(
      ["2025-08-15T15:00:00.000Z", "2025-08-15T15:10:00.000Z"].flatMap((scan) =>
        arganil.map(([latitude, longitude, pixelRadius, certainty]) => ({
          entityKey: `${scan}|${latitude.toFixed(3)}|${longitude.toFixed(3)}`,
          eventTime: scan,
          payload: { detectedAt: scan, region: "Mainland Portugal", certainty, latitude, longitude, pixelRadius },
        })),
      ),
    );
    const points = frames.filter((frame) => frame.type === "point").map((frame) => frame.value);
    expect(points).toHaveLength(12);
    expect(points).toContainEqual(expect.objectContaining({ seriesKey: "mainland:likely-fires", eventTime: "2025-08-15T15:00:00.000Z", value: 3, unit: "fires" }));
    expect(points).toContainEqual(expect.objectContaining({ seriesKey: "mainland:possible-fires", eventTime: "2025-08-15T15:10:00.000Z", value: 1 }));
    // No fire on the islands is a measured zero, not a missing point.
    expect(points).toContainEqual(expect.objectContaining({ seriesKey: "azores:likely-fires", value: 0 }));
  });

  it("asks for the scans after its cursor, in scan order, and reads only those that start there or later", async () => {
    const source = dataStore();
    const fetched = await collectActiveFires({ after: "2025-08-15T15:10:00.000Z" }, NOW, DATASTORE_API_ORIGIN, CREDENTIALS, source.fetcher);
    const search = source.requested.find((url) => url.pathname.endsWith("/os"));
    expect(search?.searchParams.get("pi")).toBe("EO:EUM:DAT:0801");
    expect(search?.searchParams.get("dtstart")).toBe("2025-08-15T15:10:00.000Z");
    expect(search?.searchParams.get("sort")).toBe("start,time,1");
    // The 15:00 scan ends at the cursor, which the search still matches; only 15:10's file is read.
    expect(source.requested.filter((url) => url.pathname.endsWith("/entry")).map((url) => url.searchParams.get("name"))).toEqual([
      "W_XX-EUMETSAT-Darmstadt,IMG+SAT,MTI1+FCI-2-FIR--FD------CAP_C_EUMT_20250815152731_L2PF_OPE_20250815151000_20250815152000_N__C_0092_0000.xml",
    ]);
    expect(fetched).toMatchObject({ kind: "body", completeness: "complete", state: { after: "2025-08-15T15:20:00.000Z" } });
  });

  it("reads nothing past the search when no scan is new", async () => {
    const source = dataStore();
    const fetched = await collectActiveFires({ after: "2025-08-15T15:20:00.000Z" }, NOW, DATASTORE_API_ORIGIN, CREDENTIALS, source.fetcher);
    expect(fetched).toEqual({ kind: "not-modified" });
    expect(source.requested.map((url) => url.pathname)).toEqual(["/token", "/data/search-products/1.0.0/os"]);
  });

  it.each([
    { name: "no cursor", state: undefined },
    { name: "a cursor a day old", state: { after: "2025-08-14T15:00:00.000Z" } },
  ])("starts at the last hour, never walking the archive, with $name", async ({ state }) => {
    const source = dataStore();
    await collectActiveFires(state, NOW, DATASTORE_API_ORIGIN, CREDENTIALS, source.fetcher);
    expect(source.requested.find((url) => url.pathname.endsWith("/os"))?.searchParams.get("dtstart")).toBe("2025-08-15T14:40:00.000Z");
  });

  it("takes missing or rejected credentials for configuration, which waiting does not fix", async () => {
    const source = dataStore();
    await expect(collectActiveFires(undefined, NOW, DATASTORE_API_ORIGIN, { key: undefined, secret: undefined }, source.fetcher)).rejects.toMatchObject({
      code: "invalid-config",
    });
    expect(source.requested).toHaveLength(0);
    await expect(collectActiveFires(undefined, NOW, DATASTORE_API_ORIGIN, { key: "wrong", secret: "wrong" }, source.fetcher)).rejects.toMatchObject({
      code: "invalid-config",
    });
  });

  it("fails retryably when a listed file does not come", async () => {
    const source = dataStore((url) => (url.pathname.endsWith("/entry") ? new Response("busy", { status: 429, headers: { "Retry-After": "60" } }) : undefined));
    const fetched = collectActiveFires({ after: "2025-08-15T15:00:00.000Z" }, NOW, DATASTORE_API_ORIGIN, CREDENTIALS, source.fetcher);
    await expect(fetched).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 60 });
  });

  it("refuses a search answer out of scan order", async () => {
    const reversed = jsonAs<{ features: JsonValue[] }>(SEARCH);
    reversed.features.reverse();
    const source = dataStore((url) => (url.pathname.endsWith("/os") ? Response.json(reversed) : undefined));
    const fetched = collectActiveFires({ after: "2025-08-15T15:00:00.000Z" }, NOW, DATASTORE_API_ORIGIN, CREDENTIALS, source.fetcher);
    await expect(fetched).rejects.toMatchObject({ code: "invalid-response" });
  });
});

describe("Active Fire Monitoring CAP messages", () => {
  it("reads every circle with its certainty, and counts the ones that do not read", () => {
    const broken = CAP.replace("<circle>38.378,-6.664 1.284</circle>", "<circle>38.378;-6.664</circle>");
    const { fires, rejected } = readCapFires(broken);
    expect(fires).toHaveLength(6);
    expect(fires[0]).toEqual([-23.401, 31.217, 1.274, "likely"]);
    expect(fires.at(-1)).toEqual([40.226, -7.883, 1.322, "possible"]);
    expect(rejected).toBe(1);
  });

  it("refuses what is not a CAP fire alert", () => {
    expect(() => readCapFires("<html></html>")).toThrow(expect.objectContaining({ code: "invalid-response" }));
    expect(() => readCapFires(CAP.replace("<certainty>Possible</certainty>", "<certainty>Unknown</certainty>"))).toThrow(expect.objectContaining({ code: "invalid-response" }));
  });
});
