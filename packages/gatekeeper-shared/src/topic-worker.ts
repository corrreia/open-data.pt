import { WorkerEntrypoint } from "cloudflare:workers";
import {
  collectNormalized,
  resolveTopicFeed,
  topicCollector,
  topicFeedKinds,
  TOPICS,
  type CollectionRequest,
  type CollectionResult,
  type ExampleFeed,
  type FeedKindDescription,
  type GatekeeperDescription,
  type GatekeeperLibraries,
  type LibraryDeployment,
  type ResolvedFeed,
  type SourceConfig,
  type Topic,
  type TopicOptions,
} from "./index";

/**
 * One topic's Gatekeeper Worker. It holds no parsing: its libraries are built
 * from the Worker's environment, and it owns the examples whose first topic is
 * its own. Each `packages/gatekeeper-<topic>/src/index.ts` is generated to call
 * this with the libraries those examples use.
 */
export function topicGatekeeper<E>(topic: Topic, deployments: readonly LibraryDeployment<E>[], examples: readonly ExampleFeed[]) {
  const owned = examples.filter((example) => example.topics?.[0] === topic);
  // The five RPC operations of `FeedGatekeeper`, which the conformance test calls through a real service binding.
  return class TopicGatekeeper extends WorkerEntrypoint<E> {
    override async fetch(): Promise<Response> {
      return new Response("This Gatekeeper is available through RPC only.", { status: 404 });
    }

    async describe(): Promise<GatekeeperDescription> {
      return { kind: topic, name: TOPICS[topic] };
    }

    async listFeedKinds(): Promise<FeedKindDescription[]> {
      return topicFeedKinds(this.libraries());
    }

    async resolveFeed(config: SourceConfig): Promise<ResolvedFeed> {
      return resolveTopicFeed(config, this.topic());
    }

    async collect(request: CollectionRequest): Promise<CollectionResult> {
      return collectNormalized(request, topicCollector(request.resolved.config, this.topic()));
    }

    async exampleFeeds(): Promise<ExampleFeed[]> {
      return owned;
    }

    private topic(): TopicOptions {
      return { gatekeeperKind: topic, libraries: this.libraries() };
    }

    private libraries(): GatekeeperLibraries {
      return new Map(deployments.map((deployment) => [deployment.source, deployment.library(this.env)]));
    }
  };
}
