/** Metro Lisboa's EstadoServicoML gateway, read once for every feed that needs it. */
export { METROLISBOA_NORMALIZER, METROLISBOA_TRANSFORMER, resolveMetrolisboaFeed, type MetrolisboaContext } from "./collector";
export {
  METRO_API_PATH,
  METRO_DAY_TYPES,
  METRO_FEEDS,
  METRO_LINES,
  METRO_MAX_BYTES,
  METRO_TOKEN_URL,
  collectMetroFeed,
  metroApiOrigin,
  validateMetroFeedConfig,
  type MetroCredentials,
  type MetroDayType,
  type MetroDocument,
  type MetroFeedName,
  type MetroLine,
} from "./metrolisboa";
export { MetroLisboaTransformer, bracketList, intervalSeconds, metroTimestamp } from "./transform";
export { METROLISBOA_DEPLOYMENT } from "./deployment";
