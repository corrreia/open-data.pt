import { WorkerEntrypoint } from "cloudflare:workers";
import {
  collectNormalized,
  resolveTopicFeed,
  topicCollector,
  topicFeedKinds,
  type CollectionRequest,
  type CollectionResult,
  type ExampleFeed,
  type FeedKindDescription,
  type GatekeeperDescription,
  type GatekeeperLibraries,
  type LibraryDeployment,
  type ResolvedFeed,
  type SourceConfig,
  type TopicOptions,
} from "./index";

/**
 * One library's Gatekeeper Worker. A Worker is how data is read, never what the
 * data is about: it carries a single library, built from the Worker's
 * environment, and owns that library's examples. Each
 * `packages/gatekeeper-<library>/src/index.ts` is generated to call this with
 * the library's deployment declaration and its examples.
 */
export function libraryGatekeeper<E>(deployment: LibraryDeployment<E>, examples: readonly ExampleFeed[]) {
  // The five RPC operations of `FeedGatekeeper`, which the conformance test calls through a real service binding.
  return class LibraryGatekeeper extends WorkerEntrypoint<E> {
    override async fetch(): Promise<Response> {
      return new Response("This Gatekeeper is available through RPC only.", { status: 404 });
    }

    async describe(): Promise<GatekeeperDescription> {
      return { kind: deployment.source, name: deployment.name };
    }

    async listFeedKinds(): Promise<FeedKindDescription[]> {
      return topicFeedKinds(this.libraries());
    }

    async resolveFeed(config: SourceConfig): Promise<ResolvedFeed> {
      return resolveTopicFeed(config, this.options());
    }

    async collect(request: CollectionRequest): Promise<CollectionResult> {
      return collectNormalized(request, topicCollector(request.resolved.config, this.options()));
    }

    async exampleFeeds(): Promise<ExampleFeed[]> {
      return [...examples];
    }

    private options(): TopicOptions {
      return { gatekeeperKind: deployment.source, libraries: this.libraries() };
    }

    private libraries(): GatekeeperLibraries {
      return new Map([[deployment.source, deployment.library(this.env)]]);
    }
  };
}
