/**
 * The site's pages: one HTML shell serves them all, so each page's title and description live here,
 * where the kernel writes them into the shell it serves and the site sets them as it opens a page in place.
 */
export interface SitePage {
  path: string;
  /** The document title: the page's own name, then the site's. */
  title: string;
  description: string;
}

export const SITE_PAGES: readonly SitePage[] = [
  {
    path: "/",
    title: "open-data.pt",
    description: "Portuguese public data from the institutions that publish it, collected in one place and served through a free, keyless API.",
  },
  {
    path: "/catalog/",
    title: "Catalog · open-data.pt",
    description: "Every dataset open-data.pt collects, filterable by topic, publisher, kind of data, update frequency and format.",
  },
  {
    path: "/publisher/",
    title: "Publishers · open-data.pt",
    description: "The institutions and operators whose public data open-data.pt collects, and what each of them publishes.",
  },
  {
    path: "/licence/",
    title: "Licences · open-data.pt",
    description: "The terms each dataset on open-data.pt is served under, as its publisher states them, and every dataset under each.",
  },
  {
    path: "/product/",
    title: "Dataset · open-data.pt",
    description: "One dataset table on open-data.pt: its records, map or chart, schema, history and where it comes from.",
  },
  {
    path: "/start/",
    title: "Start here · open-data.pt",
    description: "How to use open-data.pt: a free, keyless JSON API over Portuguese public data.",
  },
  {
    path: "/status/",
    title: "Status · open-data.pt",
    description: "Hourly collection history for open-data.pt datasets over the last 3 days.",
  },
  {
    path: "/analytics/",
    title: "Analytics · open-data.pt",
    description: "How open-data.pt is used: requests to the website, the API and the MCP server, by client, dataset and country. No cookies, no IP addresses.",
  },
  {
    path: "/operations/",
    title: "Operations · open-data.pt",
    description: "Every feed, every run, the rules they follow and the resources open-data.pt consumes.",
  },
  {
    path: "/contribute/",
    title: "Contribute · open-data.pt",
    description: "How to help open-data.pt: suggest a source, add a dataset, or report one that is broken. The code is open source.",
  },
  {
    path: "/aup/",
    title: "Acceptable use · open-data.pt",
    description: "What you may do with the data open-data.pt republishes, what we ask of API users, and how a publisher reaches us to correct a licence or ask for removal.",
  },
];

/** "/catalog/index.html" is the same page as "/catalog/". */
export const pagePath = (pathname: string) => pathname.replace(/index\.html$/, "");

/** The page at a path, or undefined for a path that is not one of the site's pages. */
export const sitePageAt = (pathname: string): SitePage | undefined => SITE_PAGES.find((page) => page.path === pagePath(pathname));
