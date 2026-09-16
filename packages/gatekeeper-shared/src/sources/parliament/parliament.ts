import {
  GatekeeperError,
  invalidResponse,
  readBoundedResponse,
  responseValidator,
  retryAfterSeconds,
  sourceValidator,
  type FeedKindDescription,
  type JsonObject,
  type SourceBody,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
} from "../../index";
import { limitBytes } from "../../stream";

const PAGE_ORIGIN = "https://www.parlamento.pt";
const DOCUMENT_ORIGIN = "https://app.parlamento.pt";
const DOCUMENT_PATH = "/webutils/docs/doc.txt";
export const PARLIAMENT_HTML_BYTES = 1024 * 1024;

export const PARLIAMENT_FEEDS = {
  members: {
    kind: "members",
    title: "Parliamentary mandates and legislature reference",
    description: "Published mandates, including historical statuses within the selected legislature, constituencies, groups and sessions.",
    semantics: { domainSubject: "reference", defaultProductRole: "reference" },
  },
  careers: {
    kind: "careers",
    title: "Parliamentary professional profiles",
    description: "Professional qualifications and career information, excluding birth dates, sex and private contact details.",
    semantics: { domainSubject: "reference", defaultProductRole: "reference" },
  },
  petitions: {
    kind: "petitions",
    title: "Parliamentary petitions",
    description: "Petition subjects, processing status, signature counts, dates and official metadata.",
    semantics: { domainSubject: "event", defaultProductRole: "event-log" },
  },
  diplomas: {
    kind: "diplomas",
    title: "Approved parliamentary legislation",
    description: "Approved legislation metadata and its stated publication dates and official text links.",
    semantics: { domainSubject: "document", defaultProductRole: "event-log" },
  },
  activities: {
    kind: "activities",
    title: "Parliamentary activities",
    description: "Hearings, audiences, debates, visits and events in the selected legislature.",
    semantics: { domainSubject: "event", defaultProductRole: "event-log" },
  },
  committees: {
    kind: "committees",
    title: "Parliamentary committees",
    description: "Committee reference, published membership histories and meeting metadata.",
    semantics: { domainSubject: "reference", defaultProductRole: "reference" },
  },
} as const satisfies Record<string, FeedKindDescription>;

export type ParliamentFeed = keyof typeof PARLIAMENT_FEEDS;
interface DocumentDefinition {
  page: string;
  prefix: string;
  arrayPath: readonly string[];
  sourceBytes: number;
  envelopeBytes: number;
}

const MIB = 1024 * 1024;
const DOCUMENTS = {
  members: { page: "DAInformacaoBase", prefix: "InformacaoBase", arrayPath: ["Deputados"], sourceBytes: 2 * MIB, envelopeBytes: 256 * 1024 },
  careers: { page: "DARegistoBiografico", prefix: "RegistoBiografico", arrayPath: [], sourceBytes: 2 * MIB, envelopeBytes: 128 * 1024 },
  petitions: { page: "DAPeticoes", prefix: "Peticoes", arrayPath: [], sourceBytes: 2 * MIB, envelopeBytes: 128 * 1024 },
  diplomas: { page: "DADiplomasAprovados", prefix: "Diplomas", arrayPath: [], sourceBytes: 4 * MIB, envelopeBytes: 128 * 1024 },
  // The largest named activity array streams; the other sections together are
  // a measured 1.4 MB bounded envelope and become distinct products after it.
  activities: { page: "DAatividades", prefix: "Atividades", arrayPath: ["Audicoes"], sourceBytes: 4 * MIB, envelopeBytes: 2 * MIB },
  // This source also contains plenary material outside Comissoes (4.4 MB measured).
  committees: { page: "DAComposicaoOrgaos", prefix: "OrgaoComposicao", arrayPath: ["Comissoes"], sourceBytes: 8 * MIB, envelopeBytes: 6 * MIB },
} satisfies Record<ParliamentFeed, DocumentDefinition>;

export interface ParliamentDocument extends DocumentDefinition {
  feed: ParliamentFeed;
  legislature: string;
  filename: string;
  pageUrl: string;
}

