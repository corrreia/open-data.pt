import type { ExampleFeed, Licence } from "../../index";

const MEBIBYTE = 1024 * 1024;
const MONTH = 2_592_000;

const CDD_HOST = "cdd.dgterritorio.gov.pt";
/** The Centro de Dados serves its catalogue through a proxy in front of the STAC API. */
const CDD_BASE_PATH = "dgt-be/v1";

/**
 * One coverage of DGT's Centro de Dados, as a tile index.
 *
 * What is published is the catalogue, never the imagery: every asset sits in a
 * private store that answers an anonymous request with 403, and a download
 * needs an account with DGT. A row says what one tile covers, how finely, in
 * what bands and how large the file is — which is what makes the coverage
 * searchable without moving a terabyte of pixels.
 *
 * The licence differs by coverage, and is taken from each one's own record in
 * the national catalogue rather than from the API, whose `license` field reads
 * `proprietary` on all 80 collections. That is the STAC spec's word for "not an
 * SPDX identifier", to be read with a licence link the catalogue never sets —
 * an unfilled field, not a reservation of rights. The records themselves are
 * explicit: the 2025 and 2018 coverages and the LiDAR carry CC BY 4.0, while
 * the seven older coverages say the viewing service is unrestricted but the
 * image files are supplied against a quotation.
 */
interface Coverage {
  slug: string;
  collection: string;
  title: string;
  /** What the coverage is, and when it was flown, which is a property of the coverage. */
  description: string;
  /** Measured by walking the collection once. */
  tiles: number;
  licence: Licence;
  topics: NonNullable<ExampleFeed["topics"]>;
}

const CC_BY: Licence = "cc-by-4.0";
const QUOTED: Licence = "dgt-imagery-quote";

const COVERAGES: Coverage[] = [
  {
    slug: "dgt-ortofotos-2025",
    collection: "ORTOS-2025",
    title: "Orthophoto tile index 2025 (25 cm)",
    description:
      "Every one of the 2,454 tiles of the 2025 orthophoto coverage of mainland Portugal, flown between 29 March and 26 July 2025 at 25 cm on the ground in red, green, blue and near infrared: what each tile covers, its size in pixels, its bands, its coordinate system and the file it is published as. The index, not the imagery: downloading a tile needs an account with DGT.",
    tiles: 2454,
    licence: CC_BY,
    topics: ["environment", "society"],
  },
  {
    slug: "dgt-ortofotos-2021",
    collection: "ORTOS-2021",
    title: "Orthophoto tile index 2021 (25 cm)",
    description:
      "The 1,264 tiles of the 2021 orthophoto coverage of mainland Portugal at 25 cm, which covers part of the country rather than all of it: what each tile covers, its size, its bands and the file it is published as. The index, not the imagery.",
    tiles: 1264,
    licence: QUOTED,
    topics: ["environment", "society"],
  },
  {
    slug: "dgt-ortofotos-2018",
    collection: "ORTOS-2018",
    title: "Orthophoto tile index 2018 (25 cm)",
    description:
      "The 2,435 tiles of the 2018 orthophoto coverage of mainland Portugal at 25 cm in four bands: what each tile covers, its size, its bands and the file it is published as. The index, not the imagery.",
    tiles: 2435,
    licence: CC_BY,
    topics: ["environment", "society"],
  },
  {
    slug: "dgt-ortofotos-2015",
    collection: "ORTOS-2015",
    title: "Orthophoto tile index 2015 (50 cm)",
    description:
      "The 2,436 tiles of the 2015 orthophoto coverage of mainland Portugal at 50 cm: what each tile covers, its size, its bands and the file it is published as. The index, not the imagery.",
    tiles: 2436,
    licence: QUOTED,
    topics: ["environment", "society"],
  },
  {
    slug: "dgt-ortofotos-2012",
    collection: "ORTOS-2012",
    title: "Orthophoto tile index 2012 (50 cm)",
    description:
      "The 2,438 tiles of the 2012 orthophoto coverage of mainland Portugal at 50 cm: what each tile covers, its size, its bands and the file it is published as. The index, not the imagery.",
    tiles: 2438,
    licence: QUOTED,
    topics: ["environment", "society"],
  },
  {
    slug: "dgt-ortofotos-2010",
    collection: "ORTOS-2010",
    title: "Orthophoto tile index 2010 (50 cm)",
    description:
      "The 2,440 tiles of the 2010 orthophoto coverage of mainland Portugal at 50 cm: what each tile covers, its size, its bands and the file it is published as. The index, not the imagery.",
    tiles: 2440,
    licence: QUOTED,
    topics: ["environment", "society"],
  },
  {
    slug: "dgt-ortofotos-2007",
    collection: "ORTOS-2007",
    title: "Orthophoto tile index 2007 (50 cm)",
    description:
      "The 2,442 tiles of the 2007 orthophoto coverage of mainland Portugal at 50 cm: what each tile covers, its size, its bands and the file it is published as. The index, not the imagery.",
    tiles: 2442,
    licence: QUOTED,
    topics: ["environment", "society"],
  },
  {
    slug: "dgt-ortofotos-2004-2006",
    collection: "ORTOS-2004",
    title: "Orthophoto tile index 2004–2006 (50 cm)",
    description:
      "The 2,448 tiles of the orthophoto coverage of mainland Portugal flown between 2004 and 2006 at 50 cm: what each tile covers, its size, its bands and the file it is published as. The index, not the imagery.",
    tiles: 2448,
    licence: QUOTED,
    topics: ["environment", "society"],
  },
  {
    slug: "dgt-ortofotos-1995",
    collection: "ORTOS-1995",
    title: "Orthophoto tile index 1995 (1 m)",
    description:
      "The 2,451 tiles of the 1995 orthophoto coverage of mainland Portugal at one metre in false colour, the oldest coverage the Centro de Dados holds: what each tile covers, its size, its bands and the file it is published as. The index, not the imagery.",
    tiles: 2451,
    licence: QUOTED,
    topics: ["environment", "society"],
  },
];

function coverageFeed(coverage: Coverage): ExampleFeed {
  return {
    slug: `${coverage.slug}-feed`,
    title: coverage.title,
    description: coverage.description,
    config: {
      source: "stac",
      host: CDD_HOST,
      basePath: CDD_BASE_PATH,
      collection: coverage.collection,
      // The proxy refuses more than 200 an answer, and says so.
      pageSize: "200",
      maxPages: String(Math.ceil(coverage.tiles / 200) + 3),
    },
    policy: {
      name: "Centro de Dados coverage index",
      version: 1,
      collection: {
        // A coverage is flown once and then does not change. Monthly is there to
        // notice a new one appearing or a tile being replaced, and costs the
        // service about a dozen requests.
        cadenceSeconds: MONTH,
        timeoutSeconds: 300,
        maxBytes: 32 * MEBIBYTE,
        maxRecordBytes: 32 * 1024,
        maxRecords: 20_000,
        historyMode: "changes",
      },
      serving: {
        licence: coverage.licence,
        attribution: "Informação geográfica cedida pela Direção-Geral do Território",
      },
    },
    // Two reads' grace on a monthly walk.
    staleAfterSeconds: 2 * MONTH,
    publisher: "dgt",
    topics: coverage.topics,
  };
}

export const STAC_EXAMPLES: ExampleFeed[] = COVERAGES.map(coverageFeed);
