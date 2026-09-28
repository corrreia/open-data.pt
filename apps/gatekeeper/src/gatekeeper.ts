import { WorkerEntrypoint } from "cloudflare:workers";
import type { CatalogDescription } from "@open-data-pt/contract";

import { FEEDS, catalogOf, enabledFeed, feedEnabled, publisherInputs, runtimeOf } from "./catalog";
import {
  buildLibrary,
  collectNormalized,
  otherRelease,
  feedCollector,
  type CollectionRequest,
  type CollectionResult,
  type GatekeeperLibraries,
  type Library,
  type RunnableFeed,
} from "./index";
import { PLACED_COLLECTION_PATH, collectionOf, placedRequest, placedResponse, placedResult } from "./placed";
import { sha256Hex } from "./source-http";

/**
 * Each selection of libraries' catalog and its digest, worked out once per isolate: a release always answers the
 * same catalog. Resolving every feed hashes each configuration twice, which is worth doing once, not on every sync.
 */
const CATALOGS = new Map<string, Promise<{ catalog: CatalogDescription; version: string }>>();

/**
 * The libraries this Worker carries, comma-separated, so `pnpm dev ckan`
 * installs CKAN's feeds and polls nobody else. It is a var of the Worker's
 * configuration, empty in a deployment and overridden per local session with
 * `--var`; `.dev.vars` cannot carry it, because this Worker declares
 * `secrets.required` and Wrangler then loads only those keys from that file.
 */
interface DevVars {
  readonly GATEKEEPER_LIBRARIES?: string;
}

/** This Worker, bound to itself, so a placed library's collection can run in its `fetch` handler (`placed.ts`). */
interface PlacedBinding {
  readonly PLACED?: Fetcher;
}

/**
 * The Gatekeeper Worker: every library, built from the Worker's environment,
 * behind the RPC operations of `FeedGatekeeper`. A feed's `source` key
 * routes it to its library; the Worker parses nothing itself.
 */
export function gatekeeper<E extends object>(libraries: readonly Library[]) {
  return class Gatekeeper extends WorkerEntrypoint<E> {
    /**
     * Runs a placed library's collection, where Cloudflare places this handler. Nothing else: the Worker has no route
     * and no workers.dev URL, so only its own binding reaches here, and it asks only for enabled feeds of placed libraries.
     */
    override async fetch(request: Request): Promise<Response> {
      if (request.method !== "POST" || new URL(request.url).pathname !== PLACED_COLLECTION_PATH) {
        return new Response("The Gatekeeper is available through RPC only.", { status: 404 });
      }
      const collection = await collectionOf(request);
      const feed = enabledFeed(collection.slug);
      if (!feed || !this.placed(feed)) return new Response("Not a placed feed.", { status: 404 });
      return placedResponse(await this.collectHere(collection, feed));
    }

    /**
     * A feed runs the configuration and the functions its own file defines. A feed no file defines any more was
     * retired, and one of a publisher held for permission is not ours to read: neither has anything to run.
     */
    async collect(request: CollectionRequest): Promise<CollectionResult> {
      // Before the feed is looked up: a kernel on another release names it another way.
      const mismatch = otherRelease(request);
      if (mismatch) return mismatch;
      const feed = enabledFeed(request.slug);
      if (!feed) return { kind: "failure", code: "invalid-config", retryable: false };
      // SAFETY: the Worker's environment is its bindings; PLACED, when the configuration declares it, is this Worker itself.
      const binding = (this.env as PlacedBinding).PLACED;
      if (!binding || !this.placed(feed)) return this.collectHere(request, feed);
      try {
        return await placedResult(await binding.fetch(placedRequest(request)));
      } catch (error) {
        // The handler it runs in was not reached, or broke off: nothing was read, and the next attempt may reach it.
        console.warn(JSON.stringify({ event: "placed_collection_failed", feed: feed.slug, error: String(error) }));
        return { kind: "failure", code: "upstream-error", retryable: true };
      }
    }

    private collectHere(request: CollectionRequest, feed: RunnableFeed): Promise<CollectionResult> {
      return collectNormalized(request, feedCollector(feed, this.libraries(), runtimeOf(feed.slug)));
    }

    /** Whether the feed's library runs its collections in the placed `fetch` handler. */
    private placed(feed: RunnableFeed): boolean {
      return libraries.some((library) => library.deployment.source === feed.config.source && library.deployment.placed === true);
    }

    /**
     * Every feed of a publisher we may republish that a carried library reads, resolved, with the vocabularies they
     * name. A held publisher's code ships, and installs nothing.
     */
    async catalog(): Promise<CatalogDescription> {
      return (await this.resolvedCatalog()).catalog;
    }

    /** The digest of what `catalog` answers for the libraries this Worker carries. */
    async catalogVersion(): Promise<string> {
      return (await this.resolvedCatalog()).version;
    }

    private resolvedCatalog(): Promise<{ catalog: CatalogDescription; version: string }> {
      const carried = this.carried().map((library) => library.deployment.source);
      const selection = carried.join(",");
      let resolved = CATALOGS.get(selection);
      if (!resolved) {
        const feeds = FEEDS.filter((feed) => carried.includes(feed.config.source ?? "") && feedEnabled(feed));
        resolved = catalogOf(feeds, this.libraries()).then(async (catalog) => ({ catalog, version: await sha256Hex(JSON.stringify(catalog)) }));
        // A catalog that could not be resolved is asked for again, not remembered.
        resolved.catch(() => CATALOGS.delete(selection));
        CATALOGS.set(selection, resolved);
      }
      return resolved;
    }

    private libraries(): GatekeeperLibraries {
      return new Map(this.carried().map((library) => [library.deployment.source, buildLibrary(library.deployment, this.env, publisherInputs(library.deployment.source))]));
    }

    private carried(): readonly Library[] {
      // SAFETY: the Worker's environment is its bindings plus whatever `.dev.vars` adds; only this one string is read.
      const only = ((this.env as DevVars).GATEKEEPER_LIBRARIES ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== "");
      return only.length === 0 ? libraries : libraries.filter((library) => only.includes(library.deployment.source));
    }
  };
}
