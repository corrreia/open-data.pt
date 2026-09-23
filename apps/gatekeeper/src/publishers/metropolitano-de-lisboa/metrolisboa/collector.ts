import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { METRO_FEEDS, validateMetroFeedConfig, type MetroCredentials } from "./metrolisboa";
import { MetroLisboaTransformer } from "./transform";

/** What a Metro Lisboa feed's functions are handed when they run: the gateway's origin and the API store application's credentials. */
export interface MetrolisboaContext {
  /** `METROLISBOA_API_ORIGIN`. */
  apiOrigin: string;
  /** The Worker's `ML_CONSUMER_KEY` and `ML_CONSUMER_SECRET` secrets. */
  credentials: MetroCredentials;
}

/** The translator from the gateway's answers, as one collection document, into products; every Metro Lisboa feed uses it. */
export const METROLISBOA_TRANSFORMER = new MetroLisboaTransformer();

/** The normalizer a Metro Lisboa feed's collection is stamped with: the translator's name and version. */
export const METROLISBOA_NORMALIZER = { id: METROLISBOA_TRANSFORMER.id, version: METROLISBOA_TRANSFORMER.version };

export function resolveMetrolisboaFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "metrolisboa", kinds: METRO_FEEDS, validate: validateMetroFeedConfig });
}
