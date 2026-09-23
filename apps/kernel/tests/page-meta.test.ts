import { readFileSync } from "node:fs";
import type { JsonObject, JsonValue } from "@open-data-pt/contract";
import { describe, expect, it } from "vitest";
import { handleSite, type SiteHost } from "../src/discovery";
import { PREVIEW_IMAGE } from "../src/page-meta";
import { jsonAs } from "./support";

const ORIGIN = "https://open-data.pt";

const FEED: JsonObject = {
  id: "feed_fuel",
  title: "Fuel prices",
  description: "Prices at every station.",
  dataset: {
    id: "dgeg-fuel-prices",
    title: "Fuel prices",
    publisher: { id: "dgeg", name: "Direção-Geral de Energia e Geologia", url: "https://www.dgeg.gov.pt/" },
    licence: { id: "source-terms", name: "The publisher's own terms" },
    topics: ["energy"],
  },
  format: "own-api",
  cadenceSeconds: 3600,
  sourceUrl: "https://precoscombustiveis.dgeg.gov.pt/",
};
const PRODUCT: JsonObject = {
  slug: "fuel-stations",
  title: 'Station prices "today" & <more> $1',
  description: "Prices at every station in mainland Portugal.",
  feedId: "feed_fuel",
  role: "current-state",
  schema: {
    fields: [
      { id: "station", name: "Station", type: "string" },
      { id: "price", name: "Price", type: "number", unit: "EUR/l" },
      { id: "latitude", name: "Latitude", type: "latitude" },
    ],
  },
  rowCount: 2,
  updatedAt: "2026-09-15T10:00:00.000Z",
  cadenceSeconds: 3600,
  licence: { id: "cc-by-4.0", name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
};
/** A time series whose description is too short for Google and whose licence is only a placeholder. */
const AVERAGE: JsonObject = {
  slug: "fuel-average",
  title: "Average fuel price",
  description: "Média",
  feedId: "feed_fuel",
  role: "time-series",
  schema: { fields: [{ id: "value", name: "Value", type: "number", unit: "EUR/l" }] },
  rowCount: 30,
  updatedAt: "2026-09-15T09:00:00.000Z",
  licence: { id: "source-terms", name: "No licence stated" },
};

const API = new Map<string, JsonValue>([
  ["/api/products/fuel-stations", PRODUCT],
  ["/api/products/fuel-average", AVERAGE],
  ["/api/feeds/feed_fuel", { data: FEED }],
  ["/api/feeds", { data: [FEED] }],
  ["/api/products", { data: [PRODUCT, AVERAGE] }],
]);

/** The API as fixtures, and every page as its real HTML file from the site's source. */
const host: SiteHost = {
  api: async (path) => {
    const body = API.get(path);
    return body === undefined ? Response.json({ type: "about:blank", title: "Not found", status: 404, detail: "Not found" }, { status: 404 }) : Response.json(body);
  },
  assets: async (request) => {
    const path = new URL(request.url).pathname;
    return new Response(readFileSync(`apps/site/${path.slice(1)}index.html`), { headers: { "Content-Type": "text/html", ETag: '"the-file"' } });
  },
};

async function page(path: string) {
  const response = await handleSite(new Request(`${ORIGIN}${path}`, { headers: { Accept: "text/html" } }), host);
  const html = await response.text();
  const structured = [...html.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map((match) => match[1] ?? "");
  return {
    response,
    html,
    structured,
    title: /<title>([^<]*)<\/title>/.exec(html)?.[1],
    canonical: /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1],
    meta: (key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`).exec(html)?.[1],
  };
}

describe("link previews", () => {
  it("gives every page a canonical URL, Open Graph and X card tags, and the home page screenshot", async () => {
    for (const path of ["/", "/catalog/", "/publisher/", "/product/", "/start/", "/status/", "/operations/", "/contribute/"]) {
      const { response, canonical, meta } = await page(path);
      expect(canonical, path).toBe(`${ORIGIN}${path}`);
      expect(meta("og:url"), path).toBe(`${ORIGIN}${path}`);
      expect(meta("og:type"), path).toBe("website");
      expect(meta("og:site_name"), path).toBe("open-data.pt");
      expect(meta("og:description"), path).not.toBe("");
      expect(meta("og:image"), path).toBe(`${ORIGIN}/og-image.png`);
      expect(meta("og:image:alt"), path).toBe(PREVIEW_IMAGE.alt);
      expect(meta("twitter:card"), path).toBe("summary_large_image");
      expect(meta("twitter:title"), path).toBe(meta("og:title"));
      // The file's entity tag no longer describes what was sent.
      expect(response.headers.get("ETag"), path).toBeNull();
    }
    expect((await page("/")).meta("og:title")).toBe("Public data from Portugal, in one place");
    expect((await page("/catalog/")).meta("og:title")).toBe("Catalog");
  });

  it("names the product a page shows, escaped, with only its slug in the canonical URL", async () => {
    const { html, title, canonical, meta } = await page("/product/?slug=fuel-stations&ref=newsletter");
    expect(title).toBe("Station prices &quot;today&quot; &amp; &lt;more&gt; $1 · open-data.pt");
    expect(meta("og:title")).toBe("Station prices &quot;today&quot; &amp; &lt;more&gt; $1");
    expect(meta("og:description")).toBe("Prices at every station in mainland Portugal. From Direção-Geral de Energia e Geologia, as free JSON with no key.");
    expect(meta("description")).toBe(meta("og:description"));
    expect(canonical).toBe(`${ORIGIN}/product/?slug=fuel-stations`);
    expect(html).not.toContain("<more>");
  });

  it("names publishers and topics, and falls back to the page's own words for a name that does not exist", async () => {
    expect((await page("/publisher/?id=dgeg")).meta("og:title")).toBe("Direção-Geral de Energia e Geologia");
    expect((await page("/licence/?id=cc-by-4.0")).meta("og:title")).toBe("CC BY 4.0");
    expect((await page("/licence/?id=nothing")).meta("og:title")).toBe("Licences");
    const topic = await page("/catalog/?topic=energy&q=diesel");
    expect(topic.meta("og:title")).toBe("Energy datasets");
    expect(topic.canonical).toBe(`${ORIGIN}/catalog/?topic=energy`);
    const unknownTopic = await page("/catalog/?topic=nothing");
    expect(unknownTopic.meta("og:title")).toBe("Catalog");
    expect(unknownTopic.canonical).toBe(`${ORIGIN}/catalog/`);
    const unknownProduct = await page("/product/?slug=nothing");
    expect(unknownProduct.title).toBe("Dataset · open-data.pt");
    expect(unknownProduct.canonical).toBe(`${ORIGIN}/product/`);
  });

  it("describes a product page as a schema.org Dataset for Google Dataset Search", async () => {
    const { structured } = await page("/product/?slug=fuel-stations&ref=newsletter");
    expect(structured).toHaveLength(1);
    // A "<" in the data is written <, so it cannot close the script element early.
    expect(structured[0]).not.toContain("<");
    const markup = jsonAs<JsonObject>(structured[0] ?? "");
    expect(markup).toEqual({
      "@context": "https://schema.org",
      "@type": "Dataset",
      name: 'Station prices "today" & <more> $1',
      description:
        "Prices at every station in mainland Portugal. Published by Direção-Geral de Energia e Geologia, collected every hour by open-data.pt and served as free JSON with no key.",
      url: `${ORIGIN}/product/?slug=fuel-stations`,
      isAccessibleForFree: true,
      dateModified: "2026-09-15T10:00:00.000Z",
      spatialCoverage: { "@type": "Place", name: "Portugal" },
      includedInDataCatalog: { "@type": "DataCatalog", name: "open-data.pt", url: `${ORIGIN}/catalog/` },
      distribution: [
        { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${ORIGIN}/api/products/fuel-stations/records/all` },
        { "@type": "DataDownload", encodingFormat: "application/geo+json", contentUrl: `${ORIGIN}/api/products/fuel-stations.geojson` },
      ],
      variableMeasured: [
        { "@type": "PropertyValue", name: "Station" },
        { "@type": "PropertyValue", name: "Price", unitText: "EUR/l" },
        { "@type": "PropertyValue", name: "Latitude" },
      ],
      creator: { "@type": "Organization", name: "Direção-Geral de Energia e Geologia", url: "https://www.dgeg.gov.pt/" },
      keywords: ["Energy"],
      isBasedOn: "https://precoscombustiveis.dgeg.gov.pt/",
      license: "https://creativecommons.org/licenses/by/4.0/",
    });
  });

  it("pads a short description past Google's minimum, names no licence for a placeholder, and points a series at its points", async () => {
    const markup = jsonAs<JsonObject>((await page("/product/?slug=fuel-average")).structured[0] ?? "");
    expect(markup.description).toBe("Média. Published by Direção-Geral de Energia e Geologia by open-data.pt and served as free JSON with no key.");
    expect(String(markup.description).length).toBeGreaterThanOrEqual(50);
    expect(markup.license).toBeUndefined();
    expect(markup.distribution).toEqual([{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${ORIGIN}/api/products/fuel-average/series?limit=1000` }]);
    for (const path of ["/", "/catalog/", "/product/?slug=nothing"]) expect((await page(path)).structured, path).toEqual([]);
  });

  it("declares the preview image's real size, within what X and Facebook accept", () => {
    const png = readFileSync(`apps/site/public${PREVIEW_IMAGE.path}`);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([PREVIEW_IMAGE.width, PREVIEW_IMAGE.height]);
    expect(PREVIEW_IMAGE.width / PREVIEW_IMAGE.height).toBeCloseTo(1.905, 2);
    expect(png.length).toBeLessThan(5 * 1024 * 1024);
  });
});
