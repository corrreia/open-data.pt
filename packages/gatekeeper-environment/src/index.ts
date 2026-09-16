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
import { ARCGIS_FEEDS, arcgisCollector } from "@open-data-pt/gatekeeper-shared/formats/arcgis";
import { OGC_FEEDS, ogcCollector } from "@open-data-pt/gatekeeper-shared/formats/ogc";
import { IPMA_FEEDS, ipmaCollector } from "@open-data-pt/gatekeeper-shared/sources/ipma";
import { ENVIRONMENT_EXAMPLES } from "./examples";

/**
 * One Worker per catalog topic. It holds no parsing: it names its libraries,
 * hands each the vars and secrets it needs, and lists the example feeds it owns.
 */
export default class EnvironmentGatekeeper extends WorkerEntrypoint<Env> implements FeedGatekeeper {
  override async fetch(): Promise<Response> {
    return new Response("This Gatekeeper is available through RPC only.", { status: 404 });
  }

  async describe(): Promise<GatekeeperDescription> {
    return { kind: "environment", name: "Environment and weather" };
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
    return ENVIRONMENT_EXAMPLES;
  }

  private topic(): TopicOptions {
    return { gatekeeperKind: "environment", libraries: this.libraries() };
  }

  /** The wiring: which library answers for a feed, and what it is given to do it with. */
  private libraries(): GatekeeperLibraries {
    return new Map<string, GatekeeperLibrary>([
      [
        "ogc",
        {
          kinds: Object.values(OGC_FEEDS),
          collector: (config: SourceConfig) => ogcCollector({ config, hosts: this.env.OGC_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
        },
      ],
      [
        "ipma",
        {
          kinds: Object.values(IPMA_FEEDS),
          collector: (config: SourceConfig) => ipmaCollector({ config, apiOrigin: this.env.IPMA_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
        },
      ],
      [
        "arcgis",
        {
          kinds: Object.values(ARCGIS_FEEDS),
          collector: (config: SourceConfig) => arcgisCollector({ config, hosts: this.env.ARCGIS_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
        },
      ],
    ]);
  }
}
