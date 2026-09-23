import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { OGC_FEEDS, validateOgcFeedConfig } from "./ogc";
import { OgcTransformer } from "./transform";

/** What an OGC API Features feed's functions are handed when they run: the hosts its publishers' feeds name, the only ones it may fetch. */
export interface OgcContext {
  hosts: ReadonlySet<string>;
}

/** The streaming translator from a collection's pages into one table of features; every OGC feed uses it. */
export const OGC_TRANSFORMER = new OgcTransformer();

/** The normalizer an OGC feed's collection is stamped with: the translator's name and version. */
export const OGC_NORMALIZER = { id: OGC_TRANSFORMER.id, version: OGC_TRANSFORMER.version };

export function resolveOgcFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, {
    library: "ogc",
    kinds: OGC_FEEDS,
    validate: (value) => validateOgcFeedConfig(value, hosts),
    // Page size and page cap change how much of a collection is read, not which
    // collection it is; two feeds that differ only there are the same resource.
    resourceConfig: (value) => {
      const identity: SourceConfig = { host: value.host ?? "", collection: value.collection ?? "", geometry: value.geometry ?? "include" };
      if (value.basePath) identity.basePath = value.basePath;
      if (value.properties) identity.properties = value.properties;
      // A feed cut by an attribute reads a different set of features, so it is a
      // different resource: one municipality's parcels are not the country's.
      if (value.filterField) identity.filterField = value.filterField;
      if (value.filterValue) identity.filterValue = value.filterValue;
      return identity;
    },
  });
}
