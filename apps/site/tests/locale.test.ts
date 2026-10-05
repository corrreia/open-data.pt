import { describe, expect, it } from "vitest";
import { LOCALE, localHref, otherLanguageHref } from "../src/lib/locale";

/** A page under test has no address, so it is the English one. */
describe("links between the languages", () => {
  it("offers the same page, query and fragment under /pt/", () => {
    expect(LOCALE).toBe("en");
    expect(otherLanguageHref({ pathname: "/catalog/", search: "?topic=energy&q=gasóleo", hash: "#results" })).toBe("/pt/catalog/?topic=energy&q=gasóleo#results");
    expect(otherLanguageHref({ pathname: "/", search: "", hash: "" })).toBe("/pt/");
  });

  it("leaves an English page's links as they are", () => {
    expect(localHref("/catalog/")).toBe("/catalog/");
    expect(localHref("/docs")).toBe("/docs");
  });
});
