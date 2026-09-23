import { jsonAs, readFixture } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import { NORMALIZED_PROTOCOL, collectNormalized, resolveFeed, runTransformer, type CollectionRequest, type JsonObject } from "#/index";
import {
  METRO_DOCS_URL,
  METRO_FEEDS,
  METRO_TOKEN_URL,
  collectMetroFeed,
  metroApiOrigin,
  validateMetroFeedConfig,
} from "#/publishers/metropolitano-de-lisboa/metrolisboa/metrolisboa";
import { MetroLisboaTransformer } from "#/publishers/metropolitano-de-lisboa/metrolisboa/transform";

const ORIGIN = "https://api.metrolisboa.pt:8243";
const CREDENTIALS = { key: "test-key", secret: "test-secret-value" };
const BASE = `${ORIGIN}/estadoServicoML/1.0.1/`;

function fixture(name: string): string {
  return readFixture(new URL(`./fixtures/${name}.json`, import.meta.url));
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fake Metro Lisboa: the token endpoint plus whichever API paths the test answers. */
function metro(answers: Record<string, () => Response>, token = "token-1") {
  const calls: Call[] = [];
  const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = input.toString();
    calls.push({ url, init });
    if (url === METRO_TOKEN_URL) return Response.json({ access_token: token, token_type: "Bearer", expires_in: 3000 });
    const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
    const answer = answers[path];
    return answer ? answer() : new Response("not here", { status: 404 });
  });
  return { calls, fetcher };
}

const ok = (text: string) => () => new Response(text, { headers: { "Content-Type": "application/json" } });

