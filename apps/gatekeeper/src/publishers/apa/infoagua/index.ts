export { INFOAGUA_DEPLOYMENT } from "./deployment";
export {
  INFOAGUA_FEEDS,
  INFOAGUA_MAX_BYTES,
  INFOAGUA_ORIGIN,
  INFOAGUA_READINGS,
  assignedJson,
  collectInfoaguaFeed,
  infoaguaPageUrl,
  isInfoaguaReading,
  readInfoaguaReadings,
  validateInfoaguaFeedConfig,
  type InfoaguaDocument,
  type InfoaguaReadingName,
  type InfoaguaReadings,
  type InfoaguaStationReadings,
} from "./infoagua";
export { INFOAGUA_NORMALIZER, INFOAGUA_TRANSFORMER, resolveInfoaguaFeed, type InfoaguaContext } from "./collector";
export { InfoaguaTransformer } from "./transform";
