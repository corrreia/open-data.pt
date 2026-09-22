import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { NORMALIZED_PROTOCOL, collectNormalized, resolveFeed, runTransformer, type CollectionRequest, type JsonObject } from "@open-data-pt/gatekeeper";
import {
  MYINFO_FEEDS,
  MYINFO_ORIGIN,
  collectMyInfoFeed,
  myInfoPortalUrl,
  parseFormFields,
  parseNetwork,
  parseTrips,
  parseZones,
  validateMyInfoFeedConfig,
} from "../apps/gatekeeper/src/formats/myinfo/myinfo";
import { MyInfoTransformer } from "../apps/gatekeeper/src/formats/myinfo/transform";
import { jsonAs } from "./support";

const OPERATORS = new Set(["BarraqueiroOeste", "mare"]);
const PORTAL = `${MYINFO_ORIGIN}/IP/MotorBusca/BarraqueiroOeste/`;
const SESSION = "ASP.NET_SessionId=lbiggqad1ghrdnawyz4pfmof";
const NETWORK = { feed: "network", operator: "BarraqueiroOeste" };
const TIMETABLE = { feed: "timetable", operator: "BarraqueiroOeste", origin: "4384", destination: "4325" };

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/myinfo/${name}.html`, import.meta.url), "utf8");
}

interface Call {
  url: string;
  method: string;
  body: string;
  cookie: string | null;
}

/** A fake portal: the landing page on a GET, whatever the test answers a postback with. */
function portal(landing: () => Response, answer: () => Response = () => new Response(fixture("search"), { headers: { "Content-Type": "text/html" } })) {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url: input.toString(),
      method,
      body: init?.body === undefined || init.body === null ? "" : String(init.body),
      cookie: new Headers(init?.headers).get("cookie"),
    });
    return method === "POST" ? answer() : landing();
  });
  return { calls, fetcher };
}

const page = () => new Response(fixture("network"), { headers: { "Content-Type": "text/html", "Set-Cookie": `${SESSION}; path=/; HttpOnly; SameSite=Lax; Secure` } });

describe("MYINFO Gatekeeper", () => {
  it("accepts only its two feeds, on an allowed operator, with nothing else in the configuration", () => {
    expect(validateMyInfoFeedConfig(NETWORK, OPERATORS)).toEqual(NETWORK);
    expect(validateMyInfoFeedConfig(TIMETABLE, OPERATORS)).toEqual(TIMETABLE);
    expect(() => validateMyInfoFeedConfig({ feed: "prices", operator: "mare" }, OPERATORS)).toThrow(/feed=network, timetable/);
    expect(() => validateMyInfoFeedConfig({ ...NETWORK, url: "https://example.com" }, OPERATORS)).toThrow(/Unsupported .* field: url/);
    // A timetable's places belong to a timetable; a network feed does not take them.
    expect(() => validateMyInfoFeedConfig({ ...NETWORK, origin: "1" }, OPERATORS)).toThrow(/Unsupported .* field: origin/);
  });

  it("refuses an operator it was not given, and a path that is not a folder name", () => {
    for (const operator of ["../../etc", "Other", "mare/../Cascais", ""]) {
      expect(() => validateMyInfoFeedConfig({ feed: "network", operator }, OPERATORS)).toThrow(/operator/);
    }
    expect(() => validateMyInfoFeedConfig({ feed: "network", operator: "Cascais" }, OPERATORS)).toThrow(/operator is not allowed/);
  });

  it("requires two different numeric places for a timetable", () => {
    for (const config of [
      { ...TIMETABLE, origin: "TORRES VEDRAS" },
      { ...TIMETABLE, destination: "" },
      { ...TIMETABLE, destination: "4384" },
    ]) {
      expect(() => validateMyInfoFeedConfig(config, OPERATORS)).toThrow(/origin and destination/);
    }
  });

  it("allows only the one origin MYINFO answers on", async () => {
    const { fetcher } = portal(page);
    for (const bad of ["https://myinfo.4cloud.pt/IP/", "http://myinfo.4cloud.pt", "https://evil.example/", "not a url"]) {
      await expect(collectMyInfoFeed(NETWORK, undefined, bad, OPERATORS, fetcher)).rejects.toMatchObject({ code: "source-denied" });
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(myInfoPortalUrl(MYINFO_ORIGIN, "mare")).toBe(`${MYINFO_ORIGIN}/IP/MotorBusca/mare/`);
  });

  it("reads the network from one page, and names that page as the source link", async () => {
    const { calls, fetcher } = portal(page);
    const fetched = await collectMyInfoFeed(NETWORK, undefined, MYINFO_ORIGIN, OPERATORS, fetcher);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: PORTAL, method: "GET" });
    expect(fetched).toMatchObject({ kind: "body", completeness: "complete", provenance: { sourceUrl: PORTAL } });
    if (fetched.kind !== "body") throw new Error("Expected a body");
    const document = jsonAs<{ feed: string; operator: string; stops: unknown[]; lines: unknown[]; zones: unknown[] }>(fetched.body);
    expect(document).toMatchObject({ feed: "network", operator: "BarraqueiroOeste" });
    expect(document.stops).toHaveLength(4);
    expect(document.lines).toHaveLength(6);
    expect(document.zones).toHaveLength(4);
  });

  it("searches with the page's own form, its session cookie and midnight, and never selects a line", async () => {
    const { calls, fetcher } = portal(page);
    const fetched = await collectMyInfoFeed(TIMETABLE, undefined, MYINFO_ORIGIN, OPERATORS, fetcher);
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    const search = calls[1]!;
    expect(search.url).toBe(PORTAL);
    expect(search.cookie).toBe(SESSION);
    const posted = new URLSearchParams(search.body);
    expect(posted.get("__VIEWSTATE")).toBe("/wEPDwUKMjEzNTQyMzM4NQ9kFgJmD2QWBAIBD2QWAgIKDxYC");
    expect(posted.get("ctl00$MainContent$ddlOrigin")).toBe("4384");
    expect(posted.get("ctl00$MainContent$ddlDestination")).toBe("4325");
    expect(posted.get("ctl00$MainContent$btnSearch")).toBe("Pesquisar");
    // Selecting a line raises NotImplementedException upstream; a whole day starts at midnight.
    expect(posted.get("ctl00$MainContent$ddlLine")).toBe("0");
    expect(posted.get("ctl00$MainContent$txtOriginHour")).toBe("00:00");
    // An unchecked box posts nothing, and a submit button posts only the one that was pressed.
    expect(posted.has("ctl00$MainContent$chkReturn")).toBe(false);
    if (fetched.kind !== "body") throw new Error("Expected a body");
    const document = jsonAs<{ origin: { name: string }; destination: { name: string }; trips: unknown[] }>(fetched.body);
    expect(document.origin.name).toBe("TORRES VEDRAS");
    expect(document.destination.name).toBe("LISBOA");
    expect(document.trips).toHaveLength(4);
  });

  it("refuses a timetable between places the portal does not offer, before searching", async () => {
    const { calls, fetcher } = portal(page);
    await expect(collectMyInfoFeed({ ...TIMETABLE, destination: "999999" }, undefined, MYINFO_ORIGIN, OPERATORS, fetcher)).rejects.toMatchObject({
      code: "invalid-config",
    });
    expect(calls.map((call) => call.method)).toEqual(["GET"]);
  });

  it("calls an identical collection unchanged, and a changed one new", async () => {
    const first = await collectMyInfoFeed(NETWORK, undefined, MYINFO_ORIGIN, OPERATORS, portal(page).fetcher);
    if (first.kind !== "body") throw new Error("Expected a body");
    const again = await collectMyInfoFeed(NETWORK, first.validator, MYINFO_ORIGIN, OPERATORS, portal(page).fetcher);
    expect(again).toEqual({ kind: "not-modified", validator: first.validator });
    const moved = () => new Response(fixture("network").replace("39.05560556", "39.05560999"), { headers: { "Content-Type": "text/html" } });
    const changed = await collectMyInfoFeed(NETWORK, first.validator, MYINFO_ORIGIN, OPERATORS, portal(moved).fetcher);
    expect(changed.kind).toBe("body");
  });

  it("reports transport failures, oversized pages and unreadable stop data as source errors", async () => {
    const cases: Array<[() => Response, string, number | undefined]> = [
      [() => new Response("busy", { status: 503, headers: { "Retry-After": "30" } }), "upstream-error", 30],
      [() => new Response("gone", { status: 404 }), "upstream-error", undefined],
      [() => new Response("<html></html>", { headers: { "Content-Length": String(64 * 1024 * 1024) } }), "response-too-large", undefined],
      // A truncated stop payload is a page that answered, but not with what it promised.
      [() => new Response(fixture("network").replace("%7d%5d'", "'"), { headers: { "Content-Type": "text/html" } }), "invalid-response", undefined],
    ];
    for (const [answer, code, retryAfterSeconds] of cases) {
      const { fetcher } = portal(answer);
      await expect(collectMyInfoFeed(NETWORK, undefined, MYINFO_ORIGIN, OPERATORS, fetcher)).rejects.toMatchObject(
        retryAfterSeconds === undefined ? { code } : { code, retryAfterSeconds },
      );
    }
  });

  it("refuses a page that carries no network rather than collecting an empty one", async () => {
    // The stop table is an authoritative snapshot, so an empty collection would
    // retract every stop the feed serves. A maintenance page must fail instead.
    const empty = () => new Response("<html><body>Manutenção</body></html>", { headers: { "Content-Type": "text/html" } });
    await expect(collectMyInfoFeed(NETWORK, undefined, MYINFO_ORIGIN, OPERATORS, portal(empty).fetcher)).rejects.toMatchObject({
      code: "invalid-response",
      message: expect.stringContaining("no stop network"),
    });
  });

  it("refuses a search on a page that offers nowhere to travel between", async () => {
    const empty = () => new Response("<html><body>Manutenção</body></html>", { headers: { "Content-Type": "text/html" } });
    await expect(collectMyInfoFeed(TIMETABLE, undefined, MYINFO_ORIGIN, OPERATORS, portal(empty).fetcher)).rejects.toMatchObject({
      code: "invalid-response",
      message: expect.stringContaining("offers no places"),
    });
  });

  it("fails a search when the page offers the places but carries no form to post back", async () => {
    const formless = () => new Response(fixture("network").replace(/<input[^>]*>/gu, ""), { headers: { "Content-Type": "text/html" } });
    await expect(collectMyInfoFeed(TIMETABLE, undefined, MYINFO_ORIGIN, OPERATORS, portal(formless).fetcher)).rejects.toMatchObject({ code: "invalid-response" });
  });

  describe("reading one portal page", () => {
    it("takes every stop, its position and the lines calling there, and names each line once", () => {
      const { stops, lines } = parseNetwork(fixture("network"));
      expect(stops[0]).toEqual({
        stopId: "52582",
        stopCode: "41840",
        zoneId: "4491",
        name: "A.P.E.C.I.",
        longitude: -9.21006667,
        latitude: 39.05560556,
        lineKeys: ["55417|GOING", "55417|RETURN"],
      });
      // A stop the portal never placed sits at the null island, which is not a position.
      expect(stops.at(-1)).toMatchObject({ name: "Torres Vedras, Terminal", latitude: null, longitude: null, lineKeys: [] });
      expect(lines.map((line) => line.key)).toEqual(["55417|GOING", "55417|RETURN", "55629|GOING", "55629|RETURN", "55921|GOING", "55921|RETURN"]);
      expect(lines[0]).toEqual({ key: "55417|GOING", lineId: "55417", code: "720", name: "Torres Vedras - Venda do Pinheiro (Via Runa)", direction: "GOING" });
    });

    it("takes the places a search may name, and leaves the empty first option out", () => {
      expect(parseZones(fixture("network"))).toEqual([
        { id: "4491", name: "A.P.E.C.I." },
        { id: "4410", name: "ABOBOREIRA" },
        { id: "4384", name: "TORRES VEDRAS" },
        { id: "4325", name: "LISBOA" },
      ]);
    });

    it("posts back every field the form carries, and no button or unchecked box", () => {
      const fields = parseFormFields(fixture("network"));
      expect(fields.get("__EVENTTARGET")).toBe("");
      expect(fields.get("__VIEWSTATEGENERATOR")).toBe("BF9CA423");
      expect(fields.get("ctl00$MainContent$txtOriginDate")).toBe("18/09/2026");
      expect(fields.has("ctl00$MainContent$btnSearch")).toBe(false);
      expect(fields.has("ctl00$MainContent$chkReturn")).toBe(false);
    });

    it("takes every journey a search answered with, direct or with a change", () => {
      const trips = parseTrips(fixture("search"));
      expect(trips).toHaveLength(4);
      expect(trips[0]).toEqual({ departure: "06:42", arrival: "07:05", duration: "00:23", routes: ["240"], transfer: null, frequency: "Dias úteis" });
      expect(trips[3]).toMatchObject({ departure: "07:32", routes: ["243", "717"], transfer: "Casal Torre, R. Principal, Junto N.º9/7:52" });
    });

    it("finds no journeys on a page that answered with none", () => {
      expect(parseTrips(fixture("network"))).toEqual([]);
    });

    it("refuses a stop that is missing what a stop is made of, naming the entry", () => {
      const cases: Array<[string, string, RegExp]> = [
        ["%22StopId%22%3a52612%2c", "%22StopId%22%3anull%2c", /stop 1 states no StopId/u],
        ["%22ZoneId%22%3a4410%2c", "%22ZoneId%22%3anull%2c", /stop 1 states no ZoneId/u],
        ["%22StopNane%22%3a%22Aboboreira%2c+Lrg.", "%22StopNane%22%3a%22%22%2c%22x%22%3a%22", /stop 1 states no StopNane/u],
        ["%22StopLines%22%3a%5b%5d%7d%5d", "%22StopLines%22%3anull%7d%5d", /stop 3 does not list the lines/u],
      ];
      for (const [from, to, message] of cases) {
        const page = fixture("network").replace(from, to);
        expect(page).not.toBe(fixture("network"));
        expect(() => parseNetwork(page)).toThrow(message);
      }
    });

    it("refuses a line a stop points at but the line list cannot name", () => {
      const cases: Array<[string, string, RegExp]> = [
        // A key the line list cannot key on would leave the stop referencing nothing.
        ["%22Key%22%3a%2255417%7cGOING%22", "%22Key%22%3a%2255417%22", /line 0 has an unreadable key: 55417/u],
        ["%22Id%22%3a55417%2c%22Key%22%3a%2255417%7cGOING%22", "%22Id%22%3a55418%2c%22Key%22%3a%2255417%7cGOING%22", /names line 55418 under the key of line 55417/u],
        ["%22Code%22%3a%22720%22", "%22Code%22%3a%22+%22", /states no StopLines\[0\].Code/u],
      ];
      for (const [from, to, message] of cases) {
        const page = fixture("network").replace(from, to);
        expect(page).not.toBe(fixture("network"));
        expect(() => parseNetwork(page)).toThrow(message);
      }
    });

    it("keeps one stop when the portal lists the same one twice, and publishes no line only the copy called at", () => {
      // The second entry is discarded whole: a line the line table publishes is
      // one some stop it kept calls at, never one left with nothing pointing at it.
      // The copy here is the only entry calling at line 59999, so it is not published.
      const twice = fixture("network")
        .replace("%22StopId%22%3a52612%2c", "%22StopId%22%3a52582%2c")
        .replace("%22Id%22%3a55629%2c%22Key%22%3a%2255629%7cGOING%22", "%22Id%22%3a59999%2c%22Key%22%3a%2259999%7cGOING%22");
      const { stops, lines } = parseNetwork(twice);
      expect(stops.map((stop) => stop.stopId)).toEqual(["52582", "52613", "99999"]);
      expect(lines.map((line) => line.key)).not.toContain("59999|GOING");
      const kept = new Set(stops.flatMap((stop) => stop.lineKeys));
      expect(lines.filter((line) => !kept.has(line.key))).toEqual([]);
    });
  });

  it("produces a complete normalized stream: header, one frame per row, completion with matching counts", async () => {
    const { fetcher } = portal(page);
    const transformer = new MyInfoTransformer();
    const resolve = (config: Record<string, string>) =>
      resolveFeed(config, { library: "myinfo", kinds: Object.values(MYINFO_FEEDS), validate: (value) => validateMyInfoFeedConfig(value, OPERATORS) });
    const resolved = await resolve(NETWORK);
    const request: CollectionRequest = {
      protocol: NORMALIZED_PROTOCOL,
      collectionId: "acq_test",
      feed: { id: "feed_test", slug: "barraqueiro-oeste-network-feed", title: "t", description: "d" },
      resolved,
      feedEpoch: "e",
      mode: { kind: "live" },
      limits: { sourceBytes: 4 * 1024 * 1024, outputBytes: 4 * 1024 * 1024, frameBytes: 272 * 1024, recordBytes: 256 * 1024, records: 1_000_000, products: 64 },
      deadline: new Date(Date.now() + 60_000).toISOString(),
      observedAt: "2026-09-18T08:00:00.000Z",
    };
    const result = await collectNormalized(request, {
      normalizer: { id: transformer.id, version: transformer.version },
      resolve,
      source: () => collectMyInfoFeed(resolved.config, undefined, MYINFO_ORIGIN, OPERATORS, fetcher),
      normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
    });
    if (result.kind !== "batch") throw new Error(`Expected a batch, got ${result.kind}`);
    const frames = (await new Response(result.stream).text())
      .trim()
      .split("\n")
      .map((line) => jsonAs<JsonObject>(line));
    expect(frames[0]?.type).toBe("header");
    expect(frames.filter((frame) => frame.type === "record")).toHaveLength(10);
    expect(frames.at(-1)).toMatchObject({ type: "complete", counts: { records: 10, points: 0 } });
  });
});
