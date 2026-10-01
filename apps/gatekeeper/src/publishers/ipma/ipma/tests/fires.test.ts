import { readFixtureBytes } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import { feedCollection } from "#/tests/catalog";
import { GatekeeperError, NORMALIZED_PROTOCOL, collectNormalized, isJsonObject, parseJson, type JsonObject } from "#/index";
import { collectIpmaFireDetections, IPMA_MF2_ORIGIN } from "#/publishers/ipma/ipma/index";

const SLUG = "ipma-satellite-fire-detections-feed";

/** Meteosat's list for the 15:00 UTC scan of 15 August 2025, cut to four pixels of the Arganil fire, two in Ourense, one in Cáceres and two in Africa. */
const SHP = readFixtureBytes(new URL("./fixtures/frp-pixel-202508151500.shp", import.meta.url));
const DBF = readFixtureBytes(new URL("./fixtures/frp-pixel-202508151500.dbf", import.meta.url));

/** Serves the fixture for every scan in `published`, 404 for every other, and records each path asked for. */
function mf2(published: readonly string[], answer?: (url: URL) => Response | undefined) {
  const requested: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input.toString());
    requested.push(url.pathname);
    const custom = answer?.(url);
    if (custom) return custom;
    const stamp = /_(\d{12})\.(shp|dbf)$/u.exec(url.pathname);
    if (url.origin !== IPMA_MF2_ORIGIN || !stamp?.[1] || !published.includes(stamp[1])) return new Response("Not Found", { status: 404 });
    return new Response(stamp[2] === "shp" ? SHP : DBF, { headers: { "Last-Modified": "Fri, 15 Aug 2025 15:21:14 GMT" } });
  });
  return { fetcher, requested };
}

function scansOf(paths: string[]): string[] {
  return [...new Set(paths.map((path) => /_(\d{12})\./u.exec(path)?.[1] ?? path))];
}

describe("IPMA satellite fire detections", () => {
  it("keeps the pixels that fall on Portugal, and totals each region's for the scan", async () => {
    const { fetcher } = mf2(["202508151500"]);
    const now = () => new Date("2025-08-15T15:40:00Z");
    const { resolved, collector } = await feedCollection(SLUG, { fetcher, now });
    const result = await collectNormalized(
      {
        protocol: NORMALIZED_PROTOCOL,
        slug: SLUG,
        configHash: resolved.configHash,
        mode: { kind: "live" },
        limits: { sourceBytes: 8_388_608, outputBytes: 16_777_216, recordBytes: 4096, records: 50_000 },
        deadline: new Date(Date.now() + 30_000).toISOString(),
        // The cursor stands on the scan, so this collection reads it alone.
        checkpoint: { normalizer: collector.normalizer, state: { nextScan: "2025-08-15T15:00:00.000Z" } },
        observedAt: "2025-08-15T15:40:00.000Z",
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

    expect(frames[0]).toMatchObject({ type: "header", checkpoint: { state: { nextScan: "2025-08-15T15:15:00.000Z" } } });
    const records = frames.filter((frame) => frame.type === "record").map((frame) => frame.value);
    // Arganil's four, at the 0.01° the list states; Ourense and Cáceres are in Spain, and the rest in Africa.
    expect(records).toEqual(
      [
        [40.33, -7.95, 200.9],
        [40.33, -7.91, 244.8],
        [40.33, -7.87, 327.7],
        [40.29, -7.98, 503.1],
      ].map(([latitude, longitude, power]) => ({
        entityKey: `2025-08-15T15:00:00.000Z|${latitude!.toFixed(4)}|${longitude!.toFixed(4)}`,
        eventTime: "2025-08-15T15:00:00.000Z",
        payload: { detectedAt: "2025-08-15T15:00:00.000Z", region: "Mainland Portugal", latitude, longitude, fireRadiativePower: power },
      })),
    );
    const points = frames.filter((frame) => frame.type === "point").map((frame) => frame.value);
    expect(points).toHaveLength(6);
    expect(points).toContainEqual(expect.objectContaining({ seriesKey: "mainland:fire-radiative-power", eventTime: "2025-08-15T15:00:00.000Z", value: 1276.5, unit: "MW" }));
    expect(points).toContainEqual(expect.objectContaining({ seriesKey: "mainland:fire-pixels", value: 4 }));
    // No fire on the islands is a measured zero, not a missing point.
    expect(points).toContainEqual(expect.objectContaining({ seriesKey: "madeira:fire-pixels", value: 0 }));
  });

  it.each([
    {
      name: "asks nothing when the next scan is not due yet",
      state: { nextScan: "2025-08-15T15:30:00.000Z" },
      published: [],
      requested: [],
      result: { kind: "not-modified" },
    },
    {
      name: "waits for a scan not yet written, without asking past it",
      state: { nextScan: "2025-08-15T14:45:00.000Z" },
      published: [],
      requested: ["202508151445"],
      result: { kind: "not-modified" },
    },
    {
      name: "passes over a scan still missing two hours after it was due",
      state: { nextScan: "2025-08-15T12:30:00.000Z" },
      published: ["202508151245"],
      requested: ["202508151230", "202508151245", "202508151300", "202508151315"],
      result: { completeness: "complete", state: { nextScan: "2025-08-15T13:30:00.000Z" } },
    },
    {
      name: "starts at the last hour, never walking the archive, when it has no cursor or one a day old",
      state: { nextScan: "2025-08-13T15:00:00.000Z" },
      published: ["202508151430", "202508151445", "202508151500", "202508151515"],
      requested: ["202508151430", "202508151445", "202508151500", "202508151515"],
      result: { completeness: "complete", state: { nextScan: "2025-08-15T15:30:00.000Z" } },
    },
  ])("$name", async ({ state, published, requested, result }) => {
    const source = mf2(published);
    const fetched = await collectIpmaFireDetections(state, new Date("2025-08-15T15:40:00Z"), IPMA_MF2_ORIGIN, source.fetcher);
    expect(scansOf(source.requested)).toEqual(requested);
    expect(fetched).toMatchObject(result);
  });

  it("fails retryably when IPMA refuses us, rather than taking the refusal for a gap", async () => {
    const source = mf2(["202508151500"], () => new Response("Forbidden", { status: 429, headers: { "Retry-After": "600" } }));
    const fetched = collectIpmaFireDetections({ nextScan: "2025-08-15T12:00:00.000Z" }, new Date("2025-08-15T15:40:00Z"), IPMA_MF2_ORIGIN, source.fetcher);
    await expect(fetched).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 600 });
    expect(source.requested).toHaveLength(1);
  });

  it("refuses a list whose shapes and table rows do not pair up", async () => {
    const shorter = DBF.slice();
    new DataView(shorter.buffer).setUint32(4, 8, true);
    const source = mf2(["202508151500"], (url) => (url.pathname.endsWith(".dbf") ? new Response(shorter) : undefined));
    const fetched = collectIpmaFireDetections({ nextScan: "2025-08-15T15:00:00.000Z" }, new Date("2025-08-15T15:40:00Z"), IPMA_MF2_ORIGIN, source.fetcher);
    await expect(fetched).rejects.toBeInstanceOf(GatekeeperError);
    await expect(fetched).rejects.toMatchObject({ code: "invalid-response" });
  });
});
