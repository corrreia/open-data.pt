import type { SourceConfig } from "../../index";
import { chooseTransformer } from "./transform";
import { validateUdataSourceConfig } from "./udata";

export function validateUdataFeedConfig(config: SourceConfig, hosts: ReadonlySet<string>): SourceConfig {
  const base = validateUdataSourceConfig(config, hosts);
  const distributionId = config.distributionId?.trim();
  const format = config.format?.trim().toLowerCase();
  const productSlug = config.productSlug?.trim();
  // Without a distributionId the feed reads the dataset's newest distribution in its format,
  // which is what a publisher that uploads every release as a new resource needs.
  if (distributionId && !/^[A-Za-z0-9_-]{1,200}$/.test(distributionId)) {
    throw new Error("uData distributionId has an invalid format");
  }
  if (!format) throw new Error("uData feed requires format");
  if (!productSlug) throw new Error("uData feed requires productSlug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(productSlug)) {
    throw new Error("uData productSlug must be a lowercase URL slug");
  }
  if (config.headerRow && !/^[1-9]\d*$/.test(config.headerRow)) {
    throw new Error("uData headerRow must be a positive row number");
  }
  const feed = config.feed ?? "distribution";
  if (!["coverage", "distribution", "document", "media"].includes(feed)) {
    throw new Error("Unsupported uData feed kind");
  }
  const validated: SourceConfig = {
    ...base,
    format,
    productSlug,
    feed,
  };
  if (distributionId) validated.distributionId = distributionId;
  const optionalSettings = ["productTitle", "productDescription", "keyField", "eventTimeField", "headerRow", "transformer"] as const;
  for (const setting of optionalSettings) {
    const value = config[setting];
    if (value) validated[setting] = value;
  }
  chooseTransformer(validated);
  return validated;
}
