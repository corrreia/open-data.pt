/** Banco de Portugal's BPstat series, read once for every feed that needs them. */
export { BPSTAT_FEEDS, BPSTAT_MAX_BYTES, collectBpstatDataset, validateBpstatFeedConfig } from "./bpstat";
export { BPSTAT_NORMALIZER, resolveBpstatFeed, type BpstatContext } from "./collector";
export { normalizeReferenceDate, transformBpstatDataset } from "./transform";
export { BPSTAT_DEPLOYMENT } from "./deployment";
