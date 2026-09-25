import { GatekeeperError } from "@open-data-pt/contract";

/**
 * How open-data.pt names itself to every server it reads, so a publisher can
 * tell us from a scraper and write to us instead of blocking us
 * (RFC 9110, section 10.1.5).
 */
export const USER_AGENT = "open-data.pt/1.0 (+https://open-data.pt)";

/** Redirects one request may follow before it is refused: enough for a portal's download link, not for a loop. */
const MAX_REDIRECTS = 5;

/**
 * Attempts of one request whose origin never answered, the first included.
 * Some publishers' own servers (SNIRH, Águeda's CKAN) refuse a share of the
 * connections Cloudflare opens to them, and the edge reports that as a 522
 * after about nineteen seconds.
 */
const ATTEMPTS = 3;

/** Pause before the second attempt; the third waits twice as long. Each adds as much again in jitter, so retries from many feeds do not arrive together. */
const RETRY_BASE_MS = 250;

/** Cloudflare edge statuses that mean the origin never answered: nothing was read, so the request can be made again. */
const ORIGIN_UNREACHABLE = new Set([522, 523, 524]);

/** One server a publisher's data is read from, and how it asks to be read. */
export interface PublisherSource {
  host: string;
  /** Query parameters the publisher asked for, such as RIPEstat's `sourceapp`. */
  query?: { readonly [name: string]: string };
  /**
   * The least time between two requests to this host, from every feed this
   * Worker runs at once: for a server that answers slowly, or has asked us to
   * go gently.
   */
  minIntervalSeconds?: number;
  /** What to name ourselves to this host instead of `USER_AGENT`, with a comment saying why. */
  userAgent?: string;
}

/**
 * The servers we contact on a publisher's behalf: their data hosts, which are
 * often not their website. A host alone, or a host with what they asked of us.
 */
export type PublisherSources = readonly (string | PublisherSource)[];

/** How every request to one host is made. */
interface HostRules {
  query: { readonly [name: string]: string };
  intervalMs: number;
  userAgent: string;
}

/**
 * When the last request to each host was let go, shared by every client in
 * this isolate, so two feeds of one publisher running at once still keep to
 * its interval.
 */
const TURNS = new Map<string, Promise<number>>();

/** Waits until `intervalMs` has passed since the last request to `host` was let go, then takes the turn. */
async function takeTurn(host: string, intervalMs: number): Promise<void> {
  if (intervalMs <= 0) return;
  const turn = (TURNS.get(host) ?? Promise.resolve(0)).then(async (last) => {
    const wait = last + intervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    return Date.now();
  });
  TURNS.set(host, turn);
  await turn;
}

/**
 * An answer that refused or failed a request, for the logs: a feed's failure
 * names only its code, and the status, the server and whether a Cloudflare in
 * front of the source challenged us (`cf-mitigated`) say who refused and how.
 */
function logStatus(url: URL, response: Response): void {
  console.warn(
    JSON.stringify({
      event: "source_http_status",
      host: url.hostname,
      path: url.pathname,
      status: response.status,
      server: response.headers.get("server"),
      mitigated: response.headers.get("cf-mitigated"),
      contentType: response.headers.get("content-type"),
    }),
  );
}

/** Every host a publisher's sources name. */
export function sourceHosts(sources: PublisherSources): string[] {
  return sources.map((source) => (source instanceof Object ? source.host : source));
}

/**
 * The fetch a publisher's feeds are handed. It reaches only the hosts the
 * publisher declares — a redirect elsewhere is refused, not followed — names
 * open-data.pt in every request unless a host says otherwise, keeps to each
 * host's interval, adds what the publisher asked every request to carry, and
 * repeats a request whose origin never answered. A caller that asks for
 * `redirect: "manual"` handles the redirect itself, and its next request comes
 * back through here.
 */
export function publisherClient(sources: PublisherSources, fetcher: typeof fetch): typeof fetch {
  const allowed = new Map<string, HostRules>(
    sources.map((source) =>
      source instanceof Object
        ? [source.host, { query: source.query ?? {}, intervalMs: (source.minIntervalSeconds ?? 0) * 1000, userAgent: source.userAgent ?? USER_AGENT }]
        : [source, { query: {}, intervalMs: 0, userAgent: USER_AGENT }],
    ),
  );
  const rulesOf = (url: URL): HostRules => {
    const rules = allowed.get(url.hostname);
    if (!rules) throw new GatekeeperError(`${url.hostname} is not one of this publisher's sources`, "source-denied");
    return rules;
  };
  const prepare = (target: URL): URL => {
    const url = new URL(target);
    for (const [name, value] of Object.entries(rulesOf(url).query)) if (!url.searchParams.has(name)) url.searchParams.set(name, value);
    return url;
  };
  /**
   * One request to one host, on that host's terms: its interval, and the name
   * it knows us by. Made again while the origin never answers, when its body
   * can be sent twice; the last attempt's answer or error stands.
   */
  const send = async (url: URL, request: RequestInit): Promise<Response> => {
    const rules = rulesOf(url);
    const headers = new Headers(request.headers);
    headers.set("User-Agent", rules.userAgent);
    const attempts = request.body instanceof ReadableStream ? 1 : ATTEMPTS;
    for (let attempt = 1; ; attempt += 1) {
      await takeTurn(url.hostname, rules.intervalMs);
      const last = attempt === attempts || request.signal?.aborted === true;
      try {
        const response = await fetcher(url, { ...request, headers });
        // Every refusal, the ones repeated below included: how often an origin never answers is itself the finding.
        if (response.status >= 400) logStatus(url, response);
        if (last || !ORIGIN_UNREACHABLE.has(response.status)) return response;
        await response.body?.cancel().catch(() => undefined);
      } catch (error) {
        // A refused, reset or timed out connection: the origin was never reached.
        if (last || request.signal?.aborted === true) throw error;
      }
      const pause = RETRY_BASE_MS * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, pause + Math.random() * pause));
    }
  };
  return async (input, init) => {
    let url = prepare(new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input));
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (init?.redirect === "manual") return send(url, { ...init, headers });
    let request: RequestInit = { ...init, headers, redirect: "manual" };
    for (let redirects = 0; ; redirects += 1) {
      const response = await send(url, request);
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
