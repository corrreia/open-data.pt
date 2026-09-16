import { WorkerEntrypoint } from "cloudflare:workers";
import {
  collectNormalized,
  resolveTopicFeed,
  topicCollector,
  topicFeedKinds,
  type CollectionRequest,
  type CollectionResult,
  type ExampleFeed,
  type FeedGatekeeper,
  type FeedKindDescription,
  type GatekeeperDescription,
  type GatekeeperLibraries,
  type GatekeeperLibrary,
  type ResolvedFeed,
  type SourceConfig,
  type TopicOptions,
} from "@open-data-pt/gatekeeper-shared";
import { OPENDATASOFT_FEEDS, opendatasoftCollector } from "@open-data-pt/gatekeeper-shared/formats/opendatasoft";
import { UDATA_FEEDS, udataCollector } from "@open-data-pt/gatekeeper-shared/formats/udata";
import { HEALTH_EXAMPLES } from "./examples";

/**
 * One Worker per catalog topic. It holds no parsing: it names its libraries,
 * hands each the vars and secrets it needs, and lists the example feeds it owns.
 */
export default class HealthGatekeeper extends WorkerEntrypoint<Env> implements FeedGatekeeper {
  override async fetch(): Promise<Response> {
    return new Response("This Gatekeeper is available through RPC only.", { status: 404 });
  }

  async describe(): Promise<GatekeeperDescription> {
    return { kind: "health", name: "Health services" };
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
    return HEALTH_EXAMPLES;
  }

  private topic(): TopicOptions {
    return { gatekeeperKind: "health", libraries: this.libraries() };
  }

  /** The wiring: which library answers for a feed, and what it is given to do it with. */
  private libraries(): GatekeeperLibraries {
    return new Map<string, GatekeeperLibrary>([
      [
        "opendatasoft",
        {
          kinds: Object.values(OPENDATASOFT_FEEDS),
          collector: (config: SourceConfig) => opendatasoftCollector({ config, hosts: this.env.OPENDATASOFT_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
        },
      ],
      [
        "udata",
        {
          kinds: Object.values(UDATA_FEEDS),
          collector: (config: SourceConfig) => udataCollector({ config, hosts: this.env.UDATA_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
        },
      ],
    ]);
  }
}
