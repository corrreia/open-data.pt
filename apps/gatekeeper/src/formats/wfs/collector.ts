import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { WFS_FEEDS, validateWfsFeedConfig } from "./wfs";
import { WfsTransformer } from "./transform";

/** What a WFS feed's functions are handed when they run: the hosts its publishers' feeds name, the only ones it may fetch. */
export interface WfsContext {
  hosts: ReadonlySet<string>;
}

/** The translator from a feature collection into records or events; every WFS feed uses it. */
export const WFS_TRANSFORMER = new WfsTransformer();

/** The normalizer a WFS feed's collection is stamped with: the translator's name and version. */
export const WFS_NORMALIZER = { id: WFS_TRANSFORMER.id, version: WFS_TRANSFORMER.version };

export function resolveWfsFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "wfs", kinds: WFS_FEEDS, validate: (value) => validateWfsFeedConfig(value, hosts) });
}
