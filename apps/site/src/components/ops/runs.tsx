// One vocabulary for a run's outcome: the live log, a past day and the acquisitions table all say the same words.

import { Badge } from "@cloudflare/kumo";
import { apiGet } from "../../lib/api";
import { plural } from "../../lib/format";
import type { Acquisition, AcquisitionDay, AcquisitionStatus } from "../../lib/types";

/** The newest hundred acquisitions, of one feed or of all; the live log and the table share the unfiltered read. */
export const acquisitionsKey = (feedId: string) => `acquisitions:${feedId || "all"}`;
export const fetchAcquisitions = (feedId: string) =>
  apiGet<{ data: Acquisition[] }>(`/api/acquisitions?limit=100${feedId ? `&feedId=${encodeURIComponent(feedId)}` : ""}`).then((result) => result.data);
/** Every run of one UTC day, from the same endpoint. */
export const fetchDay = (day: string, limit: number) => apiGet<AcquisitionDay>(`/api/acquisitions?day=${encodeURIComponent(day)}&limit=${limit}`);

export type StatusBadge = "success" | "neutral" | "error" | "info" | "warning";

export interface StatusMeta {
  label: string;
  badge: StatusBadge;
}

export const RUN_STATUS = {
  queued: { label: "Queued", badge: "neutral" },
  running: { label: "Running", badge: "info" },
  unchanged: { label: "Unchanged", badge: "neutral" },
  succeeded: { label: "Published", badge: "success" },
  failed: { label: "Failed", badge: "error" },
} satisfies { [status in AcquisitionStatus]: StatusMeta };

/** The words for a status, falling back to the raw value should the API add one. */
export const runStatus = (status: AcquisitionStatus): StatusMeta => RUN_STATUS[status] ?? { label: status, badge: "neutral" };

export function RunBadge({ status }: { status: AcquisitionStatus }) {
  const meta = runStatus(status);
  return (
    <Badge variant={meta.badge} appearance="dot">
      {meta.label}
    </Badge>
  );
}

/** A run as the page lists it, whichever endpoint it came from. */
export interface RunRow {
  id: string;
  feedId: string;
  status: AcquisitionStatus;
  trigger: string;
  /** When it completed, or when it was requested if it has not. */
  at: string;
  requestedAt: string;
  rows?: number;
  revisions?: number;
  error?: string;
}

export const runFromAcquisition = (acquisition: Acquisition): RunRow => ({
  id: acquisition.id,
  feedId: acquisition.feedId,
  status: acquisition.status,
  trigger: acquisition.trigger,
  at: acquisition.completedAt ?? acquisition.requestedAt,
  requestedAt: acquisition.requestedAt,
  rows: acquisition.rows,
  revisions: acquisition.revisions,
  error: acquisition.error,
});

/** Scheduled runs are the norm; only a manual run or a history backfill is worth naming. */
export const triggerLabel = (trigger: string) => (trigger === "manual" || trigger === "history" ? trigger : "schedule");

/** What a run left behind, in a few words. */
export function runOutcome(run: RunRow) {
  if (run.error) return run.error;
  if (run.status === "unchanged") return "Source unchanged";
  if (run.status === "running" || run.status === "queued") return "";
  const parts = [run.rows === undefined ? "" : plural(run.rows, "row"), run.revisions === undefined ? "" : plural(run.revisions, "change")];
  return parts.filter(Boolean).join(" · ");
}
