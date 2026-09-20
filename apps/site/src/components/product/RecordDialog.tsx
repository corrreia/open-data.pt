import { Button, Dialog } from "@cloudflare/kumo";
import { CaretRightIcon, CheckIcon, CopyIcon, XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Kv } from "../common";
import { useCopy } from "../ops/CommandBlock";
import { fmt, humanize, isRecord } from "../../lib/format";
import type { Field, JsonRecord, JsonValue } from "../../lib/types";
import { Cell, isText } from "./cells";

const TIME_LABEL = new Map([
  ["event", "Event"],
  ["validFrom", "Valid from"],
  ["validTo", "Valid to"],
  ["sourcePublished", "Source published"],
  ["observed", "Observed"],
  ["ingested", "Ingested"],
]);

/** Longer than a line or two: shown in a box of its own that scrolls, rather than cut with an ellipsis. */
const LONG_TEXT = 160;

/** A row without a schema still has times in it; these read as dates rather than as machine stamps. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** The copy button that sits in the corner of a value's box. */
function CopyValue({ text }: { text: string }) {
  const { copied, copy } = useCopy(text);
  return (
    <Button
      className="absolute right-1.5 top-1.5"
      size="sm"
      variant="ghost"
      icon={copied ? <CheckIcon /> : <CopyIcon />}
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy this value"}
    />
  );
}

/** A value too long to read in a row: all of it, in a box that scrolls, with a way to take it away. */
function LongText({ text }: { text: string }) {
  return (
    <div className="relative">
      <p className="max-h-44 overflow-auto whitespace-pre-wrap rounded-lg bg-kumo-recessed p-3 pr-11 text-sm leading-relaxed [overflow-wrap:anywhere]">{text}</p>
      <CopyValue text={text} />
    </div>
  );
}

/** What a structured value holds, before anyone opens it. */
function preview(value: JsonValue): string {
  if (Array.isArray(value)) return value.length === 1 ? "1 item" : `${fmt.int(value.length)} items`;
  if (isRecord(value)) {
    const keys = Object.keys(value);
    return keys.length <= 4 ? keys.join(", ") : `${keys.slice(0, 4).join(", ")} and ${fmt.int(keys.length - 4)} more`;
  }
  return "value";
}

/**
 * A list or an object, folded to one line and opened in full. The table cut these to sixty
 * characters, which is right for a table and useless for someone reading one record: a journalist
 * should not have to call the API to see what is inside a field.
 */
function Structured({ value, summary }: { value: JsonValue; summary?: ReactNode }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <details className="group min-w-0">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-kumo-default marker:content-none hover:text-kumo-strong">
        <CaretRightIcon size={12} aria-hidden="true" className="shrink-0 text-kumo-subtle transition-transform group-open:rotate-90" />
        {summary ?? <span className="text-kumo-subtle">{preview(value)}</span>}
      </summary>
      <div className="relative mt-2">
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-kumo-recessed p-3 pr-11 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">{text}</pre>
        <CopyValue text={text} />
      </div>
    </details>
  );
}

/** One field of the record, in full: the dialog is where the whole value is read. */
function RecordValue({ record, field }: { record: JsonRecord; field: Field }) {
  const value = record[field.name];
  if (value === null || value === undefined) return <>—</>;
  // A geometry keeps its summary — "LineString · 812 points" — and opens to the coordinates themselves.
  if (Array.isArray(value) || isRecord(value)) {
    return <Structured value={value} summary={field.type === "geometry" ? <span>{<Cell record={record} field={field} />}</span> : undefined} />;
  }
  if (isText(value) && value.length > LONG_TEXT && field.type !== "url") return <LongText text={value} />;
  return <Cell record={record} field={field} />;
}

/** A field the schema does not list: same treatment, without a field type to go on. */
function ExtraValue({ value }: { value: JsonValue | undefined }) {
  if (value === null || value === undefined) return <>—</>;
  if (Array.isArray(value) || isRecord(value)) return <Structured value={value} />;
  if (isText(value) && value.length > LONG_TEXT) return <LongText text={value} />;
  if (isText(value) && ISO_TIME.test(value)) return <>{fmt.dateTime(value)}</>;
  return <>{String(value)}</>;
}

/** Every field of one record, with its clocks, in a dialog. */
export function RecordDialog({ record, fields, title, onClose }: { record: JsonRecord | null; fields: Field[]; title?: string; onClose: () => void }) {
  const time = record?._time;
  const clocks = time && isRecord(time) ? Object.entries(time) : [];
  const known = new Set(fields.map((field) => field.name));
  const extra = record ? Object.keys(record).filter((key) => !known.has(key) && key !== "_time") : [];
  const name = record ? (record.name ?? record.title ?? record.id) : undefined;
  const whole = record ? JSON.stringify(record, null, 2) : "";
  return (
    <Dialog.Root open={record !== null} onOpenChange={(open: boolean) => (open ? undefined : onClose())}>
      <Dialog size="xl" className="max-h-[85vh] overflow-y-auto p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <Dialog.Title className="font-display text-2xl text-kumo-strong">{title ?? (isText(name) ? name : "Record")}</Dialog.Title>
          <div className="flex shrink-0 items-center gap-1">
            {record ? <CopyRecord text={whole} /> : null}
            <Dialog.Close aria-label="Close" render={(props) => <Button {...props} variant="ghost" size="sm" icon={<XIcon />} aria-label="Close" />} />
          </div>
        </div>
        {record ? (
          <div className="grid gap-5">
            <Kv
              items={[
                ...fields.map((field) => ({
                  term: `${humanize(field.name)}${field.unit ? ` (${field.unit})` : ""}`,
                  value: <RecordValue record={record} field={field} />,
                })),
                ...extra.map((key) => ({ term: humanize(key), value: <ExtraValue value={record[key]} /> })),
              ]}
            />
            {clocks.length ? (
              <div className="grid gap-2 rounded-lg bg-kumo-recessed p-4">
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-kumo-subtle">Clocks</p>
                <Kv
                  items={clocks.map(([key, value]) => ({ term: TIME_LABEL.get(key) ?? humanize(key), value: isText(value) ? fmt.dateTime(value) : <ExtraValue value={value} /> }))}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </Dialog.Root>
  );
}

/** The whole record as JSON, for a reader who came to take the data rather than read it. */
function CopyRecord({ text }: { text: string }) {
  const { copied, copy } = useCopy(text);
  return (
    <Button variant="ghost" size="sm" icon={copied ? <CheckIcon /> : <CopyIcon />} onClick={copy}>
      {copied ? "Copied" : "Copy JSON"}
    </Button>
  );
}

/**
 * Any table's row in the same dialog: a series point, a summary bucket or a feed has no schema of
 * its own, so every key is read as it comes. A row is worth opening even when the table shows most
 * of it — the dimensions behind a series, the exact numbers behind a rounded one, and the JSON.
 */
export function RowDialog({ row, title, onClose }: { row: JsonRecord | null; title?: string; onClose: () => void }) {
  return <RecordDialog record={row} fields={[]} title={title} onClose={onClose} />;
}
