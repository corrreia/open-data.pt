import type { CollectionPolicyDefinition } from "../../index";

export const MEBIBYTE = 1024 * 1024;

export const HOUR = 3_600;
export const WEEK = 604_800;
export const MONTH = 2_592_000;

/**
 * What one walk of a layer was measured to cost, in mebibytes and kibibytes.
 *
 * These are read numbers, not estimates. The service matters here: pygeoapi
 * pretty-prints its JSON and sends it uncompressed — asking for gzip returns
 * none — so a layer's outlines cost the same over the wire as they do on disk,
 * about four times what the same features would take compactly. `source` is
 * therefore both what is downloaded and what the kernel's byte budget counts.
 */
export interface LayerSize {
  /** Mebibytes of JSON the whole walk reads from the service. */
  source: number;
  /** Mebibytes of normalized rows the walk produces. */
  output: number;
  /** Kibibytes of the largest single row, which sets the per-record ceiling. */
  largestRow: number;
}

/** Measured at about five mebibytes a second across every layer read, which is what the deadlines below assume. */
const SOURCE_MIB_PER_SECOND = 5;

/**
 * Budgets sized from a reading of the layer rather than guessed at.
 *
 * Each allowance is the measurement plus a third, which lets a register gain
 * rows between one reading and the next without letting a runaway response
 * through. The deadline is the download at the speed the service was measured
 * to send, doubled, and never under two minutes: a layer having a slow day
 * should not be cut off, but one that has stopped answering should be.
 */
export function measuredCollection(measured: LayerSize, cadenceSeconds: number): CollectionPolicyDefinition {
  const maxBytes = Math.ceil(measured.source * 1.34) * MEBIBYTE;
  return {
    cadenceSeconds,
    timeoutSeconds: Math.max(120, Math.ceil((measured.source / SOURCE_MIB_PER_SECOND) * 2)),
    maxBytes,
    maxOutputBytes: Math.max(MEBIBYTE, Math.ceil(measured.output * 1.34) * MEBIBYTE),
    // Doubled, because one row growing is a correction to a boundary rather
    // than a new feature, and capped at the megabyte the kernel stores whole.
    maxRecordBytes: Math.min(MEBIBYTE, Math.max(64 * 1024, Math.ceil(measured.largestRow * 2) * 1024)),
    historyMode: "changes",
  };
}

/*
 * The eight Azores collections that were read through this library were removed in September 2026.
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
