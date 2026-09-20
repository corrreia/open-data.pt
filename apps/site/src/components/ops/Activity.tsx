// Every run as it happens: the newest acquisitions, refreshed on a short clock, and any past UTC day on request.

import { Button, DatePicker, LayerCard, Loader, Popover, RefreshButton } from "@cloudflare/kumo";
import { CalendarDotsIcon, XIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { productHref } from "../../lib/api";
import { fmt, plural } from "../../lib/format";
import { useQuery } from "../../lib/query";
import type { Feed, JsonRecord, Product } from "../../lib/types";
import { DataTable, type Column } from "../DataTable";
import { RowDialog } from "../product/RecordDialog";
import { ErrorNote, RelativeTime, SectionHead } from "../common";
import { RunBadge, acquisitionsKey, fetchAcquisitions, fetchDay, runFromAcquisition, runOutcome, runStatus, triggerLabel, type RunRow } from "./runs";

const LIVE_ROWS = 40;
const DAY_LIMIT = 1000;

export interface FeedLookup {
  feedsById: Map<string, Feed>;
  productsByFeed: Map<string, Product[]>;
}

/** The calendar day the visitor picked, as the API's YYYY-MM-DD. */
const dayOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** A past day is a UTC day, so its runs are timed in UTC; the tooltip gives local time. */
const utcTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
/** Noon keeps a UTC day on the same calendar day in every time zone. */
const dayLabel = (day: string) => fmt.date(`${day}T12:00:00Z`);

function FeedName({ feedId, lookup }: { feedId: string; lookup: FeedLookup }) {
  const title = lookup.feedsById.get(feedId)?.title ?? feedId;
  const first = lookup.productsByFeed.get(feedId)?.[0];
  if (!first) return <span className="font-medium text-kumo-strong">{title}</span>;
  return (
    <a href={productHref(first.slug)} className="font-medium text-kumo-strong no-underline hover:underline">
      {title}
    </a>
  );
}

function LiveLog({ runs, lookup }: { runs: RunRow[]; lookup: FeedLookup }) {
  if (runs.length === 0) return <p className="px-4 py-6 text-sm text-kumo-subtle">Waiting for the next run…</p>;
  return (
    <ol className="max-h-[34rem] divide-y divide-kumo-hairline overflow-y-auto">
      {runs.map((run) => {
        const outcome = runOutcome(run);
        const trigger = triggerLabel(run.trigger);
        return (
          <li key={run.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[8.5rem_7rem_minmax(0,1fr)]">
            <RelativeTime value={run.at} className="whitespace-nowrap pt-0.5 font-mono text-xs text-kumo-subtle" />
            <span className="justify-self-end sm:justify-self-start">
              <RunBadge status={run.status} />
            </span>
            <span className="col-span-2 min-w-0 text-sm sm:col-span-1">
              <FeedName feedId={run.feedId} lookup={lookup} />
              {trigger !== "schedule" ? <span className="ml-2 font-mono text-xs text-kumo-subtle">{trigger}</span> : null}
              {outcome ? (
                <span title={outcome} className={`block truncate text-xs ${run.error ? "text-kumo-danger" : "text-kumo-subtle"}`}>
                  {outcome}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function dayColumns(lookup: FeedLookup): Column<RunRow>[] {
  const title = (run: RunRow) => lookup.feedsById.get(run.feedId)?.title ?? run.feedId;
  return [
    {
      key: "at",
      header: "Time (UTC)",
      mono: true,
      sort: (run) => run.at,
      text: (run) => utcTime.format(new Date(run.at)),
      cell: (run) => (
        <time dateTime={run.at} title={fmt.dateTime(run.at)}>
          {utcTime.format(new Date(run.at))}
        </time>
      ),
    },
    {
      key: "status",
      header: "Status",
      sort: (run) => runStatus(run.status).label,
      text: (run) => `${runStatus(run.status).label} ${run.status}`,
      cell: (run) => <RunBadge status={run.status} />,
    },
    { key: "feed", header: "Feed", sort: title, className: "min-w-[14rem] whitespace-normal", cell: (run) => <FeedName feedId={run.feedId} lookup={lookup} /> },
    { key: "trigger", header: "Trigger", sort: (run) => triggerLabel(run.trigger), cell: (run) => <span className="text-kumo-subtle">{triggerLabel(run.trigger)}</span> },
    { key: "rows", header: "Rows", align: "end", sort: (run) => run.rows, cell: (run) => fmt.int(run.rows) },
    { key: "changes", header: "Changes", align: "end", sort: (run) => run.revisions, cell: (run) => fmt.int(run.revisions) },
    {
      key: "outcome",
      header: "Outcome",
      className: "min-w-[16rem] whitespace-normal",
      text: (run) => run.error ?? "",
      cell: (run) =>
        run.error ? (
          <span className="line-clamp-2 break-words text-kumo-danger" title={run.error}>
            {run.error}
          </span>
        ) : run.status === "unchanged" ? (
          <span className="text-kumo-subtle">Source unchanged</span>
        ) : null,
    },
  ];
}

function PastDay({ day, lookup }: { day: string; lookup: FeedLookup }) {
  const [opened, setOpened] = useState<{ row: JsonRecord; title: string } | null>(null);
  const archive = useQuery(`activity:${day}`, () => fetchDay(day, DAY_LIMIT), { staleMs: 300_000 });
  const rows = useMemo(() => (archive.data?.data ?? []).map(runFromAcquisition), [archive.data]);
  const columns = useMemo(() => dayColumns(lookup), [lookup]);
  const label = dayLabel(day);

  let note = `Reading ${label}…`;
  if (archive.data && rows.length === 0) note = `Nothing ran on ${label}, or the activity record no longer reaches back to it.`;
  else if (archive.data) {
    note = `${plural(rows.length, "run")} on ${label} (UTC). Recent runs are hidden while you look back.`;
    if (rows.length >= DAY_LIMIT) note += ` Only the latest ${fmt.int(DAY_LIMIT)} are listed.`;
    if (!archive.data.complete) note += " The activity record does not reach back to the start of that day, so its earliest runs are missing.";
  }

  return (
    <div className="grid gap-3">
      <p role="status" className="flex items-center gap-2 text-sm text-kumo-subtle">
        {archive.loading ? <Loader size="sm" /> : null}
        {archive.error ? "Could not read that day." : note}
      </p>
      <ErrorNote error={archive.error} />
      {archive.data ? (
        <DataTable
          label={`Runs on ${label}`}
          rows={rows}
          columns={columns}
          rowKey={(run) => run.id}
          initialSort={{ key: "at", direction: "desc" }}
          filterPlaceholder="Filter by feed, status or error…"
          downloadName={`runs-${day}`}
          exportRow={(run) => ({
            id: run.id,
            feedId: run.feedId,
            feed: lookup.feedsById.get(run.feedId)?.title ?? null,
            status: run.status,
            trigger: run.trigger,
            requestedAt: run.requestedAt,
            at: run.at,
            rows: run.rows ?? null,
            changes: run.revisions ?? null,
            error: run.error ?? null,
          })}
          onRowClick={(run) =>
            setOpened({
              title: lookup.feedsById.get(run.feedId)?.title ?? run.id,
              row: {
                id: run.id,
                feedId: run.feedId,
                feed: lookup.feedsById.get(run.feedId)?.title ?? null,
                status: run.status,
                trigger: run.trigger,
                requestedAt: run.requestedAt,
                at: run.at,
                rows: run.rows ?? null,
                changes: run.revisions ?? null,
                error: run.error ?? null,
              },
            })
          }
        />
      ) : null}
      <RowDialog row={opened?.row ?? null} title={opened?.title} onClose={() => setOpened(null)} />
    </div>
  );
}

export function Activity({ lookup }: { lookup: FeedLookup }) {
  const live = useQuery(acquisitionsKey(""), () => fetchAcquisitions(""), { staleMs: 20_000, refreshMs: 30_000 });
  const [picked, setPicked] = useState<Date | undefined>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const day = picked ? dayOf(picked) : null;

  const runs = useMemo(
    () =>
      (live.data ?? [])
        .map(runFromAcquisition)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, LIVE_ROWS),
    [live.data],
  );
  const newest = runs[0];
  // Screen readers hear only a new failure: with hundreds of feeds a new run lands every refresh, and reading each one out would never stop.
  const announcement = newest && newest.status === "failed" ? `${lookup.feedsById.get(newest.feedId)?.title ?? newest.feedId}: collection failed` : "";

  return (
    <section id="activity" aria-labelledby="activity-title">
      <SectionHead eyebrow="Activity" title="Every run, as it happens" id="activity-title">
        The newest runs across every feed, refreshed every half minute, failures included. Pick a day to see every run from it.
      </SectionHead>

      <div className="grid gap-4">
        <div role="group" aria-label="Look at a past day" className="flex flex-wrap items-center gap-2">
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <Popover.Trigger render={<Button variant="secondary" size="sm" icon={<CalendarDotsIcon />} />}>{day ? dayLabel(day) : "Show a past day"}</Popover.Trigger>
            <Popover.Content className="p-3">
              <DatePicker
                mode="single"
                selected={picked}
                defaultMonth={picked ?? new Date()}
                endMonth={new Date()}
                disabled={{ after: new Date() }}
                onChange={(date) => {
                  setPicked(date);
                  setPickerOpen(false);
                }}
              />
            </Popover.Content>
          </Popover>
          {day ? (
            <Button variant="ghost" size="sm" icon={<XIcon />} onClick={() => setPicked(undefined)}>
              Back to recent
            </Button>
          ) : null}
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {day ? "" : announcement}
        </p>

        {day ? (
          <PastDay day={day} lookup={lookup} />
        ) : (
          <LayerCard>
            <LayerCard.Secondary className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-kumo-success opacity-60 motion-reduce:hidden" />
                  <span className="relative inline-flex size-2 rounded-full bg-kumo-success" />
                </span>
                Latest {LIVE_ROWS} runs
              </span>
              <span className="flex items-center gap-2 text-xs text-kumo-subtle">
                {live.updatedAt ? (
                  <span>
                    updated <RelativeTime value={new Date(live.updatedAt).toISOString()} />
                  </span>
                ) : null}
                <RefreshButton size="sm" variant="ghost" loading={live.fetching} aria-label="Refresh the latest runs" onClick={() => void live.refetch()} />
              </span>
            </LayerCard.Secondary>
            <LayerCard.Primary className="p-0">
              {live.error && !live.data ? (
                <div className="p-4">
                  <ErrorNote error={live.error} what="the latest runs" onRetry={() => void live.refetch()} />
                </div>
              ) : live.loading ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-kumo-subtle">
                  <Loader size="sm" /> Loading the latest runs…
                </div>
              ) : (
                <LiveLog runs={runs} lookup={lookup} />
              )}
            </LayerCard.Primary>
          </LayerCard>
        )}
      </div>
    </section>
  );
}
