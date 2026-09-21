import type { CollectionPolicyDefinition, ExampleFeed, ServingPolicyDefinition } from "../../index";

const MEBIBYTE = 1024 * 1024;
const DGT_HOST = "ogcapi.dgterritorio.gov.pt";

const WEEK = 604_800;

/** The CAOP is republished as a dated edition, not continuously; weekly is frequent enough to catch a correction. */
const DGT_SERVING: ServingPolicyDefinition = {
  // The service does state its terms, but only in its HTML representation:
  // `https://ogcapi.dgterritorio.gov.pt/?f=html` carries "Terms of service —
  // https://creativecommons.org/licenses/by/4.0/", which pygeoapi leaves out
  // of the `?f=json` landing page this library actually reads. DGT's own site
  // and its dados.gov.pt records agree on CC BY 4.0.
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
};

/** What DGT is credited as, per dataset; the licence is CC BY 4.0 across the service. */
function dgtServing(dataset: string): ServingPolicyDefinition {
  return { licence: "cc-by-4.0", attribution: `Direção-Geral do Território — ${dataset}` };
}

/** Attribute tables: a few hundred kilobytes at most, every property on every feature. */
function attributePolicy(name: string, serving: ServingPolicyDefinition, maxBytes: number): ExampleFeed["policy"] {
  return {
    name,
    version: 3,
    collection: {
      cadenceSeconds: WEEK,
      timeoutSeconds: 120,
      maxBytes,
      historyMode: "changes",
    } satisfies CollectionPolicyDefinition,
    serving,
  };
}

/**
 * One layer of the SRUP — the public-utility easements and restrictions in
 * force on the mainland. Every layer carries the same register columns, so one
 * description here is the whole of what differs between them.
 */
interface SrupLayer {
  slug: string;
  collection: string;
  title: string;
  description: string;
  /** Read once from the service, and what the description promises. */
  features: number;
  /**
   * Outlines are collected only where they are small enough to be worth it: a
   * protected area averages half a megabyte of coordinates and a geodetic mark's
   * protection zone twelve kilobytes, so those are read as attributes alone.
   */
  geometry?: "include";
  /** The columns worth publishing, where the layer holds one value for the rest of them. */
  properties?: string;
  topics: NonNullable<ExampleFeed["topics"]>;
  /** Measured: the whole layer as this feed reads it, with room to grow. */
  maxBytes: number;
}

/*
 * The SRUP layers small enough to publish whole. Four are not here: the fire
 * hazard chart (1,787,684 features), the SGIFR areas and lines (490,437 and
 * 239,863) and the cadastral parcels (1,814,264) are national coverages rather
 * than registers, and no page budget makes them a table.
 *
 * `serv_data` is the day the act took effect and `serv_hiperligacao` the act
 * itself, so each row is dated by the source's own clock and carries its proof.
 *
 * What these rows are keyed by is the service's own `fid`, which its published
 * schema marks as the identifier and which runs 1..N in load order. It is the
 * only identifier the layers carry — no row holds a reference of its own, and
 * two entries of the same easement under the same act are told apart by nothing
 * else — so it is what a feed can use. The cost is that a reload which renumbers
 * a layer reads as every row being retracted and a new one created. That is
 * visible rather than silent: a whole-layer churn on a register that gains a
 * handful of rows a year is the shape of a renumbering, not of a change in the
 * law. Nothing here can prevent it; the alternative, a key built from the
 * columns, would collide on the very rows that need telling apart.
 */
