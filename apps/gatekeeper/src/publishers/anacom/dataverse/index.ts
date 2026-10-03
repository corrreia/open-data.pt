/** STAT.ANACOM's indicator files, read once for every ANACOM statistics feed. */
export {
  DATAVERSE_API_ORIGIN,
  DATAVERSE_FEEDS,
  DATAVERSE_MAX_BYTES,
  STAT_OPEN_DATA_PAGE,
  collectIndicator,
  indexUrl,
  validateDataverseFeedConfig,
  type IndicatorConfig,
} from "./dataverse";
export { DATAVERSE_NORMALIZER, periodStart, transformIndicator } from "./transform";
export { resolveDataverseFeed, type DataverseContext } from "./collector";
export { DATAVERSE_DEPLOYMENT } from "./deployment";
