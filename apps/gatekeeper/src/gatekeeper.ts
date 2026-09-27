import { WorkerEntrypoint } from "cloudflare:workers";
import type { CatalogDescription } from "@open-data-pt/contract";

import { FEEDS, RUNNABLE, catalogOf, feedEnabled, publisherInputs, runtimeOf } from "./catalog";
import { buildLibrary, collectNormalized, otherRelease, feedCollector, type CollectionRequest, type CollectionResult, type GatekeeperLibraries, type Library } from "./index";
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

/**
 * The Gatekeeper Worker: every library, built from the Worker's environment,
 * behind the RPC operations of `FeedGatekeeper`. A feed's `source` key
 * routes it to its library; the Worker parses nothing itself.
 */
export function gatekeeper<E extends object>(libraries: readonly Library[]) {
  return class Gatekeeper extends WorkerEntrypoint<E> {
    override async fetch(): Promise<Response> {
      return new Response("The Gatekeeper is available through RPC only.", { status: 404 });
    }

    /**
     * A feed runs the configuration and the functions its own file defines. A feed no file defines any more was
     * retired, and has nothing to run.
     */
    async collect(request: CollectionRequest): Promise<CollectionResult> {
      // Before the feed is looked up: a kernel on another release names it another way.
      const mismatch = otherRelease(request);
      if (mismatch) return mismatch;
      const feed = RUNNABLE.get(request.slug);
      if (!feed) return { kind: "failure", code: "invalid-config", retryable: false };
      return collectNormalized(request, feedCollector(feed, this.libraries(), runtimeOf(feed.slug)));
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
