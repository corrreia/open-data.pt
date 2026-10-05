import { Button, Empty, LayerCard, Loader, Meter } from "@cloudflare/kumo";
import { DownloadSimpleIcon, TableIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorNote } from "../common";
import { DataTable, type Column } from "../DataTable";
import { apiGet, productPath } from "../../lib/api";
import { fmt, humanize } from "../../lib/format";
import type { CursorPage, Field, JsonRecord, Product } from "../../lib/types";
import { RECORDS } from "../../text/records";
import { Cell, isText, sortValue } from "./cells";
import { RecordDialog } from "./RecordDialog";
import { LOADING } from "../../text/product";

/**
 * Datasets up to this many rows load whole, so search, sorting, downloads and the summaries cover
 * every row. Table libraries put client-side tables comfortably at this size (DataTables: under
 * 10,000 rows), and it covers nearly every dataset here.
 */
const LOAD_ALL_UP_TO = 10_000;
/** Larger datasets open with this many rows and one button for the rest. */
const PREVIEW = 200;

interface Glance {
  field: Field;
  kind: "range" | "facet";
  min?: number;
  median?: number;
  max?: number;
  top?: [string, number][];
}

interface Loaded {
  rows: JsonRecord[];
  complete: boolean;
  /** The whole dataset's size, estimated from the preview's bytes per row. */
  estimatedBytes?: number;
}

/** Ranges for numeric fields and the spread of low-cardinality ones, from the rows loaded. */
function glances(records: JsonRecord[], fields: Field[]): Glance[] {
  const result: Glance[] = [];
  for (const field of fields) {
    if (field.name === "id" || result.length >= 4) continue;
    const values = records.map((record) => record[field.name]).filter((value) => value !== null && value !== undefined && value !== "");
    if (values.length === 0) continue;
    if (field.type === "number") {
      const sorted = values.filter((value): value is number => Number.isFinite(value)).sort((a, b) => a - b);
      if (sorted.length < 2) continue;
      result.push({ field, kind: "range", min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) });
      continue;
    }
    if (field.type === "category" || field.type === "boolean" || field.type === "string") {
      const counts = new Map<string, number>();
      for (const value of values) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      if (counts.size < 2 || (field.type !== "category" && counts.size > 12) || counts.size > 24) continue;
      result.push({ field, kind: "facet", top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) });
    }
  }
  return result;
}

