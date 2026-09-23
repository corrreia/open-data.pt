import { WorkerEntrypoint } from "cloudflare:workers";
import type { CatalogDescription } from "@open-data-pt/contract";

import { CATALOG, FEEDS, RUNNABLE, datasetEnabled, publisherInputs, runtimeOf } from "./catalog";
import {
  buildLibrary,
  collectNormalized,
  feedCollector,
  libraryFeedKinds,
  resolveLibraryFeed,
  type CollectionRequest,
  type CollectionResult,
  type ExampleFeed,
  type FeedKindDescription,
  type GatekeeperDescription,
  type GatekeeperLibraries,
  type Library,
  type ResolvedFeed,
  type SourceConfig,
} from "./index";
import { sha256Hex } from "./source-http";

/** Each selection of libraries' catalog version, worked out once per isolate: the catalog is fixed for a release. */
const VERSIONS = new Map<string, Promise<string>>();

/**
 * The libraries this Worker carries, comma-separated, so `pnpm dev ckan`
 * installs CKAN's examples and polls nobody else. It is a var of the Worker's
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

    async describe(): Promise<GatekeeperDescription> {
      return { kind: "gatekeeper", name: "open-data.pt Gatekeeper" };
    }

    async listFeedKinds(): Promise<FeedKindDescription[]> {
      return libraryFeedKinds(this.libraries());
    }

    async resolveFeed(config: SourceConfig): Promise<ResolvedFeed> {
      return resolveLibraryFeed(config, this.libraries());
    }

    /** A feed runs the functions its own file defines. A feed no file defines any more was retired, and has nothing to run. */
    async collect(request: CollectionRequest): Promise<CollectionResult> {
      const feed = RUNNABLE.get(request.feed.slug);
      if (!feed) return { kind: "failure", code: "invalid-config", retryable: false };
      return collectNormalized(request, feedCollector(feed, request.resolved.config, this.libraries(), runtimeOf(feed.slug)));
    }

    /** Every feed of a publisher we may republish that a carried library reads; a held publisher's code ships, and installs nothing. */
    async exampleFeeds(): Promise<ExampleFeed[]> {
      const carried = new Set(this.carried().map((library) => library.deployment.source));
      return FEEDS.filter((feed) => carried.has(feed.config.source ?? "") && datasetEnabled(feed.dataset));
    }

    async catalog(): Promise<CatalogDescription> {
      return CATALOG;
    }

    /** The digest of what `catalog`, `exampleFeeds` and `listFeedKinds` answer for the libraries this Worker carries. */
    async catalogVersion(): Promise<string> {
      const selection = this.carried()
        .map((library) => library.deployment.source)
        .join(",");
      let version = VERSIONS.get(selection);
      if (!version) {
        version = Promise.all([this.exampleFeeds(), this.listFeedKinds()]).then(([examples, kinds]) => sha256Hex(JSON.stringify({ catalog: CATALOG, examples, kinds })));
        VERSIONS.set(selection, version);
      }
      return version;
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
