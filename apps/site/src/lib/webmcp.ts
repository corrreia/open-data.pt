// Tools an AI agent in the visitor's browser can call on any page (WebMCP): search the
// catalog, describe a product, read its rows, and open its page. They read the same
// public API the pages do.

import { apiGet, productHref, productPath } from "./api";
import { buildListings, fetchFeeds, fetchProducts, listingHaystack, searchWords } from "./catalog";
import type { Feed, JsonRecord, JsonValue, Product } from "./types";

/** What the agent hands every call: aborted when it cancels the call. */
interface ToolCall {
  signal?: AbortSignal;
}

interface WebMcpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonRecord;
  /**
   * `untrustedContentHint` marks results that carry text open-data.pt did not write: a publisher's titles,
   * descriptions and rows, which an agent should read as data, never as instructions.
   */
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: JsonRecord, call?: ToolCall) => Promise<JsonValue>;
}

/** A document's model context as the WebMCP draft defines it; provideContext is an earlier draft's single call. */
interface ModelContext {
  registerTool?: (tool: WebMcpTool) => Promise<void>;
  provideContext?: (context: { tools: WebMcpTool[] }) => void;
}

declare global {
  interface Document {
    readonly modelContext?: ModelContext;
  }
  interface Navigator {
    /** Where drafts before September 2026, and the browsers built on them, put the model context. */
    readonly modelContext?: ModelContext;
  }
}

const MAX_RESULTS = 25;
const MAX_ROWS = 100;
/** The catalog changes when a collection finishes, so an agent searching several times in a row reads it once. */
const CATALOG_TTL_MS = 5 * 60_000;

const SLUG = { type: "string", description: "The product's slug, from search_datasets." };

const absolute = (path: string) => new URL(path, window.location.origin).href;
const text = (value: JsonValue | undefined) => (value === undefined || value === null ? "" : String(value).trim());

/** A whole number from 1 to max, or the fallback when the input is missing or not one. */
function count(value: JsonValue | undefined, fallback: number, max: number) {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number >= 1 ? Math.min(number, max) : fallback;
}

let catalog: { at: number; lists: Promise<[Product[], Feed[]]> } | undefined;

/**
 * Every product and feed, read once for a few minutes rather than on every search: together they
 * are a few megabytes. One agent's cancelled search does not cancel the read another may share.
 */
async function catalogLists(signal: AbortSignal | undefined): Promise<[Product[], Feed[]]> {
  if (!catalog || Date.now() - catalog.at > CATALOG_TTL_MS) {
    const lists = Promise.all([fetchProducts(), fetchFeeds()]);
    catalog = { at: Date.now(), lists };
    lists.catch(() => {
      if (catalog?.lists === lists) catalog = undefined;
    });
  }
  const lists = await catalog.lists;
  signal?.throwIfAborted();
  return lists;
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
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, call) {
      const words = searchWords(text(input.query));
      const [products, feeds] = await catalogLists(call?.signal);
      const results: JsonValue[] = [];
      for (const listing of buildListings(products, feeds)) {
        const { product, title, description, publisher, licence, topics } = listing;
        const haystack = listingHaystack(listing);
        if (!words.every((word) => haystack.includes(word))) continue;
        results.push({
          slug: product.slug,
          title,
          description,
          publisher: publisher.name,
          licence: licence.name,
          topics,
          role: product.role,
          rows: product.rowCount,
          updatedAt: product.updatedAt,
          page: absolute(productHref(product.slug)),
          api: absolute(productPath(product.slug)),
        });
      }
      return { total: results.length, results: results.slice(0, count(input.limit, 10, MAX_RESULTS)) };
    },
  },
  {
    name: "get_product",
    title: "Describe a product",
    description: "One table or series on open-data.pt: title, description, role, schema (field ids, types and units), row count, freshness, licence and attribution.",
    inputSchema: { type: "object", properties: { slug: SLUG }, required: ["slug"] },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input, call) => apiGet<JsonValue>(productPath(text(input.slug)), call?.signal),
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
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, call) {
      const slug = text(input.slug);
      const product = await apiGet<Product>(productPath(slug), call?.signal);
      const query = new URLSearchParams({ limit: String(count(input.limit, 20, MAX_ROWS)) });
      if (product.role === "time-series") return apiGet<JsonValue>(productPath(slug, `/series?${query}`), call?.signal);
      for (const filter of Array.isArray(input.where) ? input.where : []) query.append("where", text(filter));
      return apiGet<JsonValue>(productPath(slug, `/records?${query}`), call?.signal);
    },
  },
  {
    name: "open_product",
    title: "Open a product page",
    description: "Show a product's page in this tab: its rows, map or chart, schema, history and source.",
    inputSchema: { type: "object", properties: { slug: SLUG }, required: ["slug"] },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) {
      const href = productHref(text(input.slug));
      // Leaving the page ends this document's tools, so the agent is answered first and the tab moves after.
      setTimeout(() => window.location.assign(href), 0);
      return { opened: absolute(href) };
    },
  },
];

/** Offers the tools to a browser agent where the browser supports WebMCP; elsewhere this does nothing. */
export function registerSiteTools() {
  const context = document.modelContext ?? navigator.modelContext;
  if (!context) return;
  if (context.registerTool) {
    for (const tool of TOOLS) context.registerTool(tool).catch((error) => console.warn(`WebMCP did not take the ${tool.name} tool`, error));
  } else {
    context.provideContext?.({ tools: TOOLS });
  }
}
