import { readFixture } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import { feedCollection } from "#/tests/catalog";
import { NORMALIZED_PROTOCOL, collectNormalized, isJsonObject, parseJson, type JsonObject } from "#/index";
import { IPMA_WEB_ORIGIN, collectIpmaLightning } from "#/publishers/ipma/ipma/index";

const SLUG = "ipma-lightning-feed";

/**
 * IPMA's lightning page of 1 October 2026, 16:08 UTC. Its discharges are three
 * of that day's (one in Spain by Barrancos, two in Morocco) and three moved to
 * Tomar, Évora and Funchal, as that afternoon had none over Portugal.
 */
const PAGE = readFixture(new URL("./fixtures/lightning-page.html", import.meta.url));

function site(answer: (init?: RequestInit) => Response = () => new Response(PAGE, { headers: { "Last-Modified": "Thu, 01 Oct 2026 16:09:06 GMT" } })) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    if (url.origin !== IPMA_WEB_ORIGIN || url.pathname !== "/pt/otempo/obs.dea/") return new Response("Not Found", { status: 404 });
    return answer(init);
  });
}

describe("IPMA lightning", () => {
  it("keeps the discharges that fall on Portugal, and counts each region's per hour and type", async () => {
    const { resolved, collector } = await feedCollection(SLUG, { fetcher: site() });
    const result = await collectNormalized(
      {
        protocol: NORMALIZED_PROTOCOL,
        slug: SLUG,
        configHash: resolved.configHash,
        mode: { kind: "live" },
        limits: { sourceBytes: 33_554_432, outputBytes: 16_777_216, recordBytes: 4096, records: 200_000 },
        deadline: new Date(Date.now() + 30_000).toISOString(),
        observedAt: "2026-10-01T16:10:00.000Z",
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

    expect(frames.filter((frame) => frame.type === "record").map((frame) => frame.value)).toEqual([
      {
        entityKey: "89009001",
        eventTime: "2026-10-01T14:12:30.000Z",
        payload: { occurredAt: "2026-10-01T14:12:30.000Z", region: "Mainland Portugal", type: "cloud-to-ground", peakCurrent: -21.4, latitude: 39.5512, longitude: -8.2441 },
      },
      {
        entityKey: "89009002",
        eventTime: "2026-10-01T14:47:05.000Z",
        payload: { occurredAt: "2026-10-01T14:47:05.000Z", region: "Mainland Portugal", type: "in-cloud", peakCurrent: 6.8, latitude: 38.5714, longitude: -7.9093 },
      },
      {
        entityKey: "89009003",
        eventTime: "2026-10-01T15:03:59.000Z",
        payload: { occurredAt: "2026-10-01T15:03:59.000Z", region: "Madeira", type: "cloud-to-ground", peakCurrent: -35.2, latitude: 32.6669, longitude: -16.9241 },
      },
    ]);
    const points = frames.filter((frame) => frame.type === "point").map((frame) => frame.value);
    // The whole hours inside the page's last 23, 18:00 to 15:00, for each of the three regions, by type.
    expect(points).toHaveLength(22 * 3 * 2);
    expect(points.filter((point) => isJsonObject(point) && point.value !== 0)).toEqual([
      expect.objectContaining({ seriesKey: "mainland:cloud-to-ground", eventTime: "2026-10-01T14:00:00.000Z", value: 1 }),
      expect.objectContaining({ seriesKey: "mainland:in-cloud", eventTime: "2026-10-01T14:00:00.000Z", value: 1 }),
      expect.objectContaining({ seriesKey: "madeira:cloud-to-ground", eventTime: "2026-10-01T15:00:00.000Z", value: 1 }),
    ]);
    // A quiet hour over the Azores is a counted zero.
    expect(points).toContainEqual(expect.objectContaining({ seriesKey: "azores:cloud-to-ground", eventTime: "2026-10-01T14:00:00.000Z", value: 0 }));
  });

  it("asks whether the page changed, and reads nothing when it has not", async () => {
    const fetcher = site((init) =>
      new Headers(init?.headers).get("if-modified-since") === "Thu, 01 Oct 2026 16:09:06 GMT" ? new Response(null, { status: 304 }) : new Response(PAGE),
    );
    await expect(collectIpmaLightning({ lastModified: "Thu, 01 Oct 2026 16:09:06 GMT" }, IPMA_WEB_ORIGIN, fetcher)).resolves.toEqual({ kind: "not-modified" });
  });

  it("fails loudly when the page stops carrying its discharges, rather than reporting none", async () => {
    const fetcher = site(() => new Response(PAGE.replace("var data = ", "var dados = ")));
    await expect(collectIpmaLightning(undefined, IPMA_WEB_ORIGIN, fetcher)).rejects.toMatchObject({ code: "invalid-response" });
  });
});
