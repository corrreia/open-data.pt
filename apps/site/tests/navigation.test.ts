import { readFileSync } from "node:fs";
import { SITE_PAGES as PAGES } from "@open-data-pt/api";
import { describe, expect, it } from "vitest";
import { SITE_PAGES, siteHref, sitePageOf } from "../src/lib/navigation";

const ORIGIN = "https://open-data.pt";

/**
 * Every page is served from one HTML shell that starts the site on the page its address names; a
 * page the site cannot draw would be a shell with nothing in it, and a link to a page missing from
 * the list would load the whole site again.
 */
describe("the pages the site opens in place", () => {
  it("draws every page the kernel serves the shell at, from the one entry the shell loads", () => {
    expect([...SITE_PAGES.keys()]).toEqual(PAGES.map((page) => page.path));
    for (const page of PAGES) expect(SITE_PAGES.get(page.path)?.title, page.path).toBe(page.title);
    const shell = readFileSync("apps/site/index.html", "utf8");
    expect(shell.match(/<script type="module" src="[^"]*"><\/script>/g)).toEqual(['<script type="module" src="/src/main.tsx"></script>']);
  });

  it("opens only the site's own pages in place, with or without the slash the kernel would add", () => {
    expect(sitePageOf(new URL(`${ORIGIN}/catalog/?topic=energy#results`), ORIGIN)).toBe("/catalog/");
    expect(sitePageOf(new URL(`${ORIGIN}/product/index.html?slug=x`), ORIGIN)).toBe("/product/");
    expect(sitePageOf(new URL(`${ORIGIN}/product?slug=x`), ORIGIN)).toBe("/product/");
    expect(sitePageOf(new URL(`${ORIGIN}/`), ORIGIN)).toBe("/");
    for (const elsewhere of [`${ORIGIN}/docs`, `${ORIGIN}/api/products`, `${ORIGIN}/llms.txt`, `${ORIGIN}/catalogue/`, "https://example.com/catalog/"]) {
      expect(sitePageOf(new URL(elsewhere), ORIGIN), elsewhere).toBeUndefined();
    }
  });

  it("reads a link the agent wrote as an address on this site, wherever the site runs", () => {
    expect(siteHref("product/?slug=fuel-stations")).toBe("/product/?slug=fuel-stations");
    expect(siteHref("/product/?slug=fuel-stations")).toBe("/product/?slug=fuel-stations");
    expect(siteHref("https://open-data.pt/product/?slug=fuel-stations")).toBe("/product/?slug=fuel-stations");
    expect(siteHref("https://open-data.pt")).toBe("/");
    expect(siteHref("https://www.dgeg.gov.pt/")).toBe("https://www.dgeg.gov.pt/");
    expect(siteHref("mailto:someone@example.com")).toBe("mailto:someone@example.com");
    expect(siteHref("#sources")).toBe("#sources");
  });
});
