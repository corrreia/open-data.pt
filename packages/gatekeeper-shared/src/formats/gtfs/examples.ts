import { PUBLISHERS, type ExampleFeed, type Publisher } from "../../index";
import { MAX_ARCHIVE_BYTES } from "./zip";

const DAILY_STATIC = {
  name: "Daily GTFS static snapshot",
  version: 1,
  collection: {
    cadenceSeconds: 86_400,
    // Large schedule archives can exceed five minutes including normalization
    // and storage on a cold Worker; keep the deadline explicit and bounded.
    timeoutSeconds: 600,
    // The archive streams entry by entry and is never buffered, so the source
    // budget is the whole compressed archive, stop_times.txt included.
    maxBytes: MAX_ARCHIVE_BYTES,
    maxOutputBytes: 48 * 1024 * 1024,
    historyMode: "changes",
  },
  serving: {
    licence: "source-terms",
    attribution: "Published by the named transit operator",
  },
} as const;

export const GTFS_EXAMPLES: ExampleFeed[] = [
  {
    slug: "carris-metropolitana-gtfs-feed",
    title: "Carris Metropolitana GTFS",
    description: "Stops, routes, agencies, and calendar exceptions from the current static schedule archive.",
    // Carris publishes service days only as calendar_dates.txt; asking for
    // calendar.txt would declare a product the archive never fills.
    config: {
      source: "gtfs",
      url: "https://api.carrismetropolitana.pt/v2/gtfs",
      files: "agency,stops,routes,calendar_dates,feed_info",
    },
    policy: DAILY_STATIC,
    staleAfterSeconds: 259_200,
    publisher: "carris-metropolitana",
    topics: ["mobility"],
  },
  {
    slug: "stcp-gtfs-feed",
    title: "STCP GTFS",
    description: "Stops, routes, agencies, and service calendars from STCP's 1 September 2026 schedule archive.",
    // Porto's portal moved to dadosabertos.cm-porto.pt in September 2026 and every
    // dataset and resource ID changed with it; this is the newest STCP archive there.
    config: {
      source: "gtfs",
      url: "https://dadosabertos.cm-porto.pt/dataset/71490e40-9e19-11f1-84ed-6abdb6d5cf34/resource/51340c18-0ef5-4895-b099-cf7247ea54f4/download/gtfs_feed.zip",
    },
    policy: DAILY_STATIC,
    staleAfterSeconds: 259_200,
    publisher: "stcp",
    topics: ["mobility"],
  },
  {
    slug: "metro-do-porto-gtfs-feed",
    title: "Metro do Porto GTFS",
    description: "Stops, routes, agencies, service calendars, and route shapes from Metro do Porto's own schedule archive.",
    // Read from Metro do Porto rather than from Porto's open-data portal: their two newest
    // uploads there are zero bytes, as they were on the old portal, leaving the portal's
    // newest readable archive the one from 7 April 2026. The file linked from
    // https://www.metrodoporto.pt/pages/337 is the September 2026 schedule.
    // The name carries its release date, so a new schedule needs this address changed;
    // the feed goes stale within three days if that is missed. The archive carries no
    // feed_info.txt, which the old configuration asked for and never received.
    config: {
      source: "gtfs",
      url: "https://www.metrodoporto.pt/metrodoporto/uploads/document/file/794/google_transit_04_09_2026.zip",
      files: "agency,stops,routes,calendar,calendar_dates,shapes",
    },
    policy: DAILY_STATIC,
    staleAfterSeconds: 259_200,
    publisher: "metro-do-porto",
    topics: ["mobility"],
  },
  {
    slug: "metro-lisboa-gtfs-feed",
    title: "Metropolitano de Lisboa GTFS",
    description: "Stations, lines, agencies, service calendars, and line shapes from Metropolitano de Lisboa's schedule archive.",
    // dados.gov.pt serves the latest upload of a resource at this address,
    // so a new archive replaces the old one without a config change.
    config: {
      source: "gtfs",
      url: "https://dados.gov.pt/api/1/datasets/r/e7e8ef72-9cee-43a0-b141-656ced144394",
      files: "agency,stops,routes,calendar,calendar_dates,shapes,feed_info",
    },
    policy: DAILY_STATIC,
    staleAfterSeconds: 259_200,
    publisher: "metropolitano-de-lisboa",
    topics: ["mobility"],
  },
  staticExample("cp", "cp", "https://publico.cp.pt/gtfs/gtfs.zip", "agency,stops,routes,calendar,calendar_dates"),
  staticExample("fertagus", "fertagus", "https://www.fertagus.pt/GTFSTMLzip/Fertagus_GTFS.zip", "agency,stops,routes,calendar,calendar_dates,shapes"),
  staticExample("tub-braga", "tub-braga", "https://www.tub.pt/developer/gtfs/feed/tub.zip", "agency,stops,routes,calendar,calendar_dates,shapes"),
  staticExample("tcb-barreiro", "tcb", "https://backend.tcbarreiro.pt/download-gtfs", "agency,stops,routes,calendar,calendar_dates,shapes"),
  // HF publishes service days only in calendar_dates.txt, not calendar.txt.
  staticExample("horarios-do-funchal", "horarios-do-funchal", "https://www.horariosdofunchal.pt/googletransit.zip", "agency,stops,routes,calendar_dates,shapes"),
  // SMTUC (Coimbra) withdrew its GTFS archive from dados.gov.pt in September 2026 and now publishes NeTEx only;
  // a NeTEx library would bring Coimbra back.
];

/** Selected static reference tables, not live vehicle positions or train delays. */
function staticExample(slug: string, publisher: Publisher, url: string, files: string): ExampleFeed {
  const operator = PUBLISHERS[publisher].name;
  return {
    slug: `${slug}-gtfs-feed`,
    title: `${operator} GTFS`,
    description: `Stops, routes, agencies and service days${files.includes("shapes") ? ", with route shapes," : ""} from ${operator}'s current static schedule archive. Not live service or delay information.`,
    config: { source: "gtfs", url, files },
    policy: DAILY_STATIC,
    staleAfterSeconds: 259_200,
    publisher,
    topics: ["mobility"],
  };
}
