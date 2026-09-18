import type { Acquisition, AcquisitionStatus, FeedStatus } from "./feed-model";
import type { Outage, OutageCause, RegistryStore } from "./registry-store";

/**
 * What a runner tells the Registry when an acquisition ends: its status and its
 * latest acquisitions, for the activity mirror. Reports are idempotent upserts,
 * so a lost one is repaired by the next.
 */
export interface RunnerReport {
  feedId: string;
  library: string;
  status: FeedStatus;
  acquisitions: Acquisition[];
}

export interface RunnerReportReceipt {
  known: boolean;
  backfillPeers: number;
  /**
   * The feed is unknown and the Registry has applied every example the Gatekeeper lists,
   * so no install is on its way: the runner is a ghost and retires itself.
   */
  retire?: boolean;
}

const MAX_ACQUISITIONS = 20;

/** Caller MUST wrap this in one synchronous storage transaction. */
export function ingestRunnerReport(store: RegistryStore, report: RunnerReport, at: string): RunnerReportReceipt {
  const since = new Date(Date.parse(at) - 15 * 60_000).toISOString();
  if (!store.getFeed(report.feedId)) return { known: false, backfillPeers: 0 };
  store.setFeedStatus(report.feedId, report.status, at);
  trackCollectionGap(store, at);
  trackOutage(store, report);
  for (const acquisition of report.acquisitions.slice(0, MAX_ACQUISITIONS)) {
    store.upsertActivity(acquisition.id, report.feedId, acquisition.completedAt ?? acquisition.requestedAt, { ...acquisition, feedId: report.feedId });
  }
  if (report.status.backfill) store.setBackfill(report.feedId, report.library, report.status.backfill.status, report.status.backfill.updatedAt);
  // Peers only pace a walk in progress; a runner without one needs no count.
  const walking = report.status.backfill?.status === "running";
  return { known: true, backfillPeers: walking ? store.countRunningBackfills(report.library, since) : 1 };
}

/* ---------- Outages ---------- */

/** Real-time feeds report every minute, failures included; this long without any report means the platform stopped collecting. */
export const COLLECTION_GAP_MS = 10 * 60_000;
/** Keep outage records independently of the status page's shorter display window. */
export const OUTAGE_KEEP_MS = 120 * 86_400_000;
export const OUTAGES_SINCE_KEY = "outagesSince";
/** A feed's failure is downtime once it has repeated and lasted this long; one missed collection the next one repairs is a blip. */
export const OUTAGE_MIN_FAILURES = 2;
export const OUTAGE_MIN_MS = 10 * 60_000;

/** Real downtime rather than a blip: a platform gap always is; a feed's failure has to repeat and last ten minutes. */
export function isSustained(outage: Outage, now: string): boolean {
  if (outage.cause === "platform") return true;
  const end = Date.parse(outage.endedAt ?? now);
  return outage.failures >= OUTAGE_MIN_FAILURES && end - Date.parse(outage.startedAt) >= OUTAGE_MIN_MS;
}
const LAST_REPORT_KEY = "lastReportAt";
const FINISHED = new Set<AcquisitionStatus>(["succeeded", "unchanged", "failed"]);
/** Failures that are the source's: it did not answer, refused, or was too slow. Anything else is this platform's to fix. */
const SOURCE_FAILURES = new Set(["upstream-error", "source-denied", "deadline-exceeded"]);

export interface OutageWindow {
  /** When tracking began; nothing is known before it. */
  trackedSince: string | null;
  items: Outage[];
}

export function outageCause(error: string | undefined): OutageCause {
  const code = /Gatekeeper collection failed: ([a-z-]+)/.exec(error ?? "")?.[1];
  return code !== undefined && SOURCE_FAILURES.has(code) ? "source" : "collection";
}

/** A gap is only known once reports resume, so it is recorded then, from the last report before it. */
function trackCollectionGap(store: RegistryStore, at: string): void {
  if (store.getState<string>(OUTAGES_SINCE_KEY) === undefined) store.setState(OUTAGES_SINCE_KEY, at);
  const last = store.getState<string>(LAST_REPORT_KEY);
  if (last !== undefined && Date.parse(at) - Date.parse(last) > COLLECTION_GAP_MS) store.recordGap(last, at);
  // At most one write a minute: a gap shorter than that is not one.
  if (last?.slice(0, 16) !== at.slice(0, 16)) store.setState(LAST_REPORT_KEY, at);
}

const finishedAt = (acquisition: Acquisition): string => acquisition.completedAt ?? acquisition.requestedAt;

/**
 * An outage runs from a feed's first failed live collection to its next success. History walks are left
 * out: a failed walk says nothing about whether the feed is being collected now.
 */
function trackOutage(store: RegistryStore, report: RunnerReport): void {
  const live = report.acquisitions
    .filter((acquisition) => acquisition.trigger !== "history" && FINISHED.has(acquisition.status))
    .sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)));
  const newest = live[0];
  if (newest === undefined) return;
  const open = store.openOutage(report.feedId);
  if (newest.status === "failed") {
    const recovered = live.findIndex((acquisition) => acquisition.status !== "failed");
    const streak = recovered === -1 ? live : live.slice(0, recovered);
    const failures = Math.max(report.status.consecutiveFailures ?? 0, streak.length);
    const cause = outageCause(newest.error);
    const error = newest.error?.slice(0, 500);
    if (open) store.updateOutage(open.id, cause, Math.max(open.failures, failures), error);
    else store.startOutage(report.feedId, finishedAt(streak[streak.length - 1] ?? newest), cause, failures, error);
    return;
  }
  if (!open) return;
  // It ended at the first success after it began; the list may already hold later ones.
  const recovery = live.filter((acquisition) => acquisition.status !== "failed" && finishedAt(acquisition) >= open.startedAt).at(-1) ?? newest;
  store.endOutage(open.id, finishedAt(recovery));
}
