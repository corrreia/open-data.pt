import { describe, expect, it } from "vitest";

import { EXPOSED_PROBLEM_HEADERS, RequestError, StorageUnavailableError, decodePathSegment, storageUnavailableResponse, validatePathEncoding } from "#/api/errors";

describe("public API error semantics", () => {
  it("maps selected internal storage failures to 503 with Retry-After", () => {
    const response = storageUnavailableResponse(new StorageUnavailableError("A selected object is unavailable; retry shortly"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(response.headers.get("Access-Control-Expose-Headers")).toBe(EXPOSED_PROBLEM_HEADERS);
  });

  it("maps malformed path encoding to a 400 request error", () => {
    expect(decodePathSegment("places")).toBe("places");
    expect(() => validatePathEncoding("/api/%E0%A4%A")).toThrow(RequestError);
    try {
      decodePathSegment("%E0%A4%A");
      throw new Error("malformed encoding was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(RequestError);
      expect(error).toMatchObject({ status: 400 });
    }
  });

  it("exposes every operational problem header to cross-origin code", () => {
    for (const header of ["Retry-After", "X-Request-Id", "Allow", "Link", "ETag"]) expect(EXPOSED_PROBLEM_HEADERS).toContain(header);
  });
});