export function RecordsView({ product, refreshKey }: { product: Product; refreshKey: number }) {
  const [loaded, setLoaded] = useState<Loaded>({ rows: [], complete: false });
  const [loading, setLoading] = useState(true);
  const [loadingAll, setLoadingAll] = useState(false);
  const [error, setError] = useState<Error>();
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<JsonRecord | null>(null);
  // Once a reader loads a large dataset whole, a new version reloads it whole too.
  const wantAll = useRef(product.rowCount <= LOAD_ALL_UP_TO);
  const fields = product.schema.fields;
  const rows = loaded.rows;

  const fetchAll = useCallback(() => apiGet<{ data: JsonRecord[] }>(productPath(product.slug, "/records/all")).then((body) => body.data), [product.slug]);
  const fetchPreview = useCallback(() => apiGet<CursorPage<JsonRecord>>(productPath(product.slug, `/records?limit=${PREVIEW}`)).then((page) => page.data), [product.slug]);

  // On arrival, and again whenever a new version is published.
  useEffect(() => {
    let current = true;
    const whole = wantAll.current;
    (whole ? fetchAll() : fetchPreview())
      .then((data) => {
        if (!current) return;
        const bytesPerRow = data.length ? JSON.stringify(data).length / data.length : 0;
        setLoaded({ rows: data, complete: whole || data.length >= product.rowCount, estimatedBytes: whole ? undefined : Math.round(bytesPerRow * product.rowCount) });
        setError(undefined);
      })
      .catch((failure: Error) => current && setError(failure))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [fetchAll, fetchPreview, refreshKey, product.rowCount, attempt]);

  const loadAll = async () => {
    setLoadingAll(true);
    try {
      const data = await fetchAll();
      wantAll.current = true;
      setLoaded({ rows: data, complete: true });
      setError(undefined);
    } catch (failure) {
      if (failure instanceof Error) setError(failure);
    } finally {
      setLoadingAll(false);
    }
  };

  const columns = useMemo<Column<JsonRecord>[]>(
    () =>
      fields.map((field) => ({
        key: field.name,
        header: `${humanize(field.name)}${field.unit ? ` (${field.unit})` : ""}`,
        cell: (record) => <Cell record={record} field={field} />,
        sort: (record) => sortValue(record[field.name]),
        text: (record) => {
          const value = record[field.name];
          return isText(value) ? value : value === null || value === undefined ? "" : String(sortValue(value));
        },
        align: field.type === "number" ? "end" : "start",
        mono: field.type === "identifier" || field.type === "datetime",
        // Names and addresses wrap onto a few lines instead of one word per line.
        className: field.type === "string" || field.type === "url" ? "min-w-[12rem]" : undefined,
      })),
    [fields],
  );
  const glanceCards = useMemo(() => glances(rows, fields), [rows, fields]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-kumo-subtle">
        <Loader size="sm" aria-label={LOADING} /> {wantAll.current ? RECORDS.loadingAll(fmt.int(product.rowCount)) : RECORDS.loadingFirst(fmt.int(PREVIEW))}
      </div>
    );
  }
  if (error && rows.length === 0)
    return (
      <ErrorNote
        error={error}
        what={RECORDS.theRecords}
        onRetry={() => {
          setError(undefined);
          setLoading(true);
          setAttempt((count) => count + 1);
        }}
      />
    );
  if (rows.length === 0) return <Empty icon={<TableIcon size={40} className="text-kumo-inactive" />} title={RECORDS.emptyTitle} description={RECORDS.emptyText} />;

  const remaining = product.rowCount - rows.length;

  return (
    <div className="grid gap-5">
      {loaded.complete ? null : (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-kumo-recessed p-4 ring-1 ring-kumo-line">
          <div className="grid max-w-prose gap-1">
            <p className="font-medium text-kumo-strong">{RECORDS.showingFirst(fmt.int(rows.length), fmt.int(product.rowCount))}</p>
            <p className="text-sm text-kumo-subtle">{RECORDS.onlyThese(fmt.int(remaining))}</p>
            {error ? (
              <p role="alert" className="text-sm text-kumo-danger">
                {RECORDS.couldNotLoadAll(error.message)}
              </p>
            ) : null}
          </div>
          <Button variant="primary" icon={<DownloadSimpleIcon />} loading={loadingAll} onClick={loadAll}>
            {RECORDS.loadAll(fmt.int(product.rowCount), loaded.estimatedBytes ? fmt.bytes(loaded.estimatedBytes) : undefined)}
          </Button>
        </div>
      )}

      {glanceCards.length ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(13rem,100%),1fr))] gap-3">
            {glanceCards.map((glance) => (
              <LayerCard key={glance.field.name} className="flex flex-col">
                <LayerCard.Secondary className="truncate text-xs">
                  {humanize(glance.field.name)}
                  {glance.field.unit ? ` (${glance.field.unit})` : ""}
                </LayerCard.Secondary>
                <LayerCard.Primary className="flex-1">
                  {glance.kind === "range" ? (
                    <dl className="grid grid-cols-3 gap-2 text-center">
                      {(["min", "median", "max"] as const).map((key) => (
                        <div key={key}>
                          <dt className="text-xs text-kumo-subtle">{RECORDS.glance[key]}</dt>
                          <dd className="font-mono text-sm text-kumo-strong">{fmt.cell(glance[key], "number")}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <div className="grid gap-2">
                      {(glance.top ?? []).map(([value, count]) => (
                        <Meter
                          key={value}
                          label={value.replaceAll("_", " ")}
                          value={Math.round((count / rows.length) * 100)}
                          customValue={`${fmt.int(count)} · ${Math.round((count / rows.length) * 100)}%`}
                        />
                      ))}
                    </div>
                  )}
                </LayerCard.Primary>
              </LayerCard>
            ))}
          </div>
          <p className="text-xs text-kumo-subtle">{loaded.complete ? RECORDS.fromAll(fmt.int(rows.length)) : RECORDS.fromFirst(fmt.int(rows.length))}</p>
        </div>
      ) : null}

      <DataTable
        label={RECORDS.tableLabel(product.title)}
        rows={rows}
        columns={columns}
        rowKey={(record, index) => (isText(record.id) || Number.isFinite(record.id) ? String(record.id) : String(index))}
        onRowClick={setSelected}
        exportRow={(record) => record}
        downloadName={product.slug}
        footer={
          <span>
            {loaded.complete ? RECORDS.footerAll(fmt.int(rows.length)) : RECORDS.footerFirst(fmt.int(rows.length), fmt.int(product.rowCount))} · {RECORDS.selectRow}
          </span>
        }
      />
      <RecordDialog record={selected} fields={fields} onClose={() => setSelected(null)} />
    </div>
  );
}
