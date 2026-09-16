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
import { GBFS_FEEDS, gbfsCollector } from "@open-data-pt/gatekeeper-shared/formats/gbfs";
import { GTFS_FEEDS, gtfsCollector } from "@open-data-pt/gatekeeper-shared/formats/gtfs";
import { CARRIS_FEEDS, carrisCollector } from "@open-data-pt/gatekeeper-shared/sources/carris";
import { METRO_FEEDS, metrolisboaCollector } from "@open-data-pt/gatekeeper-shared/sources/metrolisboa";
import { MOBILITY_EXAMPLES } from "./examples";

/**
 * One Worker per catalog topic. It holds no parsing: it names its libraries,
 * hands each the vars and secrets it needs, and lists the example feeds it owns.
 */
export default class MobilityGatekeeper extends WorkerEntrypoint<Env> implements FeedGatekeeper {
  override async fetch(): Promise<Response> {
    return new Response("This Gatekeeper is available through RPC only.", { status: 404 });
  }

  async describe(): Promise<GatekeeperDescription> {
    return { kind: "mobility", name: "Mobility and transport" };
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
    return MOBILITY_EXAMPLES;
  }

  private topic(): TopicOptions {
    return { gatekeeperKind: "mobility", libraries: this.libraries() };
  }

  /** The wiring: which library answers for a feed, and what it is given to do it with. */
  private libraries(): GatekeeperLibraries {
    return new Map<string, GatekeeperLibrary>([
      [
        "carris",
        {
          kinds: Object.values(CARRIS_FEEDS),
          collector: (config: SourceConfig) => carrisCollector({ config, apiOrigin: this.env.CARRIS_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }),
        },
      ],
      [
        "metrolisboa",
        {
          kinds: Object.values(METRO_FEEDS),
          collector: (config: SourceConfig) =>
            metrolisboaCollector({
              config,
              apiOrigin: this.env.METROLISBOA_API_ORIGIN,
              credentials: { key: this.env.ML_CONSUMER_KEY, secret: this.env.ML_CONSUMER_SECRET },
              fetcher: (input, init) => fetch(input, init),
            }),
        },
      ],
      [
        "gtfs",
        {
          kinds: Object.values(GTFS_FEEDS),
          collector: (config: SourceConfig) => gtfsCollector({ config, hosts: this.env.GTFS_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
        },
      ],
      [
        "gbfs",
        {
          kinds: Object.values(GBFS_FEEDS),
          collector: (config: SourceConfig) => gbfsCollector({ config, hosts: this.env.GBFS_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
        },
      ],
    ]);
  }
}
