import { Button, Empty, LayerCard, Loader, Meter } from "@cloudflare/kumo";
import { DownloadSimpleIcon, TableIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataTable, type Column } from "../DataTable";
import { apiGet, productPath } from "../../lib/api";
import { fmt, humanize } from "../../lib/format";
import type { Field, JsonRecord, Page, Product } from "../../lib/types";
import { Cell, isText, sortValue } from "./cells";
import { RecordDialog } from "./RecordDialog";

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
  const [selected, setSelected] = useState<JsonRecord | null>(null);
  // Once a reader loads a large dataset whole, a new version reloads it whole too.
  const wantAll = useRef(product.rowCount <= LOAD_ALL_UP_TO);
  const fields = product.schema.fields;
  const rows = loaded.rows;

  const fetchAll = useCallback(() => apiGet<{ data: JsonRecord[] }>(productPath(product.slug, "/records/all")).then((body) => body.data), [product.slug]);
  const fetchPreview = useCallback(() => apiGet<Page<JsonRecord>>(productPath(product.slug, `/records?limit=${PREVIEW}`)).then((page) => page.data), [product.slug]);

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
  }, [fetchAll, fetchPreview, refreshKey, product.rowCount]);

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
        <Loader size="sm" /> {wantAll.current ? `Loading all ${fmt.int(product.rowCount)} records…` : `Loading the first ${fmt.int(PREVIEW)} records…`}
      </div>
    );
  }
  if (error && rows.length === 0) return <Empty icon={<TableIcon size={40} className="text-kumo-inactive" />} title="Could not load records" description={`${error.message}. Refresh the page to try again.`} />;
  if (rows.length === 0) return <Empty icon={<TableIcon size={40} className="text-kumo-inactive" />} title="Empty at the source" description="The latest collection returned no records. The source is still read on its usual schedule, and records appear here as soon as it lists any." />;

  const remaining = product.rowCount - rows.length;

  return (
    <div className="grid gap-5">
      {loaded.complete ? null : (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-kumo-recessed p-4 ring-1 ring-kumo-line">
          <div className="grid max-w-prose gap-1">
            <p className="font-medium text-kumo-strong">
              Showing the first {fmt.int(rows.length)} of {fmt.int(product.rowCount)} records
            </p>
            <p className="text-sm text-kumo-subtle">Search, sorting, downloads and the summaries cover only these rows until you load the other {fmt.int(remaining)}.</p>
            {error ? <p className="text-sm text-kumo-danger">Could not load every record: {error.message}. Try again.</p> : null}
          </div>
          <Button variant="primary" icon={<DownloadSimpleIcon />} loading={loadingAll} onClick={loadAll}>
            Load all {fmt.int(product.rowCount)} records{loaded.estimatedBytes ? ` (about ${fmt.bytes(loaded.estimatedBytes)})` : ""}
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
                          <dt className="text-[0.7rem] text-kumo-subtle">{key}</dt>
                          <dd className="font-mono text-sm text-kumo-strong">{fmt.cell(glance[key], "number")}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <div className="grid gap-2">
                      {(glance.top ?? []).map(([value, count]) => (
                        <Meter key={value} label={value.replaceAll("_", " ")} value={Math.round((count / rows.length) * 100)} customValue={`${fmt.int(count)} · ${Math.round((count / rows.length) * 100)}%`} />
                      ))}
                    </div>
                  )}
                </LayerCard.Primary>
              </LayerCard>
            ))}
          </div>
          <p className="text-xs text-kumo-subtle">{loaded.complete ? `From all ${fmt.int(rows.length)} records.` : `From the first ${fmt.int(rows.length)} records only.`}</p>
        </div>
      ) : null}

      <DataTable
        label={`${product.title} records`}
        rows={rows}
        columns={columns}
        rowKey={(record, index) => (isText(record.id) || Number.isFinite(record.id) ? String(record.id) : String(index))}
        onRowClick={setSelected}
        exportRow={(record) => record}
        downloadName={product.slug}
        footer={
          <span>
            {loaded.complete ? `All ${fmt.int(rows.length)} records` : `First ${fmt.int(rows.length)} of ${fmt.int(product.rowCount)} records`} · select a row for every field
          </span>
        }
      />
      <RecordDialog record={selected} fields={fields} onClose={() => setSelected(null)} />
    </div>
  );
}
