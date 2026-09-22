import {
  GatekeeperError,
  contentEtag,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  readBoundedResponse,
  retryAfterSeconds,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
} from "../../../index";

/**
 * SNIT-SGT, the system behind the national register of territorial management
 * instruments. Its front end is a single-page app; what this library reads is
 * the JSON API that app calls, which needs no key and answers anonymously.
 */
export const SNIT_API_ORIGIN = "https://snit-sgt.dgterritorio.gov.pt";
/**
 * The largest answer measured is the master plans at about 6.3 MB. The ceiling
 * is the 16 MiB a buffered body is read under whatever a policy says, so asking
 * for more would only download bytes the kernel then refuses.
 */
export const SNIT_MAX_BYTES = 16 * 1024 * 1024;

/**
 * One kind of territorial management instrument, keyed by a slug of our own.
 * The API's own short names cannot be that key: two of its types are both
 * called PROT — a *Plano* Regional (4) and the *Programa* Regional (51) that
 * replaced it — and one of those carries a newline inside its short name.
 */
export interface SnitInstrumentType {
  /** The numeric type the API is asked for. */
  id: number;
  /** The abbreviation the register uses. */
  abbreviation: string;
  /** What the abbreviation stands for. */
  name: string;
}

export const SNIT_TYPES = {
  "pdm": { id: 1, abbreviation: "PDM", name: "Plano Diretor Municipal" },
  "pu": { id: 7, abbreviation: "PU", name: "Plano de Urbanização" },
  "pp": { id: 6, abbreviation: "PP", name: "Plano de Pormenor" },
  "piot": { id: 10, abbreviation: "PIOT", name: "Plano Intermunicipal de Ordenamento do Território" },
  "pnpot": { id: 17, abbreviation: "PNPOT", name: "Programa Nacional da Política de Ordenamento do Território" },
  "medidas-preventivas": { id: 13, abbreviation: "MP", name: "Medidas Preventivas" },
  "prgp": { id: 57, abbreviation: "PRGP", name: "Programa de Reordenamento e Gestão da Paisagem" },
  "paap": { id: 48, abbreviation: "PAAP", name: "Programa de Albufeira de Águas Públicas" },
  "peap": { id: 47, abbreviation: "PEAP", name: "Programa Especial de Área Protegida" },
  "poc": { id: 40, abbreviation: "POC", name: "Programa da Orla Costeira" },
  "poaap": { id: 3, abbreviation: "POAAP", name: "Plano de Ordenamento de Albufeira de Águas Públicas" },
  "poap": { id: 2, abbreviation: "POAP", name: "Plano de Ordenamento de Área Protegida" },
  "pooc": { id: 5, abbreviation: "POOC", name: "Plano de Ordenamento da Orla Costeira" },
  "prot-programa": { id: 51, abbreviation: "PROT", name: "Programa Regional de Ordenamento do Território" },
  "prot-plano": { id: 4, abbreviation: "PROT", name: "Plano Regional de Ordenamento do Território" },
  "pna": { id: 35, abbreviation: "PNA", name: "Plano Nacional da Água" },
  "pgrh": { id: 38, abbreviation: "PGRH", name: "Plano de Gestão da Região Hidrográfica" },
  "pgri": { id: 39, abbreviation: "PGRI", name: "Plano de Gestão de Riscos de Inundações" },
  "pszaer": {
    id: 65,
    abbreviation: "PSZAER",
    name: "Programa Setorial das Zonas de Aceleração da Implantação de Energias Renováveis",
  },
  "rede-natura": { id: 26, abbreviation: "RN", name: "Rede Natura" },
  "prof": { id: 41, abbreviation: "PROF", name: "Programa Regional de Ordenamento Florestal" },
  "paqat": { id: 61, abbreviation: "PAqAT", name: "Plano para a Aquicultura em Águas de Transição" },
  "prn": { id: 36, abbreviation: "PRN", name: "Plano Rodoviário Nacional" },
  "pfn": { id: 62, abbreviation: "PFN", name: "Plano Ferroviário Nacional" },
} as const satisfies Record<string, SnitInstrumentType>;

export type SnitType = keyof typeof SNIT_TYPES;

export function isSnitType(value: string | undefined): value is SnitType {
  return value !== undefined && Object.hasOwn(SNIT_TYPES, value);
}

export const SNIT_FEEDS = {
  instruments: {
    kind: "instruments",
    title: "Territorial management instruments",
    description:
      "One kind of territorial management instrument in the national register, with every instrument in force and every act of the Diário da República that created, amended, suspended or corrected it.",
    semantics: { domainSubject: "document", defaultProductRole: "reference" },
  },
} as const satisfies Record<string, FeedKindDescription>;

const CONFIG_KEYS = new Set(["feed", "type"]);

export function validateSnitFeedConfig(config: SourceConfig): SourceConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new GatekeeperError(`Unsupported SNIT field: ${key}`, key === "host" || key === "url" ? "source-denied" : "invalid-config");
    }
  }
  if (config.feed !== "instruments") throw new GatekeeperError("SNIT requires feed=instruments", "invalid-config");
  const type = config.type?.trim();
  if (!isSnitType(type)) throw new GatekeeperError(`SNIT type must be one of: ${Object.keys(SNIT_TYPES).join(", ")}`, "invalid-config");
  return { feed: "instruments", type };
}

