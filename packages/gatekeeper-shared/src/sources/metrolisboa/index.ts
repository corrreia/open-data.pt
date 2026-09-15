/** Metro Lisboa's EstadoServicoML gateway, read once for every Worker that needs it. */
export { metrolisboaCollector, resolveMetrolisboaFeed, type MetrolisboaCollectorOptions } from "./collector";
export { METRO_LISBOA_EXAMPLES } from "./examples";
export {
  METRO_API_PATH, METRO_DAY_TYPES, METRO_FEEDS, METRO_LINES, METRO_MAX_BYTES, METRO_TOKEN_URL,
  collectMetroFeed, metroApiOrigin, validateMetroFeedConfig,
  type MetroCredentials, type MetroDayType, type MetroDocument, type MetroFeedName, type MetroLine,
} from "./metrolisboa";
export { MetroLisboaTransformer, bracketList, intervalSeconds, metroTimestamp } from "./transform";
