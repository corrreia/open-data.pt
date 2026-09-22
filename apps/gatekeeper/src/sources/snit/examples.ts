import { SNIT_TYPES, type SnitType } from "./snit";

import type { ExampleFeed } from "../../index";

const MEBIBYTE = 1024 * 1024;
const WEEK = 604_800;

/**
 * One feed per kind of instrument the register holds. The register is queried
 * a type at a time because asking for every type at once never answers: the
 * type is the seam the API itself offers.
 *
 * `timeoutSeconds` and `maxBytes` come from reading each type once: the master
 * plans are 278 instruments, 6.3 MB and 85 seconds; the detail plans are 687
 * instruments and 102 seconds; every other type answers in under six.
 */
interface SnitRegister {
  type: SnitType;
  /** What the feed is called, where the type's own name is not it. */
  title: string;
  /** The sentence after the title, saying what this kind of instrument does. */
  summary: string;
  topics: NonNullable<ExampleFeed["topics"]>;
  /** Measured, and what the description promises. */
  instruments: number;
  acts: number;
  /** Measured wall time with room for a bad day; the floor is two minutes. */
  timeoutSeconds?: number;
  maxBytes?: number;
}

const REGISTERS: SnitRegister[] = [
  {
    type: "pdm",
    title: "Municipal master plans",
    summary: "The plan every municipality must have, classifying all of its land and setting the rules that bind every other plan beneath it",
    topics: ["cities", "government"],
    instruments: 278,
    acts: 1715,
    timeoutSeconds: 600,
    maxBytes: 16 * MEBIBYTE,
  },
  {
    type: "pp",
    title: "Detail plans",
    summary: "Plans that fix, street by street and plot by plot, what may be built in one part of a municipality",
    topics: ["cities", "government"],
    instruments: 687,
    acts: 1248,
    timeoutSeconds: 600,
    maxBytes: 8 * MEBIBYTE,
  },
  {
    type: "pu",
    title: "Urbanisation plans",
    summary: "Plans that set the layout and use of an urban area between the master plan above them and the detail plans below",
    topics: ["cities", "government"],
    instruments: 171,
    acts: 445,
    timeoutSeconds: 300,
  },
  {
    type: "piot",
    title: "Intermunicipal spatial plans",
    summary: "Plans drawn by neighbouring municipalities together for territory they share",
    topics: ["cities", "government"],
    instruments: 2,
    acts: 2,
  },
  {
    type: "pnpot",
    title: "National spatial policy programme",
    summary: "The programme at the head of the whole system, which every plan below it must follow",
    topics: ["government"],
    instruments: 1,
    acts: 1,
  },
  {
    type: "prot-programa",
    title: "Regional spatial programmes",
    summary: "The regional tier that turns national policy into rules the municipal plans answer to",
    topics: ["government"],
    instruments: 2,
    acts: 4,
  },
  {
    type: "prot-plano",
    title: "Regional spatial plans",
    summary: "The older regional tier, still in force where the programme that replaces it has not yet been published",
    topics: ["government"],
    instruments: 6,
    acts: 10,
  },
  {
    type: "medidas-preventivas",
    title: "Preventive measures",
    summary: "Temporary restrictions that freeze what may be done to a piece of land while a plan for it is being drawn",
    topics: ["cities", "government"],
    instruments: 3,
    acts: 4,
  },
  {
    type: "prgp",
    title: "Landscape reordering and management programmes",
    summary: "Programmes that reshape the landscape of a defined area, most of them drawn after the 2017 fires",
    topics: ["environment", "government"],
    instruments: 20,
    acts: 40,
  },
  {
    type: "peap",
    title: "Protected area programmes",
    summary: "The programme tier that governs what may happen inside a classified protected area",
    topics: ["environment", "government"],
    instruments: 1,
    acts: 3,
  },
  {
    type: "poap",
    title: "Protected area plans",
    summary: "The older plan tier for protected areas, still in force where no programme has replaced it",
    topics: ["environment", "government"],
    instruments: 25,
    acts: 38,
  },
  {
    type: "paap",
    title: "Public water reservoir programmes",
    summary: "The programme tier governing the shores and waters of a classified public reservoir",
    topics: ["environment", "energy"],
    instruments: 1,
    acts: 2,
  },
  {
    type: "poaap",
    title: "Public water reservoir plans",
    summary: "The older plan tier for classified public reservoirs, one per reservoir",
    topics: ["environment", "energy"],
    instruments: 41,
    acts: 52,
    timeoutSeconds: 180,
  },
  {
    type: "poc",
    title: "Coastal zone programmes",
    summary: "Programmes governing the shoreline and the strip of land behind it, stretch by stretch of coast",
    topics: ["environment", "government"],
    instruments: 4,
    acts: 7,
  },
  {
    type: "pooc",
    title: "Coastal zone plans",
    summary: "The older plan tier for the shoreline, still in force where no programme has replaced it",
    topics: ["environment", "government"],
    instruments: 5,
    acts: 14,
  },
  {
    type: "pna",
    title: "National water plan",
    summary: "The national plan for the country's water, above the river basin plans",
    topics: ["environment", "government"],
    instruments: 1,
    acts: 1,
  },
  {
    type: "pgrh",
    title: "River basin management plans",
    summary: "One plan per river basin district, setting what must be done for the water in it",
    topics: ["environment", "government"],
    instruments: 8,
    acts: 8,
  },
  {
    type: "pgri",
    title: "Flood risk management plans",
    summary: "One plan per river basin district for the places floods reach and what is to be done about them",
    topics: ["environment", "government"],
    instruments: 8,
    acts: 8,
  },
  {
    type: "pszaer",
    title: "Renewable energy acceleration zones programme",
    summary: "The sectoral programme marking out where renewable generation may be built under a faster licensing route",
    topics: ["energy", "government"],
    instruments: 1,
    acts: 1,
  },
  {
    type: "rede-natura",
    title: "Natura 2000 sectoral plan",
    summary: "The sectoral plan for the Portuguese sites of the European Natura 2000 network",
    topics: ["environment", "government"],
    instruments: 1,
    acts: 1,
  },
  {
    type: "prof",
    title: "Regional forest programmes",
    summary: "The regional programmes setting what the forest of each region is managed for",
    topics: ["environment", "government"],
    instruments: 7,
    acts: 27,
  },
  {
    type: "paqat",
    title: "Transitional-waters aquaculture plan",
    summary: "The national plan for aquaculture in estuaries and lagoons",
    topics: ["economy", "environment"],
    instruments: 1,
    acts: 2,
  },
  {
    type: "prn",
    title: "National road plan",
    summary: "The plan that defines the national road network itself",
    topics: ["mobility", "government"],
    instruments: 1,
    acts: 4,
  },
  {
    type: "pfn",
    title: "National railway plan",
    summary: "The plan that defines the national railway network itself",
    topics: ["mobility", "government"],
    instruments: 1,
    acts: 1,
  },
];

