import { describe, expect, it } from "vitest";
import {
  allowedHosts,
  contentEtag,
  equivalentEtags,
  field,
  fixedOrigin,
  hashString,
  isoDate,
  lisbonDay,
  lisbonInstants,
  lisbonToUtc,
  readBoundedJson,
  readBoundedResponse,
  retryAfterSeconds,
  runTransformer,
  sha256Hex,
  type TransformContext,
} from "@open-data-pt/gatekeeper-shared";

function headers(value?: string): Headers {
  return value === undefined ? new Headers() : new Headers({ "Retry-After": value });
}

describe("Retry-After", () => {
  it("reads a delay, an HTTP date and nothing else", () => {
    expect(retryAfterSeconds(headers("45"))).toBe(45);
    expect(retryAfterSeconds(headers(" 45 "))).toBe(45);
    expect(retryAfterSeconds(headers(new Date(Date.now() + 60_000).toUTCString()))).toBeGreaterThanOrEqual(58);
    expect(retryAfterSeconds(headers("Thu, 01 Jan 1970 00:00:00 GMT"))).toBe(0);
    expect(retryAfterSeconds(headers("soon"))).toBeUndefined();
    expect(retryAfterSeconds(headers("99999999999999999999"))).toBeUndefined();
    expect(retryAfterSeconds(headers())).toBeUndefined();
  });
});

describe("bounded response reading", () => {
  it("refuses a body the source declares too large before reading it", async () => {
    const response = new Response("{}", { headers: { "Content-Length": "9999" } });
    await expect(readBoundedResponse(response, 16, "Fixture answer")).rejects.toMatchObject({
      code: "response-too-large",
      message: "Fixture answer exceeds 16 bytes",
    });
  });

  it("refuses a body that grows past the budget while it streams", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(64)));
        controller.close();
      },
    });
    await expect(readBoundedResponse(new Response(body), 16, "Fixture answer")).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("reads a body inside the budget, and reports a bodiless answer", async () => {
    expect(await readBoundedResponse(new Response("hello"), 16, "Fixture answer")).toEqual(new TextEncoder().encode("hello"));
    await expect(readBoundedResponse(new Response(null, { status: 204 }), 16, "Fixture answer")).rejects.toMatchObject({
      code: "invalid-response",
      message: "Fixture answer had no body",
    });
  });

  it("parses JSON, and names the resource when the bytes are not JSON", async () => {
    expect(await readBoundedJson(new Response('{"a":1}'), 64, "Fixture answer")).toEqual({ a: 1 });
    await expect(readBoundedJson(new Response("{"), 64, "Fixture answer")).rejects.toMatchObject({
      code: "invalid-response",
      message: "Fixture answer was not valid JSON",
    });
  });
});

describe("validators", () => {
  it("hashes bytes and text the same way, and quotes a content entity tag", async () => {
    const bytes = new TextEncoder().encode("abc");
    expect(await sha256Hex(bytes)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await sha256Hex("abc")).toBe(await sha256Hex(bytes));
    expect(await contentEtag(bytes)).toBe(`"sha256-${await sha256Hex(bytes)}"`);
  });

  it("digests metadata into a stable 64-bit hash", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).toHaveLength(16);
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });

  it("ignores the weak marker and surrounding space when comparing entity tags", () => {
    expect(equivalentEtags('W/"a"', '"a"')).toBe(true);
    expect(equivalentEtags(' "a" ', '"a"')).toBe(true);
    expect(equivalentEtags('"a"', '"b"')).toBe(false);
  });
});

describe("allowlists", () => {
  it("reads a comma-separated host list, lower-cased and without blanks", () => {
    expect([...allowedHosts(" Dados.Gov.pt , ,example.org ")]).toEqual(["dados.gov.pt", "example.org"]);
    expect(allowedHosts("").size).toBe(0);
  });

  it("accepts only the exact origin root a one-source Gatekeeper is bound to", () => {
    expect(fixedOrigin("https://api.example.pt/", "https://api.example.pt")).toBe("https://api.example.pt");
    for (const bad of ["https://api.example.pt/v1", "https://evil.example/", "not a url"]) {
      expect(() => fixedOrigin(bad, "https://api.example.pt")).toThrow(/origin is (invalid|not allowed)/);
    }
  });
});

describe("Europe/Lisbon wall clocks", () => {
  it("reads summer and winter readings as the instants they name", () => {
    expect(lisbonToUtc("2026-09-14", "00:39:53")).toBe("2026-09-13T23:39:53.000Z");
    expect(lisbonToUtc("2026-01-15", "12:00:00")).toBe("2026-01-15T12:00:00.000Z");
    expect(lisbonToUtc("2026-03-29", "12:00")).toBe("2026-03-29T11:00:00.000Z");
  });

  it("names both instants of the repeated autumn hour, and none of the skipped spring hour", () => {
    expect(lisbonInstants("2026-10-25", "01:30").map((instant) => instant.toISOString()))
      .toEqual(["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"]);
    expect(lisbonToUtc("2026-10-25", "01:30")).toBe("2026-10-25T01:30:00.000Z");
    expect(lisbonInstants("2026-03-29", "01:30")).toEqual([]);
    expect(lisbonToUtc("2026-03-29", "01:30")).toBeUndefined();
  });

  it("rejects a reading no calendar or clock shows", () => {
    for (const [day, time] of [["2026-02-30", "12:00"], ["2026-09-14", "25:00"], ["2026-09-1", "12:00"], ["2026-09-14", "12"]]) {
      expect(lisbonToUtc(day!, time!)).toBeUndefined();
    }
  });

  it("reads the calendar day Lisbon is on, not the UTC one", () => {
    expect(lisbonDay("2026-09-13T23:39:53.000Z")).toBe("2026-09-14");
    expect(lisbonDay("2026-01-15T23:39:53.000Z")).toBe("2026-01-15");
  });

  it("states a source time as UTC, and nothing for a time it cannot read", () => {
    expect(isoDate("Mon, 14 Sep 2026 00:00:00 GMT")).toBe("2026-09-14T00:00:00.000Z");
    expect(isoDate("never")).toBeUndefined();
    expect(isoDate(null)).toBeUndefined();
    expect(isoDate(undefined)).toBeUndefined();
  });
});

describe("schema fields and transformer identity", () => {
  it("names a field after its ID, and carries only the unit and label it was given", () => {
    expect(field("stopId", "identifier", false)).toEqual({ id: "stopId", name: "stopId", type: "identifier", nullable: false });
    expect(field("power", "number", true, "MW", "Power")).toEqual({
      id: "power", name: "power", type: "number", nullable: true, unit: "MW", display: { label: "Power" },
    });
    expect(field("power", "number", true, "", "")).toEqual({ id: "power", name: "power", type: "number", nullable: true });
  });

  it("stamps the translator's identity on what it returned", async () => {
    const context: TransformContext = {
      feed: {
        id: "feed_1", slug: "fixture", title: "Fixture", description: "",
        config: {},
        semantics: { boundedness: "bounded", changeSemantics: "full-snapshot", cadence: "periodic", domainSubject: "reference", defaultProductRole: "reference", completeness: "complete", ordering: "none" },
      },
      observedAt: "2026-09-14T00:00:00.000Z",
    };
    const result = await runTransformer(
      {
        id: "fixture", version: "1",
        transform: () => ({ products: [], quality: { acceptedRecords: 0, rejectedRecords: 0 } }),
      },
      new Uint8Array(),
      context,
    );
    expect(result.transformer).toEqual({ id: "fixture", version: "1" });
  });
});