export function validateParliamentFeedConfig(config: SourceConfig): SourceConfig {
  const feed = config.feed?.trim();
  if (!isParliamentFeed(feed)) throw new GatekeeperError("Parliament requires a supported feed", "invalid-config");
  const legislature = config.legislature?.trim().toUpperCase();
  if (!legislature || !["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII"].includes(legislature)) {
    throw new GatekeeperError("Parliament requires an explicit legislature from I to XVII", "invalid-config");
  }
  if (Object.keys(config).some((key) => key !== "feed" && key !== "legislature"))
    throw new GatekeeperError("Parliament does not accept source URLs or additional configuration", "invalid-config");
  return { feed, legislature };
}

function isParliamentFeed(value: string | undefined): value is ParliamentFeed {
  return Object.values(PARLIAMENT_FEEDS).some((feed) => feed.kind === value);
}

export function parliamentDocument(config: SourceConfig): ParliamentDocument {
  const validated = validateParliamentFeedConfig(config);
  if (!isParliamentFeed(validated.feed)) throw new GatekeeperError("Unsupported Parliament feed", "invalid-config");
  const document = DOCUMENTS[validated.feed];
  const legislature = validated.legislature ?? "";
  return {
    ...document,
    feed: validated.feed,
    legislature,
    filename: `${document.prefix}${legislature}_json.txt`,
    pageUrl: `${PAGE_ORIGIN}/Cidadania/Paginas/${document.page}.aspx`,
  };
}

/** Discover fresh encrypted links each time; the file/legislature, never its URL token, is the resource. */
export async function collectParliamentFeed(config: SourceConfig, state: JsonObject | undefined, fetcher: typeof fetch): Promise<SourceFetch> {
  const document = parliamentDocument(config);
  const page = await htmlPage(new URL(document.pageUrl), fetcher);
  const directory = parliamentDirectoryLink(page, document);
  const folder = await htmlPage(directory, fetcher);
  const url = parliamentDocumentLink(folder, document);
  const previous = state?.resource === document.filename ? sourceValidator(state) : undefined;
  const headers = new Headers({ Accept: "application/json, text/plain, application/octet-stream;q=0.9, */*;q=0.1", "User-Agent": "open-data.pt (+https://open-data.pt)" });
  if (previous?.etag) headers.set("If-None-Match", previous.etag);
  if (previous?.lastModified) headers.set("If-Modified-Since", previous.lastModified);
  const response = await request(url, headers, fetcher);
  if (response.status === 304) {
    if (!previous?.etag && !previous?.lastModified) throw invalidResponse("Parliament document returned an unsolicited 304");
    const validator = mergedValidator(response.headers, previous);
    return validator ? { kind: "not-modified", validator } : { kind: "not-modified" };
  }
  if (!response.ok) throw upstreamError(response);
  if (!response.body) throw invalidResponse("Parliament document has no body");
  const length = response.headers.get("content-length");
  if (length && Number(length) > document.sourceBytes) {
    await response.body.cancel("Parliament document exceeds its source limit");
    throw new GatekeeperError("Parliament document exceeds its source limit", "response-too-large");
  }
  const validator = responseValidator(response.headers);
  const nextState: JsonObject = { resource: document.filename };
  if (validator) nextState.validators = { default: { ...validator } };
  const fetched: SourceBody = {
    kind: "body",
    body: limitBytes(response.body, document.sourceBytes),
    completeness: "complete",
    state: nextState,
    // A durable public directory link is more useful than an expiring encrypted download address.
    provenance: { sourceUrl: document.pageUrl },
  };
  const published = Date.parse(response.headers.get("last-modified") ?? "");
  if (Number.isFinite(published)) fetched.provenance.sourcePublishedAt = new Date(published).toISOString();
  return fetched;
}

async function htmlPage(url: URL, fetcher: typeof fetch): Promise<string> {
  const response = await request(url, new Headers({ Accept: "text/html", "User-Agent": "open-data.pt (+https://open-data.pt)" }), fetcher);
  if (!response.ok) throw upstreamError(response);
  return new TextDecoder().decode(await readBoundedResponse(response, PARLIAMENT_HTML_BYTES, "Parliament public directory"));
}

