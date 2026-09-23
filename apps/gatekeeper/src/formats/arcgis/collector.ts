import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { ARCGIS_FEEDS, validateArcgisFeedConfig } from "./arcgis";
import { ArcgisTransformer } from "./transform";

/** What an ArcGIS feed's functions are handed when they run: the hosts its publishers' feeds name, the only ones it may fetch. */
export interface ArcgisContext {
  hosts: ReadonlySet<string>;
}

/** The translator from a layer's GeoJSON pages into one record per feature; every ArcGIS feed uses it. */
export const ARCGIS_TRANSFORMER = new ArcgisTransformer();

/** The normalizer an ArcGIS feed's collection is stamped with: the translator's name and version. */
export const ARCGIS_NORMALIZER = { id: ARCGIS_TRANSFORMER.id, version: ARCGIS_TRANSFORMER.version };

export function resolveArcgisFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "arcgis", kinds: ARCGIS_FEEDS, validate: (value) => validateArcgisFeedConfig(value, hosts) });
}
