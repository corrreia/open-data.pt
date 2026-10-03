import type { PublisherDefinition } from "#/catalog/define";
import { FEED as bundleSubscriberShares } from "./feeds/bundle-subscriber-shares";
import { FEED as bundleSubscribers } from "./feeds/bundle-subscribers";
import { FEED as fixedBroadbandAccesses } from "./feeds/fixed-broadband-accesses";
import { FEED as fixedBroadbandShares } from "./feeds/fixed-broadband-shares";
import { FEED as fixedTelephoneAccesses } from "./feeds/fixed-telephone-accesses";
import { FEED as fixedTelephoneShares } from "./feeds/fixed-telephone-shares";
import { FEED as mailBoxes } from "./feeds/mail-boxes";
import { FEED as mobileAccessShares } from "./feeds/mobile-access-shares";
import { FEED as mobileAccesses } from "./feeds/mobile-accesses";
import { FEED as mobileDataTraffic } from "./feeds/mobile-data-traffic";
import { FEED as mobileDataTrafficShares } from "./feeds/mobile-data-traffic-shares";
import { FEED as payTvAccesses } from "./feeds/pay-tv-accesses";
import { FEED as payTvShares } from "./feeds/pay-tv-shares";
import { FEED as postOffices } from "./feeds/post-offices";
import { FEED as postalAgencies } from "./feeds/postal-agencies";
import { FEED as retailRevenueShares } from "./feeds/retail-revenue-shares";
import { FEED as retailRevenues } from "./feeds/retail-revenues";

export const PUBLISHER: PublisherDefinition = {
  name: "ANACOM · Autoridade Nacional de Comunicações",
  url: "https://www.anacom.pt/",
  sources: [
    // STAT.ANACOM: two requests a feed, fourteen feeds that may all come due together. A few seconds apart, that
    // burst is a minute or so of requests to a Power Pages site rather than a spike.
    { host: "stat.anacom.pt", minIntervalSeconds: 3 },
    // GEO.ANACOM's ArcGIS Server: the mail boxes alone are eleven pages.
    { host: "geo.anacom.pt", minIntervalSeconds: 1 },
  ],
  feeds: [
    bundleSubscriberShares,
    bundleSubscribers,
    fixedBroadbandAccesses,
    fixedBroadbandShares,
    fixedTelephoneAccesses,
    fixedTelephoneShares,
    mobileAccessShares,
    mobileAccesses,
    mobileDataTraffic,
    mobileDataTrafficShares,
    payTvAccesses,
    payTvShares,
    retailRevenueShares,
    retailRevenues,
    postOffices,
    postalAgencies,
    mailBoxes,
  ],
};
