import { WorkerEntrypoint } from "cloudflare:workers";
import {
  collectNormalized,
  r2Staging,
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
import { UDATA_FEEDS, udataCollector } from "@open-data-pt/gatekeeper-shared/formats/udata";
import { PARLIAMENT_FEEDS, parliamentCollector } from "@open-data-pt/gatekeeper-shared/sources/parliament";
import { GOVERNMENT_EXAMPLES } from "./examples";

/**
 * One Worker per catalog topic. It holds no parsing: it names its libraries,
 * hands each the vars and secrets it needs, and lists the example feeds it owns.
 */
export default class GovernmentGatekeeper extends WorkerEntrypoint<Env> implements FeedGatekeeper {
  override async fetch(): Promise<Response> {
    return new Response("This Gatekeeper is available through RPC only.", { status: 404 });
  }

  async describe(): Promise<GatekeeperDescription> {
    return { kind: "government", name: "Government and public administration" };
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
    return GOVERNMENT_EXAMPLES;
  }

  private topic(): TopicOptions {
    return { gatekeeperKind: "government", libraries: this.libraries() };
  }

  /** The wiring: which library answers for a feed, and what it is given to do it with. */
  private libraries(): GatekeeperLibraries {
    return new Map<string, GatekeeperLibrary>([
      [
        "udata",
        {
          kinds: Object.values(UDATA_FEEDS),
          collector: (config: SourceConfig) => udataCollector({ config, hosts: this.env.UDATA_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }),
        },
      ],
      [
        "parliament",
        {
          kinds: Object.values(PARLIAMENT_FEEDS),
          collector: (config: SourceConfig) => parliamentCollector({ config, fetcher: (input, init) => fetch(input, init), staging: r2Staging(this.env.PARLIAMENT_STAGING) }),
        },
      ],
    ]);
  }
}
