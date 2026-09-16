import type { ExampleFeed } from "../../index";
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
    licence: "Source terms apply",
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
    publisher: "Carris Metropolitana",
    topics: ["mobility"],
  },
  {
    slug: "stcp-gtfs-feed",
    title: "STCP GTFS",
    description: "Stops, routes, agencies, and service calendars from STCP's 7 September 2026 schedule archive.",
    config: {
      source: "gtfs",
      url: "https://opendata.porto.digital/dataset/5275c986-592c-43f5-8f87-aabbd4e4f3a4/resource/2bfd5b9e-5f09-49df-af33-3df622b2f3c9/download/gtfs_feed.zip",
    },
    policy: DAILY_STATIC,
    staleAfterSeconds: 259_200,
    publisher: "STCP",
    topics: ["mobility"],
  },
  {
    slug: "metro-do-porto-gtfs-feed",
    title: "Metro do Porto GTFS",
    description: "Stops, routes, agencies, service calendars, and route shapes from the latest non-empty Metro do Porto archive.",
    config: {
      source: "gtfs",
      url: "https://opendata.porto.digital/dataset/15f22603-a216-492a-ab1c-40b1d8aa2f08/resource/5e2b445d-b85b-4afb-9116-90b24327151c/download/___",
      files: "agency,stops,routes,calendar,calendar_dates,shapes,feed_info",
    },
    policy: DAILY_STATIC,
    staleAfterSeconds: 259_200,
    publisher: "Metro do Porto",
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
    publisher: "Metropolitano de Lisboa",
    topics: ["mobility"],
  },
  staticExample("cp", "CP", "https://publico.cp.pt/gtfs/gtfs.zip", "agency,stops,routes,calendar,calendar_dates"),
  staticExample("fertagus", "Fertagus", "https://www.fertagus.pt/GTFSTMLzip/Fertagus_GTFS.zip", "agency,stops,routes,calendar,calendar_dates,shapes"),
  staticExample("tub-braga", "TUB Braga", "https://www.tub.pt/developer/gtfs/feed/tub.zip", "agency,stops,routes,calendar,calendar_dates,shapes"),
  staticExample("tcb-barreiro", "Transportes Colectivos do Barreiro", "https://backend.tcbarreiro.pt/download-gtfs", "agency,stops,routes,calendar,calendar_dates,shapes"),
  // HF publishes service days only in calendar_dates.txt, not calendar.txt.
  staticExample("horarios-do-funchal", "Horários do Funchal", "https://www.horariosdofunchal.pt/googletransit.zip", "agency,stops,routes,calendar_dates,shapes"),
  // SMTUC (Coimbra) withdrew its GTFS archive from dados.gov.pt in September 2026 and now publishes NeTEx only;
  // a NeTEx library would bring Coimbra back.
];

/** Selected static reference tables, not live vehicle positions or train delays. */
function staticExample(slug: string, publisher: string, url: string, files: string): ExampleFeed {
  return {
    slug: `${slug}-gtfs-feed`,
    title: `${publisher} GTFS`,
    description: `Stops, routes, agencies and service days${files.includes("shapes") ? ", with route shapes," : ""} from ${publisher}'s current static schedule archive. Not live service or delay information.`,
    config: { source: "gtfs", url, files },
    policy: DAILY_STATIC,
    staleAfterSeconds: 259_200,
    publisher,
    topics: ["mobility"],
  };
}
