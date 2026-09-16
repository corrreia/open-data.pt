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
import { DGEG_FEEDS, dgegCollector } from "@open-data-pt/gatekeeper-shared/sources/dgeg";
import { OMIE_FEEDS, omieCollector } from "@open-data-pt/gatekeeper-shared/sources/omie";
import { REN_FEEDS, renCollector } from "@open-data-pt/gatekeeper-shared/sources/ren";
import { ENERGY_EXAMPLES } from "./examples";

/**
 * One Worker per catalog topic. It holds no parsing: it names its libraries,
 * hands each the vars and secrets it needs, and lists the example feeds it owns.
 */
export default class EnergyGatekeeper
  extends WorkerEntrypoint<Env>
  implements FeedGatekeeper
{
  override async fetch(): Promise<Response> {
    return new Response("This Gatekeeper is available through RPC only.", { status: 404 });
  }

  async describe(): Promise<GatekeeperDescription> {
    return { kind: "energy", name: "Energy and electricity" };
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
    return ENERGY_EXAMPLES;
  }

  private topic(): TopicOptions {
    return { gatekeeperKind: "energy", libraries: this.libraries() };
  }

  /** The wiring: which library answers for a feed, and what it is given to do it with. */
  private libraries(): GatekeeperLibraries {
    return new Map<string, GatekeeperLibrary>([
      ["ren", { kinds: Object.values(REN_FEEDS), collector: (config: SourceConfig) => renCollector({ config, apiOrigin: this.env.REN_API_ORIGIN, dataApiOrigin: this.env.REN_DATA_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }) }],
      ["omie", { kinds: Object.values(OMIE_FEEDS), collector: (config: SourceConfig) => omieCollector({ config, apiOrigin: this.env.OMIE_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }) }],
      ["dgeg", { kinds: Object.values(DGEG_FEEDS), collector: (config: SourceConfig) => dgegCollector({ config, apiOrigin: this.env.DGEG_API_ORIGIN, fetcher: (input, init) => fetch(input, init) }) }],
      ["opendatasoft", { kinds: Object.values(OPENDATASOFT_FEEDS), collector: (config: SourceConfig) => opendatasoftCollector({ config, hosts: this.env.OPENDATASOFT_ALLOWED_HOSTS, fetcher: (input, init) => fetch(input, init) }) }],
    ]);
  }
}
