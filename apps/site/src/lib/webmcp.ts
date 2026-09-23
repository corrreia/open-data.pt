// Tools an AI agent in the visitor's browser can call on any page (WebMCP): search the
// catalog, describe a product, read its rows, and open its page. They read the same
// public API the pages do.

import { apiGet, productHref, productPath } from "./api";
import { buildDatasets, fetchFeeds, fetchProducts } from "./catalog";
import type { JsonRecord, JsonValue, Product } from "./types";

interface WebMcpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonRecord;
  annotations: { readOnlyHint: boolean };
  execute: (input: JsonRecord) => Promise<JsonValue>;
}

/** navigator.modelContext as the WebMCP draft defines it; provideContext is the earlier draft's single call. */
interface ModelContext {
  registerTool?: (tool: WebMcpTool) => Promise<void>;
  provideContext?: (context: { tools: WebMcpTool[] }) => void;
}

declare global {
  interface Navigator {
    readonly modelContext?: ModelContext;
  }
}

const MAX_RESULTS = 25;
const MAX_ROWS = 100;

const SLUG = { type: "string", description: "The product's slug, from search_datasets." };

const absolute = (path: string) => new URL(path, window.location.origin).href;
const text = (value: JsonValue | undefined) => (value === undefined || value === null ? "" : String(value).trim());

/** A whole number from 1 to max, or the fallback when the input is missing or not one. */
function count(value: JsonValue | undefined, fallback: number, max: number) {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number >= 1 ? Math.min(number, max) : fallback;
}

const TOOLS: WebMcpTool[] = [
  {
    name: "search_datasets",
    title: "Search datasets",
    description:
      "Search open-data.pt's catalog of Portuguese public data by words in a dataset's title, publisher, topic or description. Returns the matching tables and series with the slug the other tools take.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words that must all match, such as 'metro lisboa' or 'combustíveis'. Empty lists everything." },
        limit: { type: "integer", minimum: 1, maximum: MAX_RESULTS, description: "At most this many results; 10 when not given." },
      },
    },
    annotations: { readOnlyHint: true },
    async execute(input) {
      const words = text(input.query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
      const [products, feeds] = await Promise.all([fetchProducts(), fetchFeeds()]);
      const results: JsonValue[] = [];
      for (const dataset of buildDatasets(products, feeds)) {
        for (const { product, label } of dataset.products) {
          const haystack =
            `${dataset.title} ${label} ${product.title} ${product.slug} ${dataset.publisher.name} ${dataset.topics.join(" ")} ${dataset.description}`.toLocaleLowerCase();
          if (!words.every((word) => haystack.includes(word))) continue;
          results.push({
            slug: product.slug,
            title: product.title,
            dataset: dataset.title,
            publisher: dataset.publisher.name,
            licence: dataset.licence.name,
            topics: dataset.topics,
            role: product.role,
            rows: product.rowCount,
            updatedAt: product.updatedAt,
            page: absolute(productHref(product.slug)),
            api: absolute(productPath(product.slug)),
          });
        }
      }
      return { total: results.length, results: results.slice(0, count(input.limit, 10, MAX_RESULTS)) };
    },
  },
  {
    name: "get_product",
    title: "Describe a product",
    description: "One table or series on open-data.pt: title, description, role, schema (field ids, types and units), row count, freshness, licence and attribution.",
    inputSchema: { type: "object", properties: { slug: SLUG }, required: ["slug"] },
    annotations: { readOnlyHint: true },
    execute: async (input) => apiGet<JsonValue>(productPath(text(input.slug))),
  },
  {
    name: "read_rows",
    title: "Read rows",
    description:
      "A product's current rows, or a time series' latest points, as JSON. Filter records with where: field:value pairs that must all match. Cite the licence and attribution that get_product returns.",
    inputSchema: {
      type: "object",
      properties: {
        slug: SLUG,
        limit: { type: "integer", minimum: 1, maximum: MAX_ROWS, description: "At most this many rows; 20 when not given." },
        where: { type: "array", items: { type: "string" }, maxItems: 5, description: "Record filters such as 'line:1'. Time series ignore them." },
      },
      required: ["slug"],
    },
    annotations: { readOnlyHint: true },
    async execute(input) {
      const slug = text(input.slug);
      const product = await apiGet<Product>(productPath(slug));
      const query = new URLSearchParams({ limit: String(count(input.limit, 20, MAX_ROWS)) });
      if (product.role === "time-series") return apiGet<JsonValue>(productPath(slug, `/series?${query}`));
      for (const filter of Array.isArray(input.where) ? input.where : []) query.append("where", text(filter));
      return apiGet<JsonValue>(productPath(slug, `/records?${query}`));
    },
  },
  {
    name: "open_product",
    title: "Open a product page",
    description: "Show a product's page in this tab: its rows, map or chart, schema, history and source.",
    inputSchema: { type: "object", properties: { slug: SLUG }, required: ["slug"] },
    annotations: { readOnlyHint: false },
    async execute(input) {
      const href = productHref(text(input.slug));
      window.location.assign(href);
      return { opened: absolute(href) };
    },
  },
];

/** Offers the tools to a browser agent where the browser supports WebMCP; elsewhere this does nothing. */
export function registerSiteTools() {
  const context = navigator.modelContext;
  if (!context) return;
  if (context.registerTool) {
    for (const tool of TOOLS) context.registerTool(tool).catch((error) => console.warn(`WebMCP did not take the ${tool.name} tool`, error));
  } else {
    context.provideContext?.({ tools: TOOLS });
  }
}
