import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { IPMA_FEEDS, validateIpmaFeedConfig } from "./ipma";
import { IpmaTransformer } from "./transform";
import { IpmaDatasetTransformer } from "./datasets";
import { IpmaFireTransformer } from "./fires";

/** What an IPMA feed's functions are handed when they run: the origin its API answers on, and its dataservices site's. */
export interface IpmaContext {
  apiOrigin: string;
  mf2Origin: string;
}

/** The translator from IPMA's JSON endpoints into products; every feed but the published files uses it. */
export const IPMA_TRANSFORMER = new IpmaTransformer();

/** The normalizer those feeds' collections are stamped with: the translator's name and version. */
export const IPMA_NORMALIZER = { id: IPMA_TRANSFORMER.id, version: IPMA_TRANSFORMER.version };

/** The streaming translator from IPMA's published files (municipal climate CSVs, the shellfish bulletin) into products. */
export const IPMA_DATASET_TRANSFORMER = new IpmaDatasetTransformer();

/** The normalizer the published files' collections are stamped with. */
export const IPMA_DATASET_NORMALIZER = { id: IPMA_DATASET_TRANSFORMER.id, version: IPMA_DATASET_TRANSFORMER.version };

export function resolveIpmaFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "ipma", kinds: IPMA_FEEDS, validate: validateIpmaFeedConfig });
}

/** The translator from Meteosat's fire lists into detections and activity over Portugal. */
export const IPMA_FIRE_TRANSFORMER = new IpmaFireTransformer();

/** The normalizer the fire detections' collections are stamped with. */
export const IPMA_FIRE_NORMALIZER = { id: IPMA_FIRE_TRANSFORMER.id, version: IPMA_FIRE_TRANSFORMER.version };