function snitExample(register: SnitRegister): ExampleFeed {
  const type = SNIT_TYPES[register.type];
  const plural = register.instruments === 1 ? "it" : "each of them";
  return {
    slug: `snit-${register.type}-feed`,
    title: register.title,
    description:
      `${register.summary}. Every ${type.name} (${type.abbreviation}) the national register holds as being in force — ${register.instruments} of them at the last reading — with the municipalities ` +
      `${plural} covers, and separately every act of the Diário da República behind them: the notice, resolution or decree, the issue it appeared in, the day it was published, ` +
      "what it changed, its deposit reference and a link to the act itself.",
    config: { source: "snit", feed: "instruments", type: register.type },
    policy: {
      name: "SNIT weekly register",
      version: 1,
      collection: {
        // An act reaches the register when it is published in the Diário da
        // República — a few a month across the whole system. Weekly catches one
        // within days; the master plans, the slowest query here, cost the
        // register about ninety seconds of work for that.
        cadenceSeconds: WEEK,
        timeoutSeconds: register.timeoutSeconds ?? 120,
        maxBytes: register.maxBytes ?? 4 * MEBIBYTE,
        maxRecordBytes: 256 * 1024,
        maxRecords: 20_000,
        historyMode: "changes",
      },
      serving: {
        licence: "cc-by",
        attribution: "Direção-Geral do Território — Sistema Nacional de Informação Territorial",
      },
    },
    // Two weeks: an act published the day after a run should not make the feed
    // look stale before the next run has had its chance at it.
    staleAfterSeconds: 2 * WEEK,
    publisher: "dgt",
    topics: register.topics,
  };
}

export const SNIT_EXAMPLES: ExampleFeed[] = REGISTERS.map(snitExample);
