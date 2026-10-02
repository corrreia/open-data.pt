/** EUMETSAT's Data Store: Meteosat Third Generation's active fires. */
export { ACTIVE_FIRES_NORMALIZER, ACTIVE_FIRES_TRANSFORMER, resolveDataStoreFeed, type DataStoreContext } from "./collector";
export {
  ACTIVE_FIRES_COLLECTION,
  ACTIVE_FIRES_MAX_BYTES,
  DATASTORE_API_ORIGIN,
  DATASTORE_FEEDS,
  collectActiveFires,
  validateDataStoreFeedConfig,
  type DataStoreCredentials,
} from "./datastore";
export { readCapFires, type CapFires } from "./cap";
export { ActiveFiresTransformer } from "./transform";
export { DATASTORE_DEPLOYMENT } from "./deployment";
