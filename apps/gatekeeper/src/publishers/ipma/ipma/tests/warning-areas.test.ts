import { readFixture } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import { feedCollection } from "#/tests/catalog";
import { NORMALIZED_PROTOCOL, collectNormalized, isJsonObject, parseJson, type JsonObject } from "#/index";
import { IPMA_WARNING_AREA_FILES, IPMA_WEB_ORIGIN, collectIpmaWarningAreas } from "#/publishers/ipma/ipma/index";

const SLUG = "ipma-warning-areas-feed";

/** The six outline files of IPMA's warnings map, as www.ipma.pt served them on 27 November 2026. */
const FILES = new Map(
  IPMA_WARNING_AREA_FILES.map(({ file }) => [`/bin/file.data/${file}.geojson`, readFixture(new URL(`./fixtures/warning-areas/${file}.geojson`, import.meta.url))]),
);

function site(answer: (path: string, body: string) => Response = (_path, body) => new Response(body, { headers: { "Last-Modified": "Tue, 26 Oct 2021 16:32:54 GMT" } })) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    const body = FILES.get(url.pathname);
    if (url.origin !== IPMA_WEB_ORIGIN || body === undefined) return new Response("Not Found", { status: 404 });
    expect(init?.redirect).toBe("manual");
    return answer(url.pathname, body);
  });
}

async function frames(fetcher: typeof fetch, observedAt = "2026-11-27T17:00:00.000Z"): Promise<JsonObject[]> {
  const { resolved, collector } = await feedCollection(SLUG, { fetcher });
  const result = await collectNormalized(
    {
      protocol: NORMALIZED_PROTOCOL,
      slug: SLUG,
      configHash: resolved.configHash,
      mode: { kind: "live" },
      limits: { sourceBytes: 3_145_728, outputBytes: 16_777_216, recordBytes: 524_288, records: 1_000 },
      deadline: new Date(Date.now() + 30_000).toISOString(),
      observedAt,
    },
    collector,
  );
  if (result.kind !== "batch") throw new Error(`Expected a batch, got ${result.kind}`);
  return (await new Response(result.stream).text())
    .trim()
    .split("\n")
    .map((line): JsonObject => {
      const frame = parseJson(line);
      if (!isJsonObject(frame)) throw new Error("Every frame is a JSON object");
      return frame;
    });
}

function payloads(all: JsonObject[]): JsonObject[] {
  return all.flatMap((frame) => (frame.type === "record" && isJsonObject(frame.value) && isJsonObject(frame.value.payload) ? [frame.value.payload] : []));
}

describe("IPMA warning areas", () => {
  it("publishes every outline of the six files once, keyed by the code a warning names and its surface", async () => {
    const fetcher = site();
    const all = await frames(fetcher);
    expect(fetcher).toHaveBeenCalledTimes(6);
    const areas = payloads(all);
    // 18 districts and 10 sea strips, 4 parts of Madeira and 3 strips, 3 island groups and 3 strips.
    expect(areas).toHaveLength(41);
    expect(new Set(areas.map((area) => `${String(area.areaCode)}:${String(area.surface)}`)).size).toBe(41);
    expect(new Set(areas.map((area) => area.areaCode)).size).toBe(25);
    expect(areas.find((area) => area.areaCode === "LSB" && area.surface === "land")).toMatchObject({
      name: "Lisboa",
      region: "PO",
      regionId: 11,
      emmaId: "PT016",
      file: "po-ww",
      geometry: { type: "Polygon" },
    });
    expect(areas.find((area) => area.areaCode === "LSB" && area.surface === "sea")).toMatchObject({ file: "po-ww-sea", geometry: { type: "MultiPolygon" } });
    // The Azores' land file states no MeteoAlarm code.
    expect(areas.find((area) => area.areaCode === "AOC" && area.surface === "land")).toMatchObject({ name: "Grupo Ocidental", emmaId: null });
    expect(areas.find((area) => area.areaCode === "MRM")).toMatchObject({ surface: "land", name: "Madeira - Regiões Montanhosas" });
  });

  it("dates the collection by the newest file and does not depend on when it was read", async () => {
    const fetched = await collectIpmaWarningAreas(
      IPMA_WEB_ORIGIN,
      site((path, body) => new Response(body, { headers: { "Last-Modified": path.includes("ac-ww-sea") ? "Wed, 27 Oct 2021 15:20:00 GMT" : "Tue, 26 Oct 2021 16:32:54 GMT" } })),
    );
    if (fetched.kind !== "body") throw new Error("Expected a body");
    expect(fetched.provenance).toEqual({ sourceUrl: "https://www.ipma.pt/pt/otempo/", sourcePublishedAt: "2021-10-27T15:20:00.000Z" });
    expect(payloads(await frames(site()))).toEqual(payloads(await frames(site(), "2030-01-01T00:00:00.000Z")));
  });

  it("fails rather than publish a partial set of areas", async () => {
    await expect(
      collectIpmaWarningAreas(
        IPMA_WEB_ORIGIN,
        site((path, body) => (path.includes("md-ww-sea") ? new Response("", { status: 503 }) : new Response(body))),
      ),
    ).rejects.toMatchObject({
      code: "upstream-error",
    });
    await expect(
      collectIpmaWarningAreas(
        IPMA_WEB_ORIGIN,
        site((path, body) => (path.includes("ac-ww") ? new Response("<html>") : new Response(body))),
      ),
    ).rejects.toMatchObject({
      code: "invalid-response",
    });
    await expect(
      collectIpmaWarningAreas(
        IPMA_WEB_ORIGIN,
        site(() => new Response('{"type":"Topology"}')),
      ),
    ).rejects.toMatchObject({ code: "invalid-response" });
    await expect(collectIpmaWarningAreas("https://evil.example", site())).rejects.toMatchObject({ code: "source-denied" });
  });

  it("rejects an outline without a code, a repeated one, and anything that is not a polygon", async () => {
    const without = (path: string, body: string, from: string, to: string) => new Response(path.endsWith("/po-ww.geojson") ? body.replace(from, to) : body);
    await expect(frames(site((path, body) => without(path, body, '"RegCode":"AVR"', '"RegCode":""')))).rejects.toThrow();
    await expect(frames(site((path, body) => without(path, body, '"RegCode":"AVR"', '"RegCode":"BJA"')))).rejects.toThrow();
    await expect(frames(site((path, body) => without(path, body, '"type":"Polygon"', '"type":"Point"')))).rejects.toThrow();
    // A polygon's coordinates under a multipolygon's type: rings where polygons should be, numbers where rings.
    const flat = (path: string, body: string) => new Response(path.endsWith("/po-ww.geojson") ? body.replace('"type":"Polygon"', '"type":"MultiPolygon"') : body);
    await expect(frames(site(flat))).rejects.toThrow("must be a polygon");
  });
});
