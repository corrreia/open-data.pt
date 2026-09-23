import { GatekeeperError } from "@open-data-pt/contract";

/**
 * How open-data.pt names itself to every server it reads, so a publisher can
 * tell us from a scraper and write to us instead of blocking us
 * (RFC 9110, section 10.1.5).
 */
export const USER_AGENT = "open-data.pt/1.0 (+https://open-data.pt)";

/** Redirects one request may follow before it is refused: enough for a portal's download link, not for a loop. */
const MAX_REDIRECTS = 5;

/** One server a publisher's data is read from, and anything they asked every request to it to carry. */
export interface PublisherSource {
  host: string;
  /** Query parameters the publisher asked for, such as RIPEstat's `sourceapp`. */
  query?: { readonly [name: string]: string };
}

/**
 * The servers we contact on a publisher's behalf: their data hosts, which are
 * often not their website. A host alone, or a host with what they asked of us.
 */
export type PublisherSources = readonly (string | PublisherSource)[];

/** Every host a publisher's sources name. */
export function sourceHosts(sources: PublisherSources): string[] {
  return sources.map((source) => (source instanceof Object ? source.host : source));
}

/**
 * The fetch a publisher's feeds are handed. It reaches only the hosts the
 * publisher declares — a redirect elsewhere is refused, not followed — names
 * open-data.pt in every request, and adds what the publisher asked every
 * request to carry. A caller that asks for `redirect: "manual"` handles the
 * redirect itself, and its next request comes back through here.
 */
export function publisherClient(sources: PublisherSources, fetcher: typeof fetch): typeof fetch {
  const allowed = new Map(sources.map((source) => (source instanceof Object ? [source.host, source.query ?? {}] : [source, {}])));
  const prepare = (target: URL): URL => {
    const query = allowed.get(target.hostname);
    if (!query) throw new GatekeeperError(`${target.hostname} is not one of this publisher's sources`, "source-denied");
    const url = new URL(target);
    for (const [name, value] of Object.entries(query)) if (!url.searchParams.has(name)) url.searchParams.set(name, value);
    return url;
  };
  return async (input, init) => {
    let url = prepare(new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input));
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("User-Agent", USER_AGENT);
    if (init?.redirect === "manual") return fetcher(url, { ...init, headers });
    let request: RequestInit = { ...init, headers, redirect: "manual" };
    for (let redirects = 0; ; redirects += 1) {
      const response = await fetcher(url, request);
      const location = response.status >= 300 && response.status < 400 ? response.headers.get("Location") : null;
      if (!location) return response;
      if (redirects === MAX_REDIRECTS) throw new GatekeeperError(`More than ${MAX_REDIRECTS} redirects from ${url.hostname}`, "upstream-error");
      url = prepare(new URL(location, url));
      // As a browser does: a 303, or a 301/302 answering anything but a GET, is followed with a GET and no body.
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && (request.method ?? "GET").toUpperCase() !== "GET")) {
        const { body: _body, ...rest } = request;
        request = { ...rest, method: "GET" };
      }
    }
  };
}