async function request(url: URL, headers: Headers, fetcher: typeof fetch): Promise<Response> {
  if (![PAGE_ORIGIN, DOCUMENT_ORIGIN].includes(url.origin) || url.username || url.password || url.port)
    throw new GatekeeperError("Parliament source origin is not allowed", "source-denied");
  let response: Response;
  try {
    response = await fetcher(url, { headers, redirect: "manual" });
  } catch (error) {
    if (error instanceof TypeError) throw new GatekeeperError("Parliament source request failed", "upstream-error");
    throw error;
  }
  if (response.status >= 300 && response.status < 400 && response.status !== 304) {
    await response.body?.cancel("Parliament redirect refused");
    throw new GatekeeperError("Parliament source redirect was refused", "source-denied");
  }
  return response;
}

export function parliamentDirectoryLink(html: string, document: ParliamentDocument): URL {
  const url = titledLink(html, `Pasta ${document.legislature} Legislatura`, document.pageUrl);
  const expected = new URL(document.pageUrl);
  if (
    url.origin !== PAGE_ORIGIN ||
    url.pathname !== expected.pathname ||
    !exactParameters(url, ["t", "Path"]) ||
    !/^[a-f0-9]{1,256}$/i.test(url.searchParams.get("t") ?? "") ||
    !boundedToken(url.searchParams.get("Path"))
  ) {
    throw new GatekeeperError("Parliament directory link is outside the selected public page", "source-denied");
  }
  return url;
}

export function parliamentDocumentLink(html: string, document: ParliamentDocument): URL {
  const url = titledLink(html, document.filename, document.pageUrl);
  if (
    url.origin !== DOCUMENT_ORIGIN ||
    url.pathname !== DOCUMENT_PATH ||
    !exactParameters(url, ["path", "fich", "Inline"]) ||
    url.searchParams.get("fich") !== document.filename ||
    url.searchParams.get("Inline") !== "true" ||
    !boundedToken(url.searchParams.get("path"))
  ) {
    throw new GatekeeperError("Parliament download link does not identify the selected public file", "source-denied");
  }
  return url;
}

function boundedToken(value: string | null): boolean {
  // The directory publishes encrypted Base64 (or URL-safe Base64), not a filesystem path.
  return value !== null && value.length >= 16 && value.length <= 16_384 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(value);
}
function exactParameters(url: URL, names: readonly string[]): boolean {
  const keys = [...url.searchParams.keys()];
  return !url.hash && !url.username && !url.password && !url.port && keys.length === names.length && names.every((name) => url.searchParams.getAll(name).length === 1);
}

/** Only public anchors with the exact publisher-provided title; no forms, scripts or canonical HTTP URLs. */
function titledLink(html: string, title: string, base: string): URL {
  const markup = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const matches = new Set<string>();
  for (const anchor of markup.matchAll(/<a\b[^>]*>/gi)) {
    const attributes = new Map<string, string>();
    let repeated = false;
    for (const attribute of anchor[0].matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
      const name = (attribute[1] ?? "").toLowerCase();
      if (attributes.has(name)) repeated = true;
      attributes.set(name, htmlEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? ""));
    }
    if (attributes.get("title") !== title) continue;
    if (repeated) throw invalidResponse("Parliament directory anchor repeats an attribute");
    const href = attributes.get("href");
    if (!href || href.length > 20_000) throw invalidResponse("Parliament directory anchor has no bounded href");
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      throw invalidResponse("Parliament directory anchor is not a URL");
    }
    matches.add(url.toString());
  }
  if (matches.size !== 1) throw invalidResponse(`Parliament public directory did not uniquely identify ${title}`);
  const [url] = matches;
  if (!url) throw invalidResponse("Parliament directory link is missing");
  return new URL(url);
}

function htmlEntities(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    switch (entity.toLowerCase()) {
      case "&amp;":
        return "&";
      case "&quot;":
        return '"';
      case "&apos;":
        return "'";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      default: {
        const hex = entity.slice(0, 3).toLowerCase() === "&#x";
        const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
      }
    }
  });
}

function mergedValidator(headers: Headers, previous: SourceValidator | undefined): SourceValidator | undefined {
  const validator = { ...previous, ...responseValidator(headers) };
  return Object.keys(validator).length ? validator : undefined;
}
function upstreamError(response: Response): GatekeeperError {
  return new GatekeeperError(`Parliament source returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
}