/** The API answers POSTs only, so the link a product page shows is the register a browser can open. */
export const SNIT_LANDING_PAGE = `${SNIT_API_ORIGIN}/`;

function endpoint(origin: string, path: string): URL {
  if (origin !== SNIT_API_ORIGIN) throw new GatekeeperError("The SNIT API origin is not allowed", "source-denied");
  return new URL(path, origin);
}

export function snitInstrumentsUrl(origin: string): URL {
  return endpoint(origin, "/api/Instrument/GetInstrumentsAsync");
}

export function snitMunicipalitiesUrl(origin: string): URL {
  return endpoint(origin, "/api/Instrument/GetRegionsAndMunicipalitiesAsync");
}

/**
 * Every instrument of one type, with the acts behind each.
 *
 * The API takes the municipalities to search as an explicit list — the "all"
 * flag on its own returns an empty body — so the register's own list of regions
 * and municipalities is read first and handed straight back to it. That keeps
 * the query current when a municipality is added or renamed, at the cost of one
 * small request before the large one.
 */
export async function collectSnitFeed(config: SourceConfig, checkpoint: SourceValidator | undefined, origin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateSnitFeedConfig(config);
  const type = instrumentType(validated.type);
  const regions = await readRegions(origin, fetcher);
  const instruments = await readInstruments(origin, fetcher, type, regions.codes);

  const document: JsonObject = {
    snit: {
      type: validated.type ?? "",
      typeId: type.id,
      abbreviation: type.abbreviation,
      name: type.name,
      municipalities: regions.codes.length,
      sourceUrl: SNIT_LANDING_PAGE,
    },
    instruments,
  };
  const body = new TextEncoder().encode(JSON.stringify(document));
  // The API publishes no validator of its own and answers only POSTs, so the
  // digest of what it returned is the only thing that can say "nothing changed".
  const etag = await contentEtag(body);
  if (checkpoint?.etag === etag) return { kind: "not-modified", validator: { etag } };
  return { kind: "body", body, provenance: { sourceUrl: SNIT_LANDING_PAGE }, completeness: "complete", validator: { etag } };
}

function instrumentType(value: string | undefined): SnitInstrumentType {
  if (!isSnitType(value)) throw new GatekeeperError("SNIT type was not resolved", "invalid-config");
  return SNIT_TYPES[value];
}

interface Regions {
  codes: string[];
}

async function readRegions(origin: string, fetcher: typeof fetch): Promise<Regions> {
  const url = snitMunicipalitiesUrl(origin);
  const response = await send(url, { headers: { Accept: "application/json" }, redirect: "manual" }, fetcher, "regions");
  const value = parse(await readBoundedResponse(response, 1024 * 1024, "SNIT regions"), "regions");
  if (!isJsonArray(value)) throw new GatekeeperError("SNIT regions did not return a list", "invalid-response");
  const codes: string[] = [];
  for (const region of value) {
    if (!isJsonObject(region) || !isJsonArray(region.listMunicipalities)) continue;
    for (const municipality of region.listMunicipalities) {
      if (isJsonObject(municipality) && isJsonString(municipality.dtcc) && /^\d{4}$/u.test(municipality.dtcc)) codes.push(municipality.dtcc);
    }
  }
  if (codes.length === 0) throw new GatekeeperError("SNIT regions carried no municipalities", "invalid-response");
  return { codes: [...new Set(codes)] };
}

async function readInstruments(origin: string, fetcher: typeof fetch, type: SnitInstrumentType, codes: string[]): Promise<JsonValue[]> {
  const url = snitInstrumentsUrl(origin);
  const body = JSON.stringify({
    regionsMunicipalitiesSelected: codes,
    allRegionsMunicipalitiesSelected: true,
    typesSelected: [type.id],
    allTypesSelected: false,
    // 1 is the register's own filter for an instrument in force. A superseded
    // plan is not dropped from history by this: the acts that ended it stay on
    // the instrument that carried them.
    statusSelected: 1,
  });
  const response = await send(
    url,
    { method: "POST", headers: { "Accept": "application/json", "Content-Type": "application/json" }, body, redirect: "manual" },
    fetcher,
    "instruments",
  );
  const value = parse(await readBoundedResponse(response, SNIT_MAX_BYTES, "SNIT instruments"), "instruments");
  if (!isJsonArray(value)) throw new GatekeeperError("SNIT instruments did not return a list", "invalid-response");
  for (const instrument of value) {
    if (!isJsonObject(instrument) || !isJsonNumber(instrument.idigt)) throw new GatekeeperError("SNIT returned an instrument without an identifier", "invalid-response");
  }
  return value;
}

async function send(url: URL, init: RequestInit, fetcher: typeof fetch, resource: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch (error) {
    throw new GatekeeperError(`SNIT ${resource} request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if (response.status >= 300 && response.status < 400) throw new GatekeeperError("SNIT redirects are not allowed", "source-denied");
  if (response.url !== "" && new URL(response.url).origin !== url.origin) throw new GatekeeperError("SNIT answered from another origin", "source-denied");
  if (!response.ok) throw new GatekeeperError(`SNIT ${resource} returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  return response;
}

function parse(bytes: Uint8Array, resource: string): JsonValue {
  try {
    return parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError(`SNIT ${resource} returned invalid JSON`, "invalid-response");
  }
}