const SRUP_LAYERS: SrupLayer[] = [
  {
    slug: "dgt-srup-reserva-ecologica-areas-feed",
    collection: "srup_ren_areal",
    title: "National Ecological Reserve delimitations in force",
    description:
      "Every municipal delimitation of the Reserva Ecológica Nacional in force on the Portuguese mainland — 399 of them, each an ordinance or notice with the municipality it covers, the area it protects in hectares, whether it is the reserve itself or an exclusion from it, and a link to the act in the Diário da República. Attributes only: the outlines are too large to carry.",
    features: 399,
    topics: ["environment", "government"],
    maxBytes: 2 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-reserva-ecologica-linhas-feed",
    collection: "srup_ren_linear",
    title: "National Ecological Reserve watercourse delimitations",
    description:
      "The 138 linear delimitations of the Reserva Ecológica Nacional — watercourses and the ten-metre beds either side of them — with the act that set each one, its date and the municipality it covers. Attributes only.",
    features: 138,
    topics: ["environment", "government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-reserva-agricola-feed",
    collection: "srup_ran",
    title: "National Agricultural Reserve delimitations in force",
    description:
      "The Reserva Agrícola Nacional as delimited for each of 269 mainland municipalities, with the ordinance or notice that set it, the issue of the Diário da República it appeared in, the date it took effect and a link to the act. Attributes only.",
    features: 269,
    properties: "designacao,serv_dr,serv_data,serv_hiperligacao,serv_lei,municipio",
    topics: ["environment", "government"],
    maxBytes: 2 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-areas-protegidas-feed",
    collection: "srup_areas_protegidas",
    title: "Protected areas as a public-utility restriction",
    description:
      "The 71 classified protected areas of mainland Portugal — national, natural and regional parks, nature reserves, natural monuments and protected landscapes — each with the decree that created it, its date, the municipalities it spans and a link to the act. Attributes only: one protected area averages half a megabyte of outline.",
    features: 71,
    topics: ["environment", "government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-rede-natura-zec-feed",
    collection: "srup_zec",
    title: "Natura 2000 Special Areas of Conservation",
    description:
      "The 65 Zonas Especiais de Conservação of the Natura 2000 network on the Portuguese mainland, with the phase of the national site list each belongs to, the decree that designated it, its date and the municipalities it covers. Attributes only.",
    features: 65,
    topics: ["environment", "government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-rede-natura-zpe-feed",
    collection: "srup_zpe",
    title: "Natura 2000 Special Protection Areas",
    description:
      "The 44 Zonas de Proteção Especial for wild birds on the Portuguese mainland, with the decree that designated each one, its date, the municipalities it covers and a link to the act. Attributes only.",
    features: 44,
    properties: "designacao,serv_dr,serv_data,serv_hiperligacao,serv_lei,municipio,dtccs",
    topics: ["environment", "government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-arvores-interesse-publico-pontos-feed",
    collection: "srup_arvores_point",
    title: "Trees of public interest",
    description:
      "The 551 individual trees and groves classified as being of public interest in mainland Portugal, where each one stands, its species, whether it is a single tree or a group, and the notice that classified it. Lisbon holds 84 of them and Marinha Grande 34; the oldest classification here dates from 1947.",
    features: 551,
    geometry: "include",
    topics: ["environment", "culture"],
    maxBytes: 2 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-arvores-interesse-publico-areas-feed",
    collection: "srup_arvores_areal",
    title: "Groves of public interest",
    description:
      "The 89 wooded areas classified as being of public interest in mainland Portugal, with the species, the act that classified each one and the municipality it stands in. Attributes only.",
    features: 89,
    topics: ["environment", "culture"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-marcos-geodesicos-feed",
    collection: "srup_marcos_geod",
    title: "Geodetic marks and their protection zones",
    description:
      "The 7,968 geodetic marks of mainland Portugal whose surroundings are protected by law, with the name each one is known by, the network it belongs to and the municipality it stands in. Odemira holds 193 of them. Attributes only: what is stored is the protection zone around each mark, not the mark itself. Every one of these is protected by the same 1982 decree, which the feed states once rather than on every row. This is the easement side of the register; the survey side, with each mark's order and height, is published separately from the geodetic network itself.",
    features: 7968,
    properties: "designacao,tipologia,municipio,dtccs",
    topics: ["government", "society"],
    maxBytes: 4 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-aeronautica-feed",
    collection: "srup_aeronautica",
    title: "Airport and aerodrome easements",
    description:
      "The 36 airports and aerodromes of mainland Portugal whose surroundings carry an aeronautical easement, with the decree that established each one, its date, the municipalities it reaches and a link to the act. Attributes only.",
    features: 36,
    topics: ["mobility", "government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-albufeiras-feed",
    collection: "srup_albufeiras",
    title: "Classified public water reservoirs",
    description:
      "The 192 classified reservoirs of mainland Portugal, sorted into protected, conditioned and freely used, with the ordinance that classified each one and the municipalities around it. Attributes only.",
    features: 192,
    topics: ["environment", "energy"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-captacoes-aguas-subterraneas-feed",
    collection: "srup_aquiferos",
    title: "Protection zones around public groundwater abstraction",
    description:
      "The 949 protection perimeters around groundwater abstracted for public supply in mainland Portugal, with the ordinance that set each one, its date and the municipality it lies in. Pampilhosa da Serra and Góis hold 155 between them. Attributes only: one perimeter averages nine kilobytes of outline.",
    features: 949,
    topics: ["environment", "health"],
    maxBytes: 2 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-defesa-nacional-feed",
    collection: "srup_defesa_militar",
    title: "National defence easements",
    description:
      "The 152 military installations of mainland Portugal carrying a defence easement — barracks, forts and batteries — with the act that established each one, its date and the municipality it stands in. Lisbon holds 20. Attributes only.",
    features: 152,
    topics: ["government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-defesa-nacional-zonas-feed",
    collection: "srup_defesa_militar_zonas",
    title: "National defence protection zones",
    description:
      "The 149 protection zones around military installations in mainland Portugal, with the act that established each one, its date and the municipality it covers. Attributes only.",
    features: 149,
    topics: ["government"],
    maxBytes: MEBIBYTE,
  },
  {
    slug: "dgt-srup-rede-rodoviaria-feed",
    collection: "srup_rede_viaria",
    title: "National road network easements",
    description:
      "The 3,160 stretches of the national road network carrying an easement, each named for the road it belongs to — the A1, the EN2, a link ramp — and sorted into motorway, national road, regional road and municipal road, with the municipality it crosses. Porto holds 121 stretches. Attributes only.",
    features: 3160,
    topics: ["mobility", "government"],
    maxBytes: 4 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-rede-ferroviaria-feed",
    collection: "srup_rede_ferroviaria",
    title: "Railway easements",
    description:
      "The 502 stretches of railway in mainland Portugal carrying an easement, with the act that established it, its date and the municipality it crosses. Attributes only.",
    features: 502,
    topics: ["mobility", "government"],
    maxBytes: 2 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-estacoes-ferroviarias-feed",
    collection: "srup_rede_ferroviaria_estacoes",
    title: "Railway stations and halts",
    description:
      "The 860 railway stations and halts of mainland Portugal held in the easement register, each named and sorted into station, halt, or no longer worked — 298 of them are out of service. Lisbon holds 21. Attributes only. All 860 rest on the same 2003 decree, which the feed states once rather than on every row.",
    features: 860,
    properties: "designacao,tipologia,municipio,dtccs",
    topics: ["mobility", "government"],
    maxBytes: 2 * MEBIBYTE,
  },
  {
    slug: "dgt-srup-rede-eletrica-feed",
    collection: "srup_rede_eletrica",
    title: "Electricity grid easements",
    description:
      "The 2,456 stretches of the national electricity grid carrying an easement in mainland Portugal, sorted by voltage, with the decree behind each one and the municipality it crosses. Attributes only.",
    features: 2456,
    topics: ["energy", "government"],
    maxBytes: 4 * MEBIBYTE,
  },
  {
    slug: "dgt-sgifr-pontos-feed",
    collection: "sgifr_pontos",
    title: "Rural fire management points",
    description:
      "The 7,841 points held in the sub-regional rural fire management programmes of mainland Portugal: 7,550 water points for firefighting, 172 lookout and detection posts, and the rest strategic fuel-break mosaics. Each carries the intermunicipal body that answers for it, the programme it belongs to and the notice that approved that programme.",
    features: 7841,
    geometry: "include",
    topics: ["environment", "government"],
    maxBytes: 12 * MEBIBYTE,
  },
];

/**
 * A register layer: read whole every week, with room for the pages the count
 * needs. The service answers each of these in well under a second and publishes
 * no validator, so the cost of a run is one small walk, not a re-download of
 * anything large.
 */
function srupFeed(layer: SrupLayer): ExampleFeed {
  const geometry = layer.geometry ?? "skip";
  const config: ExampleFeed["config"] = {
    source: "ogc",
    host: DGT_HOST,
    collection: layer.collection,
    geometry,
    pageSize: "500",
    maxPages: String(Math.max(4, Math.ceil(layer.features / 500) + 2)),
  };
  if (layer.properties) config.properties = layer.properties;
  return {
    slug: layer.slug,
    title: layer.title,
    description: layer.description,
    config,
    policy: {
      name: "SRUP weekly register",
      version: 1,
      collection: {
        // A restriction changes when an act is published, which happens a
        // handful of times a year across the whole register. Weekly catches one
        // within days and costs one short walk of a few hundred kilobytes.
        cadenceSeconds: WEEK,
        timeoutSeconds: 180,
        maxBytes: layer.maxBytes,
        historyMode: "changes",
      } satisfies CollectionPolicyDefinition,
      serving: dgtServing("Servidões e Restrições de Utilidade Pública"),
    },
    // Two weeks: an act published the day after a run should not make the feed
    // look stale before the next one has had a chance to catch it.
    staleAfterSeconds: 2 * WEEK,
    publisher: "dgt",
    topics: layer.topics,
  };
}

/**
 * Every municipality the national layer holds, with the parcels it holds for
 * it, read by walking the whole layer once: all 278 of mainland Portugal are
 * in it, not only the ones whose charter has a catalogue record.
 *
 * All 278 are read the same way. Torres Vedras used to be read a class at a
 * time from the per-municipality GeoMedia service, which carried its outlines
 * but answered in 200 seconds and then 502 when asked for more than one class;
 * it is read here like every other municipality instead.
 */
interface CrusMunicipality {
  /** The slug's municipal part; the feed's own slug never changes once bound. */
  slug: string;
  /** The name as a heading shows it. */
  name: string;
  /** The value the layer stores, which the service is asked to cut on. */
  municipio: string;
  /** Read from the service, and what the description promises. */
  parcels: number;
}

const CRUS_MUNICIPALITIES: CrusMunicipality[] = [
  { slug: "abrantes", name: "Abrantes", municipio: "ABRANTES", parcels: 905 },
  { slug: "agueda", name: "Águeda", municipio: "ÁGUEDA", parcels: 1048 },
  { slug: "aguiar-da-beira", name: "Aguiar da Beira", municipio: "AGUIAR DA BEIRA", parcels: 449 },
  { slug: "alandroal", name: "Alandroal", municipio: "ALANDROAL", parcels: 1407 },
  { slug: "albergaria-a-velha", name: "Albergaria-A-Velha", municipio: "ALBERGARIA-A-VELHA", parcels: 373 },
  { slug: "albufeira", name: "Albufeira", municipio: "ALBUFEIRA", parcels: 482 },
  { slug: "alcacer-do-sal", name: "Alcácer do Sal", municipio: "ALCÁCER DO SAL", parcels: 547 },
  { slug: "alcanena", name: "Alcanena", municipio: "ALCANENA", parcels: 728 },
  { slug: "alcobaca", name: "Alcobaça", municipio: "ALCOBAÇA", parcels: 1429 },
  { slug: "alcochete", name: "Alcochete", municipio: "ALCOCHETE", parcels: 55 },
  { slug: "alcoutim", name: "Alcoutim", municipio: "ALCOUTIM", parcels: 421 },
  { slug: "alenquer", name: "Alenquer", municipio: "ALENQUER", parcels: 592 },
  { slug: "alfandega-da-fe", name: "Alfândega da Fé", municipio: "ALFÂNDEGA DA FÉ", parcels: 955 },
  { slug: "alijo", name: "Alijó", municipio: "ALIJÓ", parcels: 743 },
  { slug: "aljezur", name: "Aljezur", municipio: "ALJEZUR", parcels: 309 },
  { slug: "aljustrel", name: "Aljustrel", municipio: "ALJUSTREL", parcels: 1087 },
  { slug: "almada", name: "Almada", municipio: "ALMADA", parcels: 286 },
  { slug: "almeida", name: "Almeida", municipio: "ALMEIDA", parcels: 658 },
  { slug: "almeirim", name: "Almeirim", municipio: "ALMEIRIM", parcels: 384 },
  { slug: "almodovar", name: "Almodôvar", municipio: "ALMODÔVAR", parcels: 145 },
  { slug: "alpiarca", name: "Alpiarça", municipio: "ALPIARÇA", parcels: 71 },
  { slug: "alter-do-chao", name: "Alter do Chão", municipio: "ALTER DO CHÃO", parcels: 225 },
  { slug: "alvaiazere", name: "Alvaiázere", municipio: "ALVAIÁZERE", parcels: 422 },
  { slug: "alvito", name: "Alvito", municipio: "ALVITO", parcels: 259 },
  { slug: "amadora", name: "Amadora", municipio: "AMADORA", parcels: 82 },
  { slug: "amarante", name: "Amarante", municipio: "AMARANTE", parcels: 1035 },
  { slug: "amares", name: "Amares", municipio: "AMARES", parcels: 489 },
  { slug: "anadia", name: "Anadia", municipio: "ANADIA", parcels: 1142 },
  { slug: "ansiao", name: "Ansião", municipio: "ANSIÃO", parcels: 2075 },
  { slug: "arcos-de-valdevez", name: "Arcos de Valdevez", municipio: "ARCOS DE VALDEVEZ", parcels: 3081 },
  { slug: "arganil", name: "Arganil", municipio: "ARGANIL", parcels: 1162 },
  { slug: "armamar", name: "Armamar", municipio: "ARMAMAR", parcels: 486 },
  { slug: "arouca", name: "Arouca", municipio: "AROUCA", parcels: 877 },
  { slug: "arraiolos", name: "Arraiolos", municipio: "ARRAIOLOS", parcels: 891 },
  { slug: "arronches", name: "Arronches", municipio: "ARRONCHES", parcels: 1692 },
  { slug: "arruda-dos-vinhos", name: "Arruda dos Vinhos", municipio: "ARRUDA DOS VINHOS", parcels: 192 },
  { slug: "aveiro", name: "Aveiro", municipio: "AVEIRO", parcels: 1148 },
  { slug: "avis", name: "Avis", municipio: "AVIS", parcels: 352 },
  { slug: "azambuja", name: "Azambuja", municipio: "AZAMBUJA", parcels: 372 },
  { slug: "baiao", name: "Baião", municipio: "BAIÃO", parcels: 588 },
  { slug: "barcelos", name: "Barcelos", municipio: "BARCELOS", parcels: 3070 },
  { slug: "barrancos", name: "Barrancos", municipio: "BARRANCOS", parcels: 32 },
  { slug: "barreiro", name: "Barreiro", municipio: "BARREIRO", parcels: 109 },
  { slug: "batalha", name: "Batalha", municipio: "BATALHA", parcels: 481 },
  { slug: "beja", name: "Beja", municipio: "BEJA", parcels: 1121 },
  { slug: "belmonte", name: "Belmonte", municipio: "BELMONTE", parcels: 736 },
  { slug: "benavente", name: "Benavente", municipio: "BENAVENTE", parcels: 408 },
  { slug: "bombarral", name: "Bombarral", municipio: "BOMBARRAL", parcels: 522 },
  { slug: "borba", name: "Borba", municipio: "BORBA", parcels: 346 },
  { slug: "boticas", name: "Boticas", municipio: "BOTICAS", parcels: 713 },
  { slug: "braga", name: "Braga", municipio: "BRAGA", parcels: 480 },
  { slug: "braganca", name: "Bragança", municipio: "BRAGANÇA", parcels: 1280 },
  { slug: "cabeceiras-de-basto", name: "Cabeceiras de Basto", municipio: "CABECEIRAS DE BASTO", parcels: 549 },
  { slug: "cadaval", name: "Cadaval", municipio: "CADAVAL", parcels: 744 },
  { slug: "caldas-da-rainha", name: "Caldas da Rainha", municipio: "CALDAS DA RAINHA", parcels: 901 },
  { slug: "caminha", name: "Caminha", municipio: "CAMINHA", parcels: 952 },
  { slug: "campo-maior", name: "Campo Maior", municipio: "CAMPO MAIOR", parcels: 792 },
  { slug: "cantanhede", name: "Cantanhede", municipio: "CANTANHEDE", parcels: 869 },
  { slug: "carrazeda-de-ansiaes", name: "Carrazeda de Ansiães", municipio: "CARRAZEDA DE ANSIÃES", parcels: 967 },
  { slug: "carregal-do-sal", name: "Carregal do Sal", municipio: "CARREGAL DO SAL", parcels: 851 },
  { slug: "cartaxo", name: "Cartaxo", municipio: "CARTAXO", parcels: 310 },
  { slug: "cascais", name: "Cascais", municipio: "CASCAIS", parcels: 2001 },
  { slug: "castanheira-de-pera", name: "Castanheira de Pêra", municipio: "CASTANHEIRA DE PÊRA", parcels: 214 },
  { slug: "castelo-branco", name: "Castelo Branco", municipio: "CASTELO BRANCO", parcels: 1281 },
  { slug: "castelo-de-paiva", name: "Castelo de Paiva", municipio: "CASTELO DE PAIVA", parcels: 625 },
  { slug: "castelo-de-vide", name: "Castelo de Vide", municipio: "CASTELO DE VIDE", parcels: 941 },
  { slug: "castro-daire", name: "Castro Daire", municipio: "CASTRO DAIRE", parcels: 1542 },
  { slug: "castro-marim", name: "Castro Marim", municipio: "CASTRO MARIM", parcels: 478 },
  { slug: "castro-verde", name: "Castro Verde", municipio: "CASTRO VERDE", parcels: 86 },
  { slug: "celorico-da-beira", name: "Celorico da Beira", municipio: "CELORICO DA BEIRA", parcels: 1298 },
  { slug: "celorico-de-basto", name: "Celorico de Basto", municipio: "CELORICO DE BASTO", parcels: 671 },
  { slug: "chamusca", name: "Chamusca", municipio: "CHAMUSCA", parcels: 5011 },
  { slug: "chaves", name: "Chaves", municipio: "CHAVES", parcels: 900 },
  { slug: "cinfaes", name: "Cinfães", municipio: "CINFÃES", parcels: 638 },
  { slug: "coimbra", name: "Coimbra", municipio: "COIMBRA", parcels: 862 },
  { slug: "condeixa-a-nova", name: "Condeixa-A-Nova", municipio: "CONDEIXA-A-NOVA", parcels: 396 },
  { slug: "constancia", name: "Constãncia", municipio: "CONSTÃNCIA", parcels: 178 },
  { slug: "coruche", name: "Coruche", municipio: "CORUCHE", parcels: 1482 },
  { slug: "covilha", name: "Covilhã", municipio: "COVILHÃ", parcels: 820 },
  { slug: "crato", name: "Crato", municipio: "CRATO", parcels: 826 },
  { slug: "cuba", name: "Cuba", municipio: "CUBA", parcels: 167 },
  { slug: "elvas", name: "Elvas", municipio: "ELVAS", parcels: 761 },
  { slug: "entroncamento", name: "Entroncamento", municipio: "ENTRONCAMENTO", parcels: 266 },
  { slug: "espinho", name: "Espinho", municipio: "ESPINHO", parcels: 238 },
  { slug: "esposende", name: "Esposende", municipio: "ESPOSENDE", parcels: 227 },
  { slug: "estarreja", name: "Estarreja", municipio: "ESTARREJA", parcels: 291 },
  { slug: "estremoz", name: "Estremoz", municipio: "ESTREMOZ", parcels: 1717 },
  { slug: "evora", name: "Évora", municipio: "ÉVORA", parcels: 759 },
  { slug: "fafe", name: "Fafe", municipio: "FAFE", parcels: 1140 },
  { slug: "faro", name: "Faro", municipio: "FARO", parcels: 512 },
  { slug: "felgueiras", name: "Felgueiras", municipio: "FELGUEIRAS", parcels: 805 },
  { slug: "ferreira-do-alentejo", name: "Ferreira do Alentejo", municipio: "FERREIRA DO ALENTEJO", parcels: 313 },
  { slug: "ferreira-do-zezere", name: "Ferreira do Zêzere", municipio: "FERREIRA DO ZÊZERE", parcels: 654 },
  { slug: "figueira-da-foz", name: "Figueira da Foz", municipio: "FIGUEIRA DA FOZ", parcels: 949 },
  { slug: "figueira-de-castelo-rodrigo", name: "Figueira de Castelo Rodrigo", municipio: "FIGUEIRA DE CASTELO RODRIGO", parcels: 930 },
  { slug: "figueiro-dos-vinhos", name: "Figueiró dos Vinhos", municipio: "FIGUEIRÓ DOS VINHOS", parcels: 2063 },
  { slug: "fornos-de-algodres", name: "Fornos de Algodres", municipio: "FORNOS DE ALGODRES", parcels: 395 },
  { slug: "freixo-de-espada-a-cinta", name: "Freixo de Espada À Cinta", municipio: "FREIXO DE ESPADA À CINTA", parcels: 223 },
  { slug: "fronteira", name: "Fronteira", municipio: "FRONTEIRA", parcels: 290 },
  { slug: "fundao", name: "Fundão", municipio: "FUNDÃO", parcels: 2013 },
  { slug: "gaviao", name: "Gavião", municipio: "GAVIÃO", parcels: 230 },
  { slug: "gois", name: "Góis", municipio: "GÓIS", parcels: 660 },
  { slug: "golega", name: "Golegã", municipio: "GOLEGÃ", parcels: 33 },
  { slug: "gondomar", name: "Gondomar", municipio: "GONDOMAR", parcels: 610 },
  { slug: "gouveia", name: "Gouveia", municipio: "GOUVEIA", parcels: 286 },
  { slug: "grandola", name: "Grândola", municipio: "GRÂNDOLA", parcels: 1485 },
  { slug: "guarda", name: "Guarda", municipio: "GUARDA", parcels: 1373 },
  { slug: "guimaraes", name: "Guimarães", municipio: "GUIMARÃES", parcels: 1590 },
  { slug: "idanha-a-nova", name: "Idanha-A-Nova", municipio: "IDANHA-A-NOVA", parcels: 1130 },
  { slug: "ilhavo", name: "Ílhavo", municipio: "ÍLHAVO", parcels: 180 },
  { slug: "lagoa", name: "Lagoa", municipio: "LAGOA", parcels: 754 },
  { slug: "lagos", name: "Lagos", municipio: "LAGOS", parcels: 1344 },
  { slug: "lamego", name: "Lamego", municipio: "LAMEGO", parcels: 791 },
  { slug: "leiria", name: "Leiria", municipio: "LEIRIA", parcels: 1801 },
  { slug: "lisboa", name: "Lisboa", municipio: "LISBOA", parcels: 861 },
  { slug: "loule", name: "Loulé", municipio: "LOULÉ", parcels: 747 },
  { slug: "loures", name: "Loures", municipio: "LOURES", parcels: 2022 },
  { slug: "lourinha", name: "Lourinhã", municipio: "LOURINHÃ", parcels: 279 },
  { slug: "lousa", name: "Lousã", municipio: "LOUSÃ", parcels: 386 },
  { slug: "lousada", name: "Lousada", municipio: "LOUSADA", parcels: 526 },
  { slug: "macao", name: "Mação", municipio: "MAÇÃO", parcels: 405 },
  { slug: "macedo-de-cavaleiros", name: "Macedo de Cavaleiros", municipio: "MACEDO DE CAVALEIROS", parcels: 902 },
  { slug: "mafra", name: "Mafra", municipio: "MAFRA", parcels: 1709 },
  { slug: "maia", name: "Maia", municipio: "MAIA", parcels: 345 },
  { slug: "mangualde", name: "Mangualde", municipio: "MANGUALDE", parcels: 541 },
  { slug: "manteigas", name: "Manteigas", municipio: "MANTEIGAS", parcels: 106 },
  { slug: "marco-de-canaveses", name: "Marco de Canaveses", municipio: "MARCO DE CANAVESES", parcels: 1221 },
  { slug: "marinha-grande", name: "Marinha Grande", municipio: "MARINHA GRANDE", parcels: 1562 },
  { slug: "marvao", name: "Marvão", municipio: "MARVÃO", parcels: 1341 },
  { slug: "matosinhos", name: "Matosinhos", municipio: "MATOSINHOS", parcels: 368 },
  { slug: "mealhada", name: "Mealhada", municipio: "MEALHADA", parcels: 270 },
  { slug: "meda", name: "Mêda", municipio: "MÊDA", parcels: 717 },
  { slug: "melgaco", name: "Melgaço", municipio: "MELGAÇO", parcels: 2113 },
  { slug: "mertola", name: "Mértola", municipio: "MÉRTOLA", parcels: 184 },
  { slug: "mesao-frio", name: "Mesão Frio", municipio: "MESÃO FRIO", parcels: 451 },
  { slug: "mira", name: "Mira", municipio: "MIRA", parcels: 202 },
  { slug: "miranda-do-corvo", name: "Miranda do Corvo", municipio: "MIRANDA DO CORVO", parcels: 76 },
  { slug: "miranda-do-douro", name: "Miranda do Douro", municipio: "MIRANDA DO DOURO", parcels: 364 },
  { slug: "mirandela", name: "Mirandela", municipio: "MIRANDELA", parcels: 2013 },
  { slug: "mogadouro", name: "Mogadouro", municipio: "MOGADOURO", parcels: 675 },
  { slug: "moimenta-da-beira", name: "Moimenta da Beira", municipio: "MOIMENTA DA BEIRA", parcels: 681 },
  { slug: "moita", name: "Moita", municipio: "MOITA", parcels: 356 },
  { slug: "moncao", name: "Monção", municipio: "MONÇÃO", parcels: 656 },
  { slug: "monchique", name: "Monchique", municipio: "MONCHIQUE", parcels: 502 },
  { slug: "mondim-de-basto", name: "Mondim de Basto", municipio: "MONDIM DE BASTO", parcels: 844 },
  { slug: "monforte", name: "Monforte", municipio: "MONFORTE", parcels: 593 },
  { slug: "montalegre", name: "Montalegre", municipio: "MONTALEGRE", parcels: 534 },
  { slug: "montemor-o-novo", name: "Montemor-O-Novo", municipio: "MONTEMOR-O-NOVO", parcels: 1707 },
  { slug: "montemor-o-velho", name: "Montemor-O-Velho", municipio: "MONTEMOR-O-VELHO", parcels: 579 },
  { slug: "montijo", name: "Montijo", municipio: "MONTIJO", parcels: 532 },
  { slug: "mora", name: "Mora", municipio: "MORA", parcels: 448 },
  { slug: "mortagua", name: "Mortágua", municipio: "MORTÁGUA", parcels: 479 },
  { slug: "moura", name: "Moura", municipio: "MOURA", parcels: 312 },
  { slug: "mourao", name: "Mourão", municipio: "MOURÃO", parcels: 124 },
  { slug: "murca", name: "Murça", municipio: "MURÇA", parcels: 349 },
  { slug: "murtosa", name: "Murtosa", municipio: "MURTOSA", parcels: 69 },
  { slug: "nazare", name: "Nazaré", municipio: "NAZARÉ", parcels: 101 },
  { slug: "nelas", name: "Nelas", municipio: "NELAS", parcels: 1086 },
  { slug: "nisa", name: "Nisa", municipio: "NISA", parcels: 3023 },
  { slug: "obidos", name: "Óbidos", municipio: "ÓBIDOS", parcels: 381 },
  { slug: "odemira", name: "Odemira", municipio: "ODEMIRA", parcels: 1315 },
  { slug: "odivelas", name: "Odivelas", municipio: "ODIVELAS", parcels: 222 },
  { slug: "oeiras", name: "Oeiras", municipio: "OEIRAS", parcels: 191 },
  { slug: "oleiros", name: "Oleiros", municipio: "OLEIROS", parcels: 490 },
  { slug: "olhao", name: "Olhão", municipio: "OLHÃO", parcels: 110 },
  { slug: "oliveira-de-azemeis", name: "Oliveira de Azeméis", municipio: "OLIVEIRA DE AZEMÉIS", parcels: 267 },
  { slug: "oliveira-de-frades", name: "Oliveira de Frades", municipio: "OLIVEIRA DE FRADES", parcels: 395 },
  { slug: "oliveira-do-bairro", name: "Oliveira do Bairro", municipio: "OLIVEIRA DO BAIRRO", parcels: 1114 },
  { slug: "oliveira-do-hospital", name: "Oliveira do Hospital", municipio: "OLIVEIRA DO HOSPITAL", parcels: 1702 },
  { slug: "ourem", name: "Ourém", municipio: "OURÉM", parcels: 1282 },
  { slug: "ourique", name: "Ourique", municipio: "OURIQUE", parcels: 1909 },
  { slug: "ovar", name: "Ovar", municipio: "OVAR", parcels: 345 },
  { slug: "pacos-de-ferreira", name: "Paços de Ferreira", municipio: "PAÇOS DE FERREIRA", parcels: 320 },
  { slug: "palmela", name: "Palmela", municipio: "PALMELA", parcels: 535 },
  { slug: "pampilhosa-da-serra", name: "Pampilhosa da Serra", municipio: "PAMPILHOSA DA SERRA", parcels: 594 },
  { slug: "paredes", name: "Paredes", municipio: "PAREDES", parcels: 1239 },
  { slug: "paredes-de-coura", name: "Paredes de Coura", municipio: "PAREDES DE COURA", parcels: 1489 },
  { slug: "pedrogao-grande", name: "Pedrógão Grande", municipio: "PEDRÓGÃO GRANDE", parcels: 1748 },
  { slug: "penacova", name: "Penacova", municipio: "PENACOVA", parcels: 851 },
  { slug: "penafiel", name: "Penafiel", municipio: "PENAFIEL", parcels: 857 },
  { slug: "penalva-do-castelo", name: "Penalva do Castelo", municipio: "PENALVA DO CASTELO", parcels: 433 },
  { slug: "penamacor", name: "Penamacor", municipio: "PENAMACOR", parcels: 594 },
  { slug: "penedono", name: "Penedono", municipio: "PENEDONO", parcels: 690 },
  { slug: "penela", name: "Penela", municipio: "PENELA", parcels: 618 },
  { slug: "peniche", name: "Peniche", municipio: "PENICHE", parcels: 189 },
  { slug: "peso-da-regua", name: "Peso da Régua", municipio: "PESO DA RÉGUA", parcels: 126 },
  { slug: "pinhel", name: "Pinhel", municipio: "PINHEL", parcels: 676 },
  { slug: "pombal", name: "Pombal", municipio: "POMBAL", parcels: 3876 },
  { slug: "ponte-da-barca", name: "Ponte da Barca", municipio: "PONTE DA BARCA", parcels: 545 },
  { slug: "ponte-de-lima", name: "Ponte de Lima", municipio: "PONTE DE LIMA", parcels: 2473 },
  { slug: "ponte-de-sor", name: "Ponte de Sor", municipio: "PONTE DE SOR", parcels: 4759 },
  { slug: "portalegre", name: "Portalegre", municipio: "PORTALEGRE", parcels: 1646 },
  { slug: "portel", name: "Portel", municipio: "PORTEL", parcels: 204 },
  { slug: "portimao", name: "Portimão", municipio: "PORTIMÃO", parcels: 315 },
  { slug: "porto", name: "Porto", municipio: "PORTO", parcels: 800 },
  { slug: "porto-de-mos", name: "Porto de Mós", municipio: "PORTO DE MÓS", parcels: 884 },
  { slug: "povoa-de-lanhoso", name: "Póvoa de Lanhoso", municipio: "PÓVOA DE LANHOSO", parcels: 656 },
  { slug: "povoa-de-varzim", name: "Póvoa de Varzim", municipio: "PÓVOA DE VARZIM", parcels: 582 },
  { slug: "proenca-a-nova", name: "Proença-A-Nova", municipio: "PROENÇA-A-NOVA", parcels: 1435 },
  { slug: "redondo", name: "Redondo", municipio: "REDONDO", parcels: 731 },
  { slug: "reguengos-de-monsaraz", name: "Reguengos de Monsaraz", municipio: "REGUENGOS DE MONSARAZ", parcels: 425 },
  { slug: "resende", name: "Resende", municipio: "RESENDE", parcels: 628 },
  { slug: "ribeira-de-pena", name: "Ribeira de Pena", municipio: "RIBEIRA DE PENA", parcels: 1328 },
  { slug: "rio-maior", name: "Rio Maior", municipio: "RIO MAIOR", parcels: 1113 },
  { slug: "sabrosa", name: "Sabrosa", municipio: "SABROSA", parcels: 472 },
  { slug: "sabugal", name: "Sabugal", municipio: "SABUGAL", parcels: 941 },
  { slug: "salvaterra-de-magos", name: "Salvaterra de Magos", municipio: "SALVATERRA DE MAGOS", parcels: 492 },
  { slug: "santa-comba-dao", name: "Santa Comba Dão", municipio: "SANTA COMBA DÃO", parcels: 1171 },
  { slug: "santa-maria-da-feira", name: "Santa Maria da Feira", municipio: "SANTA MARIA DA FEIRA", parcels: 2082 },
  { slug: "santa-marta-de-penaguiao", name: "Santa Marta de Penaguião", municipio: "SANTA MARTA DE PENAGUIÃO", parcels: 1130 },
  { slug: "santarem", name: "Santarém", municipio: "SANTARÉM", parcels: 1828 },
  { slug: "santiago-do-cacem", name: "Santiago do Cacém", municipio: "SANTIAGO DO CACÉM", parcels: 514 },
  { slug: "santo-tirso", name: "Santo Tirso", municipio: "SANTO TIRSO", parcels: 578 },
  { slug: "sao-bras-de-alportel", name: "São Brás de Alportel", municipio: "SÃO BRÁS DE ALPORTEL", parcels: 116 },
  { slug: "sao-joao-da-madeira", name: "São João da Madeira", municipio: "SÃO JOÃO DA MADEIRA", parcels: 88 },
  { slug: "sao-joao-da-pesqueira", name: "São João da Pesqueira", municipio: "SÃO JOÃO DA PESQUEIRA", parcels: 1287 },
  { slug: "sao-pedro-do-sul", name: "São Pedro do Sul", municipio: "SÃO PEDRO DO SUL", parcels: 1031 },
  { slug: "sardoal", name: "Sardoal", municipio: "SARDOAL", parcels: 229 },
  { slug: "satao", name: "Sátão", municipio: "SÁTÃO", parcels: 1007 },
  { slug: "seia", name: "Seia", municipio: "SEIA", parcels: 1993 },
  { slug: "seixal", name: "Seixal", municipio: "SEIXAL", parcels: 836 },
  { slug: "sernancelhe", name: "Sernancelhe", municipio: "SERNANCELHE", parcels: 407 },
  { slug: "serpa", name: "Serpa", municipio: "SERPA", parcels: 680 },
  { slug: "serta", name: "Sertã", municipio: "SERTÃ", parcels: 2929 },
  { slug: "sesimbra", name: "Sesimbra", municipio: "SESIMBRA", parcels: 126 },
  { slug: "setubal", name: "Setúbal", municipio: "SETÚBAL", parcels: 792 },
  { slug: "sever-do-vouga", name: "Sever do Vouga", municipio: "SEVER DO VOUGA", parcels: 831 },
  { slug: "silves", name: "Silves", municipio: "SILVES", parcels: 537 },
  { slug: "sines", name: "Sines", municipio: "SINES", parcels: 194 },
  { slug: "sintra", name: "Sintra", municipio: "SINTRA", parcels: 2154 },
  { slug: "sobral-de-monte-agraco", name: "Sobral de Monte Agraço", municipio: "SOBRAL DE MONTE AGRAÇO", parcels: 273 },
  { slug: "soure", name: "Soure", municipio: "SOURE", parcels: 657 },
  { slug: "sousel", name: "Sousel", municipio: "SOUSEL", parcels: 437 },
  { slug: "tabua", name: "Tábua", municipio: "TÁBUA", parcels: 673 },
  { slug: "tabuaco", name: "Tabuaço", municipio: "TABUAÇO", parcels: 392 },
  { slug: "tarouca", name: "Tarouca", municipio: "TAROUCA", parcels: 338 },
  { slug: "tavira", name: "Tavira", municipio: "TAVIRA", parcels: 428 },
  { slug: "terras-de-bouro", name: "Terras de Bouro", municipio: "TERRAS DE BOURO", parcels: 880 },
  { slug: "tomar", name: "Tomar", municipio: "TOMAR", parcels: 1378 },
  { slug: "tondela", name: "Tondela", municipio: "TONDELA", parcels: 1333 },
  { slug: "torre-de-moncorvo", name: "Torre de Moncorvo", municipio: "TORRE DE MONCORVO", parcels: 384 },
  { slug: "torres-novas", name: "Torres Novas", municipio: "TORRES NOVAS", parcels: 840 },
  { slug: "torres-vedras", name: "Torres Vedras", municipio: "TORRES VEDRAS", parcels: 2436 },
  { slug: "trancoso", name: "Trancoso", municipio: "TRANCOSO", parcels: 472 },
  { slug: "trofa", name: "Trofa", municipio: "TROFA", parcels: 221 },
  { slug: "vagos", name: "Vagos", municipio: "VAGOS", parcels: 352 },
  { slug: "vale-de-cambra", name: "Vale de Cambra", municipio: "VALE DE CAMBRA", parcels: 744 },
  { slug: "valenca", name: "Valença", municipio: "VALENÇA", parcels: 2612 },
  { slug: "valongo", name: "Valongo", municipio: "VALONGO", parcels: 203 },
  { slug: "valpacos", name: "Valpaços", municipio: "VALPAÇOS", parcels: 1559 },
  { slug: "vendas-novas", name: "Vendas Novas", municipio: "VENDAS NOVAS", parcels: 364 },
  { slug: "viana-do-alentejo", name: "Viana do Alentejo", municipio: "VIANA DO ALENTEJO", parcels: 165 },
  { slug: "viana-do-castelo", name: "Viana do Castelo", municipio: "VIANA DO CASTELO", parcels: 2041 },
  { slug: "vidigueira", name: "Vidigueira", municipio: "VIDIGUEIRA", parcels: 268 },
  { slug: "vieira-do-minho", name: "Vieira do Minho", municipio: "VIEIRA DO MINHO", parcels: 280 },
  { slug: "vila-de-rei", name: "Vila de Rei", municipio: "VILA DE REI", parcels: 953 },
  { slug: "vila-do-bispo", name: "Vila do Bispo", municipio: "VILA DO BISPO", parcels: 379 },
  { slug: "vila-do-conde", name: "Vila do Conde", municipio: "VILA DO CONDE", parcels: 1376 },
  { slug: "vila-flor", name: "Vila Flor", municipio: "VILA FLOR", parcels: 471 },
  { slug: "vila-franca-de-xira", name: "Vila Franca de Xira", municipio: "VILA FRANCA DE XIRA", parcels: 765 },
  { slug: "vila-nova-da-barquinha", name: "Vila Nova da Barquinha", municipio: "VILA NOVA DA BARQUINHA", parcels: 49 },
  { slug: "vila-nova-de-cerveira", name: "Vila Nova de Cerveira", municipio: "VILA NOVA DE CERVEIRA", parcels: 548 },
  { slug: "vila-nova-de-famalicao", name: "Vila Nova de Famalicão", municipio: "VILA NOVA DE FAMALICÃO", parcels: 931 },
  { slug: "vila-nova-de-foz-coa", name: "Vila Nova de Foz Côa", municipio: "VILA NOVA DE FOZ CÔA", parcels: 365 },
  { slug: "vila-nova-de-gaia", name: "Vila Nova de Gaia", municipio: "VILA NOVA DE GAIA", parcels: 3520 },
  { slug: "vila-nova-de-paiva", name: "Vila Nova de Paiva", municipio: "VILA NOVA DE PAIVA", parcels: 409 },
  { slug: "vila-nova-de-poiares", name: "Vila Nova de Poiares", municipio: "VILA NOVA DE POIARES", parcels: 444 },
  { slug: "vila-pouca-de-aguiar", name: "Vila Pouca de Aguiar", municipio: "VILA POUCA DE AGUIAR", parcels: 1895 },
  { slug: "vila-real", name: "Vila Real", municipio: "VILA REAL", parcels: 1055 },
  { slug: "vila-real-de-santo-antonio", name: "Vila Real de Santo António", municipio: "VILA REAL DE SANTO ANTÓNIO", parcels: 176 },
  { slug: "vila-velha-de-rodao", name: "Vila Velha de Ródão", municipio: "VILA VELHA DE RÓDÃO", parcels: 379 },
  { slug: "vila-verde", name: "Vila Verde", municipio: "VILA VERDE", parcels: 2376 },
  { slug: "vila-vicosa", name: "Vila Viçosa", municipio: "VILA VIÇOSA", parcels: 405 },
  { slug: "vimioso", name: "Vimioso", municipio: "VIMIOSO", parcels: 741 },
  { slug: "vinhais", name: "Vinhais", municipio: "VINHAIS", parcels: 763 },
  { slug: "viseu", name: "Viseu", municipio: "VISEU", parcels: 2078 },
  { slug: "vizela", name: "Vizela", municipio: "VIZELA", parcels: 186 },
  { slug: "vouzela", name: "Vouzela", municipio: "VOUZELA", parcels: 779 },
];

/**
 * One municipality's land-use regime, cut out of the national layer by the
 * attribute the service makes queryable. Read as attributes alone: Lisbon's 861
 * parcels carry nineteen megabytes of outline between them, and a municipality
 * with five thousand parcels would carry a hundred.
 */
function crusFeed(municipality: CrusMunicipality): ExampleFeed {
  return {
    slug: `dgt-crus-${municipality.slug}-feed`,
    title: `${municipality.name} land-use regime (CRUS)`,
    description:
      `Every parcel the Carta do Regime de Uso do Solo gives ${municipality.name} — ${municipality.parcels.toLocaleString("en")} of them — with the class and category of soil the municipal plan puts it in, ` +
      "the designation the plan uses, its area in hectares, the scale it was drawn at, where DGT took it from, whether the plan behind it is still in force, and the deposit reference and publication date of that plan. Attributes only, without parcel outlines.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "crus",
      geometry: "skip",
      filterField: "municipio",
      filterValue: municipality.municipio,
      pageSize: "1000",
      maxPages: String(Math.max(4, Math.ceil(municipality.parcels / 1000) + 2)),
    },
    policy: {
      name: "CRUS weekly municipal register",
      version: 1,
      collection: {
        // A municipal plan is revised over years, not weeks; weekly is here to
        // catch the republication within days of it happening, and one
        // municipality is a second of the service's time either way.
        cadenceSeconds: WEEK,
        timeoutSeconds: 180,
        maxBytes: 16 * MEBIBYTE,
        historyMode: "changes",
      } satisfies CollectionPolicyDefinition,
      serving: dgtServing("Carta do Regime de Uso do Solo"),
    },
    // Two reads' grace, as the registers have: a month of silence on a weekly
    // feed is an outage worth showing, not a plan that has simply not changed.
    staleAfterSeconds: 2 * WEEK,
    publisher: "dgt",
    topics: ["cities", "government"],
  };
}

/*
 * LNEG runs its own pygeoapi at `ogcapi.lneg.pt`, whose landing page states
 * CC BY 4.0 the same way DGT's does. These five are its collections that read
 * as tables rather than as INSPIRE plumbing: the harmonised 1:200,000 layers
 * are the same geology under column names the service truncates to
 * `..._representativeli_2`, which no reader can use.
 *
 * All five carry their geometry: the three point layers cost under half a
 * kilobyte a feature, and the two that do not are small enough in count to
 * make up for it.
 */
interface LnegLayer {
  slug: string;
  collection: string;
  title: string;
  description: string;
  features: number;
  topics: NonNullable<ExampleFeed["topics"]>;
  maxBytes: number;
}

const LNEG_LAYERS: LnegLayer[] = [
  {
    slug: "lneg-ocorrencias-minerais-feed",
    collection: "siorminp-mineral-occurrences",
    title: "Mineral occurrences in Portugal",
    description:
      "The 5,483 mineral occurrences in LNEG's national inventory: where each one is, what it holds, its geological description, its size, and how it rates for economic and development potential.",
    features: 5483,
    topics: ["economy", "environment"],
    maxBytes: 12 * MEBIBYTE,
  },
  {
    slug: "lneg-sondagens-feed",
    collection: "sondabase-sondagem",
    title: "Boreholes in the national database",
    description: "The 3,497 boreholes in LNEG's SondaBase: where each was drilled, its name, its length, the elevation it started from and the direction it took.",
    features: 3497,
    topics: ["environment", "economy"],
    maxBytes: 4 * MEBIBYTE,
  },
  {
    slug: "lneg-pontos-de-agua-feed",
    collection: "recursoshidro-pontos-de-gua",
    title: "Groundwater points",
    description:
      "The 5,399 water points in LNEG's groundwater inventory: where each is, the district it lies in, its elevation, what kind of point it is, what it is used for and what it was surveyed for.",
    features: 5399,
    topics: ["environment"],
    maxBytes: 4 * MEBIBYTE,
  },
  {
    slug: "lneg-sistemas-aquiferos-feed",
    collection: "recursoshidro-sistemas-aqu-feros",
    title: "Aquifer systems",
    description:
      "The 63 aquifer systems of Portugal as LNEG delimits them, with their outlines, the national code each carries, the geological age of the rock that holds the water and the hydrogeological unit each belongs to.",
    features: 63,
    topics: ["environment"],
    maxBytes: 4 * MEBIBYTE,
  },
  {
    slug: "lneg-falhas-geologicas-feed",
    collection: "cgp1m-ge-geologicfault",
    title: "Geological faults at 1:1,000,000",
    description: "The 297 faults of the harmonised 1:1,000,000 geological map of Portugal, each with the kind of fault it is and the vocabulary term LNEG classifies it under.",
    features: 297,
    topics: ["environment"],
    maxBytes: 4 * MEBIBYTE,
  },
];

function lnegFeed(layer: LnegLayer): ExampleFeed {
  return {
    slug: layer.slug,
    title: layer.title,
    description: layer.description,
    config: {
      source: "ogc",
      host: "ogcapi.lneg.pt",
      collection: layer.collection,
      geometry: "include",
      pageSize: "500",
      maxPages: String(Math.max(4, Math.ceil(layer.features / 500) + 2)),
    },
    policy: {
      name: "LNEG monthly reference layer",
      version: 1,
      collection: {
        // Geology is not news. Monthly is often enough to catch an inventory
        // being extended, and asks the service for one walk every four weeks.
        cadenceSeconds: 2_592_000,
        timeoutSeconds: 300,
        maxBytes: layer.maxBytes,
        historyMode: "changes",
      } satisfies CollectionPolicyDefinition,
      serving: {
        // The service's HTML landing page states CC BY 4.0, exactly as DGT's does.
        licence: "cc-by-4.0",
        attribution: "Laboratório Nacional de Energia e Geologia",
      },
    },
    staleAfterSeconds: 2 * 2_592_000,
    publisher: "lneg",
    topics: layer.topics,
  };
}

export const OGC_EXAMPLES: ExampleFeed[] = [
  /*
   * DGT publishes the CAOP for Portugal Continental only: 18 districts, 278
   * municipalities and 3,049 parishes, with the Azores and Madeira absent from
   * these collections. Every title and description says so.
   *
   * They are collected without geometry. One district outline reaches 3.6 MB
   * and two municipal outlines pass 1 MB, which is the largest record the
   * platform stores; the whole municipal layer is 49 MB of coordinates that
   * would be re-read and re-compared on every collection. `skipGeometry` is a
   * documented OGC API Features parameter, the product page says the feed asks
   * for attributes only, and every feature is still published: the scope is
   * complete, only the shape is left at the source.
   */
  {
    slug: "dgt-caop-distritos-feed",
    title: "Mainland Portugal district reference table (CAOP 2025)",
    description:
      "The 18 districts of mainland Portugal in the official administrative charter: code, name, NUTS 1 region, area, perimeter, and how many municipalities and parishes each holds. Attributes only, without boundary outlines. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "distritos",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "5",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 4 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-municipios-feed",
    title: "Mainland Portugal municipality reference table (CAOP 2025)",
    description:
      "The 278 municipalities of mainland Portugal in the official administrative charter: DTMN code, name, district, the three NUTS levels, area, perimeter, and parish count. Attributes only, without boundary outlines. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "municipios",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "5",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 4 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-freguesias-feed",
    title: "Mainland Portugal parish reference table (CAOP 2025)",
    description:
      "The 3,049 civil parishes of mainland Portugal in the official administrative charter: DTMNFR code, name, municipality, district, the three NUTS levels, area and perimeter. Attributes only, without boundary outlines. The Azores and Madeira are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "freguesias",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "5",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 8 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  /*
   * The `admin` collection is deliberately not read. It holds the same 3,049
   * parishes split into their 3,392 disjoint parts, which is a difference in
   * outline — and these feeds carry no outlines. Without them it would republish
   * every parish's code, name, municipality and NUTS levels a second time.
   */
  {
    slug: "dgt-caop-nuts2-feed",
    title: "Mainland Portugal NUTS II reference table (CAOP 2025)",
    description:
      "The seven NUTS II regions the charter covers, with the code, the area in hectares, the perimeter and how many municipalities and parishes each holds. The Azores and Madeira appear here as regions of the statistical hierarchy, though their areas are not part of this collection.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "nuts2",
      geometry: "skip",
      pageSize: "100",
      maxPages: "4",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-nuts3-feed",
    title: "Mainland Portugal NUTS III reference table (CAOP 2025)",
    description:
      "The 24 NUTS III sub-regions of mainland Portugal, with the code, the NUTS II region and NUTS I level above them, the area in hectares, the perimeter, and how many municipalities and parishes each holds.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "nuts3",
      geometry: "skip",
      pageSize: "100",
      maxPages: "4",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },
  {
    slug: "dgt-caop-trocos-feed",
    title: "Mainland Portugal administrative boundary segments (CAOP 2025)",
    description:
      "The 9,899 segments the administrative boundaries of mainland Portugal are drawn from: which area lies either side of each one, whether it runs on land or along the coast, the order of boundary it carries, whether it is settled or still undefined, and how long it is. Attributes only, without the lines themselves.",
    config: {
      source: "ogc",
      host: DGT_HOST,
      collection: "trocos",
      geometry: "skip",
      pageSize: "1000",
      maxPages: "14",
    },
    policy: attributePolicy("OGC weekly attribute table", DGT_SERVING, 8 * MEBIBYTE),
    staleAfterSeconds: 1_209_600,
    publisher: "dgt",
    topics: ["society"],
  },

  ...SRUP_LAYERS.map(srupFeed),
  ...CRUS_MUNICIPALITIES.map(crusFeed),
  ...LNEG_LAYERS.map(lnegFeed),

  /*
   * The eight Azores collections that lived here were removed in September 2026.
   * ambiente.azores.gov.pt sits behind a Cloudflare managed challenge that answers
   * our Workers with 403 and `cf-mitigated: challenge` on every request, whatever
   * user agent they send, so not one of those feeds ever collected. A publication
   * hold is per library and would have taken the DGT feeds down with them, so the
   * examples go instead and the Registry retires the eight feeds. Restoring them
   * needs the regional government to let our traffic through — a WAF skip rule for
   * the IDEA API paths, or a documented token — after which these entries come back
   * against host `ambiente.azores.gov.pt`, base path `idea-api`, collections Farois,
   * Operadores_GestaoResiduos, RedeMonitorizacao_QualidadeAr, Rede_Hidrometeorologica,
   * Lagoas, Zonas_EspeciaisConservacao, Geositios and Parques_NaturaisIlha, under
   * CC BY 4.0 with the same slugs, which their history depends on:
   * azores-farois-feed, azores-operadores-residuos-feed, azores-estacoes-qualidade-ar-feed,
   * azores-rede-hidrometeorologica-feed, azores-lagoas-feed,
   * azores-zonas-especiais-conservacao-feed, azores-geossitios-feed and
   * azores-parques-naturais-feed.
   */
];
