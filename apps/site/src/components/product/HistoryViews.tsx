import { Badge, Button, Loader } from "@cloudflare/kumo";
import { useEffect, useMemo, useState } from "react";
import { DataTable, type Column } from "../DataTable";
import { ErrorNote, RelativeTime } from "../common";
import { apiGet, productPath } from "../../lib/api";
import { fmt, humanize } from "../../lib/format";
import { useQuery } from "../../lib/query";
import type { Change, CursorPage, HistoryPage, JsonRecord, Product, SeriesChange } from "../../lib/types";
import { Cell, OPERATION_BADGE, isText, seriesLabel, sortValue } from "./cells";
import { RecordDialog, RowDialog } from "./RecordDialog";
import { pointRecord } from "./SeriesView";

const when = (value: string | null | undefined) => (value ? fmt.dateTime(value) : "—");

function Loading({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-kumo-subtle">
      <Loader size="sm" /> Loading {what}…
    </div>
  );
}

/** Creates, updates, corrections and retractions from the recent window. */
export function ChangesView({ product, refreshKey }: { product: Product; refreshKey: number }) {
  const changes = useQuery(`changes:${product.slug}`, () => apiGet<CursorPage<Change>>(productPath(product.slug, "/changes?limit=500")).then((page) => page.data));
  const [selected, setSelected] = useState<Change | null>(null);
  useEffect(() => {
    if (refreshKey > 0) void changes.refetch();
  }, [refreshKey]);

  const columns = useMemo<Column<Change>[]>(
    () => [
      {
        key: "operation",
        header: "Operation",
        cell: (change) => <Badge variant={OPERATION_BADGE.get(change.operation) ?? "neutral"}>{change.operation}</Badge>,
        sort: (change) => change.operation,
      },
      { key: "entity", header: "Entity", cell: (change) => change.entityKey, sort: (change) => change.entityKey, mono: true },
      { key: "eventTime", header: "Event time", cell: (change) => when(change.eventTime), sort: (change) => change.eventTime, mono: true },
      { key: "validFrom", header: "Valid from", cell: (change) => when(change.validFrom), sort: (change) => change.validFrom, mono: true },
      { key: "sourcePublished", header: "Source published", cell: (change) => when(change.sourcePublishedAt), sort: (change) => change.sourcePublishedAt, mono: true },
      { key: "observed", header: "Observed", cell: (change) => <RelativeTime value={change.observedAt} />, sort: (change) => change.observedAt, mono: true },
    ],
    [],
  );

  if (changes.loading) return <Loading what="changes" />;
  if (changes.error) return <ErrorNote error={changes.error} what="the changes" onRetry={() => void changes.refetch()} />;
  return (
    <>
      <DataTable
        label={`${product.title} changes`}
        rows={changes.data ?? []}
        columns={columns}
        rowKey={(change) => change.id}
        initialSort={{ key: "observed", direction: "desc" }}
        onRowClick={setSelected}
        exportRow={(change) => ({
          operation: change.operation,
          entityKey: change.entityKey,
          eventTime: change.eventTime ?? null,
          validFrom: change.validFrom ?? null,
          validTo: change.validTo ?? null,
          observedAt: change.observedAt ?? null,
          payload: change.payload ?? null,
        })}
        downloadName={`${product.slug}-changes`}
        empty="No changes recorded yet: changes are logged when a record is created, updated, corrected, retracted or deleted between collections."
        footer={<span>Every row keeps its own event, validity, source and observation clocks. Select one to read what it wrote.</span>}
      />
      <RecordDialog
        record={selected?.payload ?? null}
        fields={product.schema.fields}
        title={selected ? `${selected.operation} · ${selected.entityKey}` : undefined}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

/** Points that were published and later revised. */
export function CorrectionsView({ product, refreshKey }: { product: Product; refreshKey: number }) {
  const [opened, setOpened] = useState<{ row: JsonRecord; title: string } | null>(null);
  const corrections = useQuery(`corrections:${product.slug}`, () =>
    apiGet<CursorPage<SeriesChange>>(productPath(product.slug, "/series/changes?limit=500")).then((page) => page.data),
  );
  useEffect(() => {
    if (refreshKey > 0) void corrections.refetch();
  }, [refreshKey]);
  const columns = useMemo<Column<SeriesChange>[]>(
    () => [
      { key: "series", header: "Series", cell: (point) => seriesLabel(point), sort: (point) => seriesLabel(point) },
      { key: "eventTime", header: "Event time", cell: (point) => fmt.dateTime(point.eventTime), sort: (point) => point.eventTime, mono: true },
      { key: "value", header: "Value", cell: (point) => fmt.cell(point.value, "number"), sort: (point) => point.value, align: "end" },
      { key: "ingested", header: "Corrected", cell: (point) => <RelativeTime value={point.ingestedAt} />, sort: (point) => point.ingestedAt, mono: true },
    ],
    [],
  );
  if (corrections.loading) return <Loading what="corrections" />;
  if (corrections.error) return <ErrorNote error={corrections.error} what="the corrections" onRetry={() => void corrections.refetch()} />;
  return (
    <>
      <DataTable
        label={`${product.title} corrections`}
        rows={corrections.data ?? []}
        columns={columns}
        rowKey={(point) => `${point.seriesKey}|${point.eventTime}|${point.ingestedAt ?? ""}`}
        initialSort={{ key: "ingested", direction: "desc" }}
        empty="No corrections: one is logged when a later collection changes a point that was already published."
        footer={<span>A point that was published and later revised, with the moment the correction arrived.</span>}
        onRowClick={(point) => setOpened({ row: pointRecord(point), title: seriesLabel(point) })}
      />
      <RowDialog row={opened?.row ?? null} title={opened?.title} onClose={() => setOpened(null)} />
    </>
  );
}

/** Applicable event revisions over the last thirty days, from the lake. */
export function EventHistoryView({ product }: { product: Product }) {
  const [rows, setRows] = useState<JsonRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>();
  const [complete, setComplete] = useState<boolean>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const [selected, setSelected] = useState<JsonRecord | null>(null);
  // Whole hours: everyone asking within the same hour gets the edge-cached answer.
  const range = useMemo(() => {
    const hour = 3_600_000;
    const to = new Date(Math.ceil(Date.now() / hour) * hour).toISOString();
    return { from: new Date(Date.parse(to) - 30 * 86_400_000).toISOString(), to };
  }, []);

  const load = async (after?: string | null) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ ...range, limit: "200" });
      if (after) query.set("cursor", after);
      const page = await apiGet<HistoryPage<JsonRecord>>(productPath(product.slug, `/events?${query}`));
      setRows((current) => (after ? [...current, ...page.data] : page.data));
      setCursor(page.nextCursor);
      setComplete(page.coverage.complete);
    } catch (failure) {
      if (failure instanceof Error) setError(failure);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [product.slug]);

  const fields = product.schema.fields;
  const columns = useMemo<Column<JsonRecord>[]>(
    () => [
      ...fields.slice(0, 5).map((field) => ({
        key: field.name,
        header: humanize(field.name),
        cell: (record: JsonRecord) => <Cell record={record} field={field} />,
        sort: (record: JsonRecord) => sortValue(record[field.name]),
      })),
      {
        key: "eventTime",
        header: "Event time",
        cell: (record) => (isText(record.eventTime) ? fmt.dateTime(record.eventTime) : "—"),
        sort: (record) => sortValue(record.eventTime),
        mono: true,
      },
    ],
    [fields],
  );

  if (loading && rows.length === 0) return <Loading what="the last 30 days" />;
  if (error && rows.length === 0)
    return (
      <ErrorNote
        error={error}
        what="the event history"
        onRetry={() => {
          setError(undefined);
          void load();
        }}
      />
    );
  return (
    <>
      <DataTable
        label={`${product.title} event history`}
        rows={rows}
        columns={columns}
        rowKey={(record, index) => (isText(record.revisionId) ? record.revisionId : String(index))}
        initialSort={{ key: "eventTime", direction: "desc" }}
        onRowClick={setSelected}
        exportRow={(record) => record}
        downloadName={`${product.slug}-events`}
        empty="No events in the last 30 days."
        footer={
          <>
            <span>
              {fmt.int(rows.length)} events in the last 30 days · coverage {complete ? "complete" : "may be incomplete"}
            </span>
            {cursor ? (
              <Button size="sm" variant="secondary" loading={loading} onClick={() => load(cursor)}>
                Load more
              </Button>
            ) : null}
          </>
        }
      />
      <RecordDialog record={selected} fields={fields} onClose={() => setSelected(null)} />
    </>
  );
}
