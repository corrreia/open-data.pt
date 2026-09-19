import { Button, InputGroup, LayerCard, Pagination, Table } from "@cloudflare/kumo";
import { CaretDownIcon, CaretUpDownIcon, CaretUpIcon, DownloadSimpleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { fmt } from "../lib/format";
import type { JsonRecord, JsonValue } from "../lib/types";

export type SortValue = string | number | null | undefined;

export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** What sorting compares; a column without it cannot be sorted. */
  sort?: (row: Row) => SortValue;
  /** What the filter box matches; defaults to the sort value. */
  text?: (row: Row) => string;
  align?: "start" | "end";
  /** Identifiers and instants read better in the mono face. */
  mono?: boolean;
  className?: string;
}

export interface SortState {
  key: string;
  direction: "asc" | "desc";
}

export interface DataTableProps<Row> {
  label: string;
  rows: Row[];
  columns: Column<Row>[];
  rowKey: (row: Row, index: number) => string;
  pageSize?: number;
  initialSort?: SortState;
  filterPlaceholder?: string;
  onRowClick?: (row: Row) => void;
  /** Each row as a plain record for the CSV and JSON downloads; without it there are none. */
  exportRow?: (row: Row) => JsonRecord;
  downloadName?: string;
  /** Controls beside the filter box. */
  toolbar?: ReactNode;
  /** Under the table, left of the pagination: "Load more", a note. */
  footer?: ReactNode;
  empty?: ReactNode;
  maxHeight?: string;
}

function compare(a: SortValue, b: SortValue) {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  if (Number.isFinite(a) && Number.isFinite(b)) return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

function csvValue(value: JsonValue | undefined) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) || (value !== null && Object.prototype.toString.call(value) === "[object Object]") ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A Kumo table that filters, sorts, pages and downloads what it holds. */
export function DataTable<Row>(props: DataTableProps<Row>) {
  const { rows, columns, rowKey, pageSize = 50, onRowClick } = props;
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState | undefined>(props.initialSort);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const words = filter.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return rows;
    return rows.filter((row) => {
      const haystack = columns
        .map((column) => (column.text ? column.text(row) : String(column.sort?.(row) ?? "")))
        .join(" ")
        .toLocaleLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [rows, columns, filter]);

  const sorted = useMemo(() => {
    const column = sort ? columns.find((candidate) => candidate.key === sort.key) : undefined;
    if (!sort || !column?.sort) return filtered;
    const value = column.sort;
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const order = compare(value(a), value(b));
      // Empty values stay last whichever way the column is sorted.
      const empty = (row: Row) => value(row) === null || value(row) === undefined || value(row) === "";
      return empty(a) || empty(b) ? order : order * direction;
    });
  }, [filtered, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  const shown = sorted.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (key: string) => {
    setPage(1);
    setSort((current) => (current?.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }));
  };

  const exportRow = props.exportRow;
  const downloadCsv = () => {
    if (!exportRow) return;
    const records = sorted.map(exportRow);
    const keys = [...new Set(records.flatMap((record) => Object.keys(record)))];
    download(`${props.downloadName ?? "rows"}.csv`, [keys.join(","), ...records.map((record) => keys.map((key) => csvValue(record[key])).join(","))].join("\n"), "text/csv");
  };
  const downloadJson = () => {
    if (!exportRow) return;
    download(`${props.downloadName ?? "rows"}.json`, JSON.stringify(sorted.map(exportRow), null, 2), "application/json");
  };

  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, row: Row) => {
    if (onRowClick && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      onRowClick(row);
    }
  };

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <InputGroup className="w-full max-w-sm">
          <InputGroup.Addon>
            <MagnifyingGlassIcon />
          </InputGroup.Addon>
          <InputGroup.Input
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(1);
            }}
            placeholder={props.filterPlaceholder ?? "Filter rows…"}
            aria-label={`Filter ${props.label}`}
          />
        </InputGroup>
        <div className="flex flex-wrap items-center gap-2">
          {props.toolbar}
          <span className="font-mono text-xs text-kumo-subtle">{filter ? `${fmt.int(sorted.length)} of ${fmt.int(rows.length)}` : fmt.int(rows.length)} rows</span>
          {exportRow ? (
            <>
              <Button variant="ghost" icon={<DownloadSimpleIcon />} onClick={downloadCsv}>
                CSV
              </Button>
              <Button variant="ghost" icon={<DownloadSimpleIcon />} onClick={downloadJson}>
                JSON
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <LayerCard className="overflow-hidden p-0">
        <div className="overflow-auto" style={{ maxHeight: props.maxHeight ?? "min(70vh, 36rem)" }}>
          <Table aria-label={props.label}>
            <Table.Header className="sticky top-0 z-10">
              <Table.Row>
                {columns.map((column) => {
                  const active = sort?.key === column.key;
                  return (
                    <Table.Head
                      key={column.key}
                      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined}
                      className={`whitespace-nowrap ${column.align === "end" ? "text-right" : ""}`}
                    >
                      {column.sort ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(column.key)}
                          className={`-my-1 inline-flex min-h-6 items-center gap-1 py-1 font-medium hover:text-kumo-strong ${column.align === "end" ? "flex-row-reverse" : ""}`}
                        >
                          {column.header}
                          {active ? sort.direction === "asc" ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} /> : <CaretUpDownIcon size={12} className="opacity-40" />}
                        </button>
                      ) : (
                        column.header
                      )}
                    </Table.Head>
                  );
                })}
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {shown.map((row, index) => (
                <Table.Row
                  key={rowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={onRowClick ? (event: KeyboardEvent<HTMLTableRowElement>) => onRowKey(event, row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  className={onRowClick ? "cursor-pointer focus-visible:outline-2 focus-visible:outline-kumo-focus" : undefined}
                >
                  {columns.map((column) => (
                    <Table.Cell
                      key={column.key}
                      className={`max-w-[28rem] ${column.mono ? "font-mono text-sm" : ""} ${column.align === "end" ? "text-right tabular-nums" : ""} ${column.className ?? ""}`}
                    >
                      {column.cell(row)}
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
          {sorted.length === 0 ? (
            <div className="p-6 text-center text-sm text-kumo-subtle">{rows.length === 0 ? (props.empty ?? "Nothing to show.") : "No row matches that filter."}</div>
          ) : null}
        </div>
      </LayerCard>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-kumo-subtle">{props.footer}</div>
        {sorted.length > pageSize ? (
          <Pagination page={page} setPage={setPage} perPage={pageSize} totalCount={sorted.length} labels={{ navigation: `${props.label} pages` }} />
        ) : null}
      </div>
    </div>
  );
}