describe("Metro Lisboa Gatekeeper", () => {
  it("accepts only its four feeds, with nothing else in the configuration", () => {
    expect(validateMetroFeedConfig({ feed: "line-status" })).toEqual({ feed: "line-status" });
    expect(() => validateMetroFeedConfig({ feed: "trains" })).toThrow(/feed=line-status, waiting-times, stations, headways/);
    expect(() => validateMetroFeedConfig({ feed: "stations", url: "https://example.com" })).toThrow(/Unsupported .* field: url/);
  });

  it("allows only a bare https API origin", () => {
    expect(metroApiOrigin("https://api.metrolisboa.pt:8243")).toBe(ORIGIN);
    expect(metroApiOrigin("https://metro.open-data.pt/")).toBe("https://metro.open-data.pt");
    for (const bad of [
      "http://api.metrolisboa.pt:8243",
      "https://user:pass@api.metrolisboa.pt",
      "https://api.metrolisboa.pt/other",
      "https://api.metrolisboa.pt/?x=1",
      "not a url",
    ]) {
      expect(() => metroApiOrigin(bad)).toThrow(/origin/);
    }
  });

  it("exchanges the credentials for a token, then calls the API with it on the configured origin", async () => {
    const { calls, fetcher } = metro({ "estadoLinha/todos": ok(fixture("line-status")) });
    const fetched = await collectMetroFeed({ feed: "line-status" }, undefined, ORIGIN, CREDENTIALS, fetcher);
    expect(calls.map((call) => call.url)).toEqual([METRO_TOKEN_URL, `${BASE}estadoLinha/todos`]);
    const tokenCall = calls[0]!.init!;
    expect(tokenCall.method).toBe("POST");
    expect(tokenCall.redirect).toBe("manual");
    expect(new Headers(tokenCall.headers).get("authorization")).toBe(`Basic ${btoa("test-key:test-secret-value")}`);
    expect(tokenCall.body).toBe("grant_type=client_credentials");
    const apiCall = calls[1]!.init!;
    expect(new Headers(apiCall.headers).get("authorization")).toBe("Bearer token-1");
    expect(apiCall.redirect).toBe("manual");
    expect(fetched).toMatchObject({ kind: "body", completeness: "complete", provenance: { sourceUrl: METRO_DOCS_URL } });
    if (fetched.kind !== "body") throw new Error("Expected a body");
    const document = jsonAs<JsonObject>(await new Response(fetched.body).text());
    expect(document.feed).toBe("line-status");
  });

  it("fails permanently without credentials, and never names them in an error", async () => {
    const { fetcher } = metro({});
    await expect(collectMetroFeed({ feed: "stations" }, undefined, ORIGIN, { key: undefined, secret: undefined }, fetcher)).rejects.toMatchObject({
      name: "GatekeeperError",
      code: "invalid-config",
    });
    expect(fetcher).not.toHaveBeenCalled();
    const rejected = vi.fn(async () => new Response('{"error":"invalid_client"}', { status: 401 }));
    const error = await collectMetroFeed({ feed: "stations" }, undefined, ORIGIN, CREDENTIALS, rejected).catch((reason: Error) => reason);
    expect(error).toMatchObject({ name: "GatekeeperError", code: "invalid-config" });
    expect(String(error)).not.toContain("test-secret-value");
    expect(String(error)).not.toContain("test-key");
  });

  it("reports transport failures, codes other than 200, invalid JSON and oversized answers as source errors", async () => {
    const cases: Array<[() => Response, string]> = [
      [() => new Response("busy", { status: 503, headers: { "Retry-After": "30" } }), "upstream-error"],
      [ok('{"resposta":"erro","codigo":"500"}'), "upstream-error"],
      [ok("{not json"), "invalid-response"],
      [ok('{"codigo":"200"}'), "invalid-response"],
      [() => new Response("{}", { headers: { "Content-Length": String(2 * 1024 * 1024) } }), "response-too-large"],
    ];
    for (const [answer, code] of cases) {
      const { fetcher } = metro({ "infoEstacao/todos": answer });
      await expect(collectMetroFeed({ feed: "stations" }, undefined, ORIGIN, CREDENTIALS, fetcher)).rejects.toMatchObject({ code });
    }
    const failingToken = vi.fn(async () => new Response("down", { status: 502, headers: { "Retry-After": "60" } }));
    await expect(collectMetroFeed({ feed: "stations" }, undefined, ORIGIN, CREDENTIALS, failingToken)).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 60 });
  });

  it("calls an identical answer unchanged, but not when either half of the compound waiting-times source changed", async () => {
    const answers = { "tempoEspera/Estacao/todos": ok(fixture("waiting-times")), "infoDestinos/todos": ok(fixture("destinations")) };
    const first = await collectMetroFeed({ feed: "waiting-times" }, undefined, ORIGIN, CREDENTIALS, metro(answers).fetcher);
    if (first.kind !== "body") throw new Error("Expected a body");
    const again = await collectMetroFeed({ feed: "waiting-times" }, first.validator, ORIGIN, CREDENTIALS, metro(answers).fetcher);
    expect(again).toEqual({ kind: "not-modified", validator: first.validator });
    const renamed = fixture("destinations").replace("Reboleira", "Reboleira Nova");
    const changed = await collectMetroFeed({ feed: "waiting-times" }, first.validator, ORIGIN, CREDENTIALS, metro({ ...answers, "infoDestinos/todos": ok(renamed) }).fetcher);
    expect(changed.kind).toBe("body");
  });

  it("reads all eight headway tables, and fails as a whole when one of them does", async () => {
    const answers: Record<string, () => Response> = {};
    for (const line of ["amarela", "azul", "verde", "vermelha"]) for (const day of ["S", "F"]) answers[`infoIntervalos/${line}/${day}`] = ok(fixture("headways-amarela-S"));
    const { calls, fetcher } = metro(answers);
    const fetched = await collectMetroFeed({ feed: "headways" }, undefined, ORIGIN, CREDENTIALS, fetcher);
    expect(fetched.kind).toBe("body");
    expect(calls.filter((call) => call.url.includes("infoIntervalos"))).toHaveLength(8);
    const broken = metro({ ...answers, "infoIntervalos/verde/F": () => new Response("no", { status: 500 }) });
    await expect(collectMetroFeed({ feed: "headways" }, undefined, ORIGIN, CREDENTIALS, broken.fetcher)).rejects.toMatchObject({ code: "upstream-error" });
  });

  it("produces a complete normalized stream: header, one frame per platform, completion with matching counts", async () => {
    const answers = { "tempoEspera/Estacao/todos": ok(fixture("waiting-times")), "infoDestinos/todos": ok(fixture("destinations")) };
    const { fetcher } = metro(answers);
    const transformer = new MetroLisboaTransformer();
    const resolve = (config: Record<string, string>) => resolveFeed(config, { library: "metrolisboa", kinds: METRO_FEEDS, validate: validateMetroFeedConfig });
    const resolved = await resolve({ feed: "waiting-times" });
    const request: CollectionRequest = {
      protocol: NORMALIZED_PROTOCOL,
      collectionId: "acq_test",
      feed: { id: "feed_test", slug: "metrolisboa-waiting-times-feed", title: "t", description: "d" },
      resolved,
      feedEpoch: "e",
      mode: { kind: "live" },
      limits: { sourceBytes: 512 * 1024, outputBytes: 4 * 1024 * 1024, frameBytes: 272 * 1024, recordBytes: 256 * 1024, records: 1_000_000, products: 64 },
      deadline: new Date(Date.now() + 60_000).toISOString(),
      observedAt: "2026-09-14T08:00:00.000Z",
    };
    const result = await collectNormalized(request, {
      normalizer: { id: transformer.id, version: transformer.version },
      resolve,
      source: () => collectMetroFeed(resolved.config, undefined, ORIGIN, CREDENTIALS, fetcher),
      normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
    });
    if (result.kind !== "batch") throw new Error(`Expected a batch, got ${result.kind}`);
    const frames = (await new Response(result.stream).text())
      .trim()
      .split("\n")
      .map((line) => jsonAs<JsonObject>(line));
    const waiting = jsonAs<{ resposta: unknown[] }>(fixture("waiting-times")).resposta;
    expect(frames[0]?.type).toBe("header");
    expect(frames.filter((frame) => frame.type === "record")).toHaveLength(waiting.length);
    expect(frames.at(-1)).toMatchObject({ type: "complete", counts: { records: waiting.length, points: 0 } });
  });
});
