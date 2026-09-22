import type { SnitType } from "./snit";

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
  /** The dataset this one register is the whole of, a key of `DATASETS`. */
  dataset: string;
  /** Measured wall time with room for a bad day; the floor is two minutes. */
  timeoutSeconds?: number;
  maxBytes?: number;
}

const REGISTERS: SnitRegister[] = [
  { type: "pdm", dataset: "dgt-snit-pdm", timeoutSeconds: 600, maxBytes: 16 * MEBIBYTE },
  { type: "pp", dataset: "dgt-snit-pp", timeoutSeconds: 600, maxBytes: 8 * MEBIBYTE },
  { type: "pu", dataset: "dgt-snit-pu", timeoutSeconds: 300 },
  { type: "piot", dataset: "dgt-snit-piot" },
  { type: "pnpot", dataset: "dgt-snit-pnpot" },
  { type: "prot-programa", dataset: "dgt-snit-prot-programa" },
  { type: "prot-plano", dataset: "dgt-snit-prot-plano" },
  { type: "medidas-preventivas", dataset: "dgt-snit-medidas-preventivas" },
  { type: "prgp", dataset: "dgt-snit-prgp" },
  { type: "peap", dataset: "dgt-snit-peap" },
  { type: "poap", dataset: "dgt-snit-poap" },
  { type: "paap", dataset: "dgt-snit-paap" },
  { type: "poaap", dataset: "dgt-snit-poaap", timeoutSeconds: 180 },
  { type: "poc", dataset: "dgt-snit-poc" },
  { type: "pooc", dataset: "dgt-snit-pooc" },
  { type: "pna", dataset: "dgt-snit-pna" },
  { type: "pgrh", dataset: "dgt-snit-pgrh" },
  { type: "pgri", dataset: "dgt-snit-pgri" },
  { type: "pszaer", dataset: "dgt-snit-pszaer" },
  { type: "rede-natura", dataset: "dgt-snit-rede-natura" },
  { type: "prof", dataset: "dgt-snit-prof" },
  { type: "paqat", dataset: "dgt-snit-paqat" },
  { type: "prn", dataset: "dgt-snit-prn" },
  { type: "pfn", dataset: "dgt-snit-pfn" },
];

function snitExample(register: SnitRegister): ExampleFeed {
  return {
    slug: `snit-${register.type}-feed`,
    dataset: register.dataset,
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
    },
    // Two weeks: an act published the day after a run should not make the feed
    // look stale before the next run has had its chance at it.
    staleAfterSeconds: 2 * WEEK,
  };
}

export const SNIT_EXAMPLES: ExampleFeed[] = REGISTERS.map(snitExample);
