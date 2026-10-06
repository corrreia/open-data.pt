/*
 * The MCP server's identity and guide. Two servers share them: the public one at
 * /mcp, which runs code on Dynamic Workers for any assistant, and the copy the
 * site's own agent runs in the visitor's browser. Both offer the same `search`
 * and `execute` tools, so what one learns to do works on the other.
 */

/** What the server answers initialize with, and what its Server Card says. */
export const MCP_SERVER_NAME = "open-data.pt";
export const MCP_SERVER_VERSION = "0.1.0";

/** Appended to the execute tool's description: what the API holds and how to read it well. */
export const MCP_GUIDE = `open-data.pt is a free, keyless, read-only JSON API over Portuguese public data: energy, mobility, weather and environment, health, economy, society and culture, government, telecommunications, cities. Only GET requests to paths under /api work.

- Every product is read under /api/products/{slug}; there is no /api/{slug}. Every list answers as an object, { data: [...], nextCursor }: read .data, not the answer itself.
- Start with GET /api/products: every product's slug, title, description, role, schema, rowCount, cadence and freshness. Filter that list in your code; do not return it whole.
- The role says how to read a product. reference, current-state, event-log and summary: GET /api/products/{slug}/records (limit up to 500; pass nextCursor back as cursor), or /records/all for every row at once. time-series: GET /api/products/{slug}/series (seriesKey, from, to, limit up to 1000).
- What is at a place (a plot, a building, an address you have coordinates for): first GET /api/products?lat={lat}&lon={lon} lists the products whose extent reaches the point, from the index alone; then ask the ones that fit the question GET /api/products/{slug}/at?lat={lat}&lon={lon}, which returns the polygons containing the point (land-use class, easements, parish, flood zone) and the points and lines within radius metres (default 25, at most 1000), nearest first, with _distance in metres. Ask a few relevant products rather than all of them, and read each answer with its product's title and description: a class means what its product says it means. notIndexed lists products whose extent is not known yet, which may also cover the point; say so rather than claiming nothing is there.
- Filter records with where=field:value (up to five, all must match) and bbox=minLon,minLat,maxLon,maxLat. Pass several where filters as an array: query: { where: ["line:1", "status:open"] }.
- A filtered /records page reads on until it fills, but one request does a bounded amount of work, so on a large product a page can come back short or with an empty data and a nextCursor. Empty data with a nextCursor is not the end and does not mean nothing matches: follow nextCursor until it is absent before concluding that, or read /records/all with the same filters.
- History: /events, /series/range, /changes/range and /series/changes/range take from and to (ISO 8601, at most 366 days apart), page with nextCursor, and report their coverage.
- For a time series over weeks, months or years, prefer GET /api/products/{slug}/series/summary?from&to: count, mean, min and max per hour, Lisbon day or Lisbon month, read from summary files, so it is fast and cheap. Name series with seriesKey (repeatable, up to ten).
- GET /api/feeds says where each dataset comes from and who publishes it; GET /api/outages says when a source was down.
- A failed read throws an Error carrying the HTTP status and detail. After a 429, wait before retrying. Answers over 8 MB are refused: page or filter instead.
- What you return is cut to about 6,000 tokens, so return only what the answer needs.
- The data belongs to its publishers: cite the licence and attribution on the product, not open-data.pt.
- When open-data.pt falls short of what the person needs, say so and offer to open an issue for them, or give them the link. No product has it: https://github.com/corrreia/open-data.pt/issues/new?template=suggest-source.yml, with where it is published and who publishes it if you found out. A product has it but its cadence is too slow for them: https://github.com/corrreia/open-data.pt/issues/new?template=faster-cadence.yml&page=https://open-data.pt/product/?slug={slug}, saying how often they need it and why. A product stopped updating or disagrees with its publisher: https://github.com/corrreia/open-data.pt/issues/new?template=broken-source.yml.`;
