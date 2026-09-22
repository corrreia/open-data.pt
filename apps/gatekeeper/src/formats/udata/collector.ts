import {
  allowedHosts,
  requireString,
  resolveFeed,
  type FeedKindDescription,
  type NormalizedCollector,
  type ResolvedFeed,
  type SourceConfig,
  type StreamingTransformer,
} from "#/index";
import { validateUdataFeedConfig } from "./config";
import { chooseTransformer } from "./transform";
import { UdataSource, type DistributionSelector } from "./udata";

export const UDATA_FEEDS = {
  distribution: {
    kind: "distribution",
    title: "Tabular uData distribution",
    description: "One CSV or JSON distribution from a uData dataset, by id or the newest in its format.",
    semantics: {
      domainSubject: "reference",
      defaultProductRole: "reference",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

/** What a Worker hands this library: the feed's configuration, its allowlist, and the fetch it may use. */
export interface UdataCollectorOptions {
  config: SourceConfig;
  /** The hosts its publishers' feeds name, comma-separated: the only ones it may fetch. */
  hosts: string;
  /** Translators the publishers bring, by the name a feed's `transformer` configures. */
  transformers: ReadonlyMap<string, StreamingTransformer>;
  fetcher: typeof fetch;
}

/** Presentation settings rename a product without changing which source it reads. */
const PRESENTATION_KEYS = new Set(["productSlug", "productTitle", "productDescription"]);

export function resolveUdataFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, {
    library: "udata",
    kinds: UDATA_FEEDS,
    validate: (value) => {
      const validated = validateUdataFeedConfig(value, hosts);
      if ((validated.feed ?? "distribution") !== "distribution") {
        throw new Error("uData document, media, and coverage feeds are disabled because source bytes are not retained");
      }
      return validated;
    },
    resourceConfig: (canonical) => Object.fromEntries(Object.entries(canonical).filter(([key]) => !PRESENTATION_KEYS.has(key))),
  });
}

/**
 * One collection: a conditional download of the configured distribution,
 * translated row by row while the kernel reads the frame stream.
 */
export function udataCollector(options: UdataCollectorOptions): NormalizedCollector {
  const hosts = allowedHosts(options.hosts);
  const selected = chooseTransformer(options.config, options.transformers);
  return {
    normalizer: { id: selected.id, version: selected.version },
    resolve: (value) => resolveUdataFeed(value, hosts),
    source: async (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("uData distribution history is not supported");
      const upstream = new UdataSource(hosts, (input, init) => options.fetcher(input, { ...init, signal }));
      const validated = validateUdataFeedConfig(options.config, hosts);
      const selector: DistributionSelector = validated.distributionId
        ? { kind: "id", id: validated.distributionId }
        : { kind: "format", format: requireString(validated, "format") };
      return upstream.fetchDistribution(validated, selector, state);
    },
    normalize: { kind: "streaming", transform: (body, context) => selected.transform(body, context) },
  };
}
