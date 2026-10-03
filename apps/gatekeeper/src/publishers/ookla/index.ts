import type { PublisherDefinition } from "#/catalog/define";
import { FEED as fixedBroadbandPerformance } from "./feeds/fixed-broadband-performance";
import { FEED as mobileNetworkPerformance } from "./feeds/mobile-network-performance";

export const PUBLISHER: PublisherDefinition = {
  name: "Ookla",
  url: "https://www.ookla.com/",
  // Their public bucket on S3, read anonymously by byte range; no logo, as their trademarks need their written permission.
  sources: ["ookla-open-data.s3.amazonaws.com"],
  feeds: [fixedBroadbandPerformance, mobileNetworkPerformance],
};
