import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SITE_PAGES, sitePageOf } from "../src/lib/navigation";

const ORIGIN = "https://open-data.pt";
const fileOf = (path: string) => readFileSync(`apps/site${path === "/" ? "/" : path}index.html`, "utf8");

/**
 * A page opened in place takes its title from the list the site navigates by, and a page loaded
 * afresh from its own file; the two have to say the same, and every page the site has has to be on
 * the list, or a link to it would load the whole site again.
 */
describe("the pages the site opens in place", () => {
  it("lists every page the site builds, with the title of its file, starting the site from its own entry", () => {
    const vite = readFileSync("apps/site/vite.config.ts", "utf8");
    const built = /const ALL_PAGES = \[([^\]]*)\]/
      .exec(vite)?.[1]
      ?.match(/"([a-z]+)"/g)
      ?.map((name) => (name === '"index"' ? "/" : `/${name.slice(1, -1)}/`));
    expect([...SITE_PAGES.keys()].sort()).toEqual(built?.sort());
    for (const [path, page] of SITE_PAGES) {
      const html = fileOf(path);
      expect(/<title>([^<]*)<\/title>/.exec(html)?.[1], path).toBe(page.title);
      expect(html, path).toMatch(/<script type="module" src="\/src\/entries\/[a-z]+\.tsx"><\/script>/);
    }
  });

  it("opens only the site's own pages in place", () => {
    expect(sitePageOf(new URL(`${ORIGIN}/catalog/?topic=energy#results`), ORIGIN)).toBe("/catalog/");
    expect(sitePageOf(new URL(`${ORIGIN}/product/index.html?slug=x`), ORIGIN)).toBe("/product/");
    expect(sitePageOf(new URL(`${ORIGIN}/`), ORIGIN)).toBe("/");
    for (const elsewhere of [`${ORIGIN}/docs`, `${ORIGIN}/api/products`, `${ORIGIN}/llms.txt`, `${ORIGIN}/catalog`, "https://example.com/catalog/"]) {
      expect(sitePageOf(new URL(elsewhere), ORIGIN), elsewhere).toBeUndefined();
    }
  });
});
