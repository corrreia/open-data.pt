import { requireString, resolveFeed, type FeedKindDescription, type JsonObject, type ResolvedFeed, type SourceConfig, type SourceFetch } from "#/index";
import { validateUdataFeedConfig } from "./config";
import { TABULAR } from "./transform";
import { UdataSource, type DistributionSelector, type Fetcher } from "./udata";

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

/** What a uData feed's functions are handed when they run: the hosts its publishers' feeds name, the only ones it may fetch. */
export interface UdataContext {
  hosts: ReadonlySet<string>;
}

/** The generic translator from any CSV or JSON table into records; every uData feed that names `tabular` uses it. */
export const UDATA_TRANSFORMER = TABULAR;

/** The normalizer a tabular uData feed's collection is stamped with: the translator's name and version. */
export const UDATA_NORMALIZER = { id: UDATA_TRANSFORMER.id, version: UDATA_TRANSFORMER.version };

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

/** A conditional download of the configured distribution, by its id or the newest in its format, handed on as a stream. */
export function collectUdataFeed(config: SourceConfig, state: JsonObject | undefined, hosts: ReadonlySet<string>, fetcher: Fetcher): Promise<SourceFetch> {
  const upstream = new UdataSource(hosts, fetcher);
  const validated = validateUdataFeedConfig(config, hosts);
  const selector: DistributionSelector = validated.distributionId ? { kind: "id", id: validated.distributionId } : { kind: "format", format: requireString(validated, "format") };
  return upstream.fetchDistribution(validated, selector, state);
}
