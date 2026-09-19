import { Button, Dialog } from "@cloudflare/kumo";
import { XIcon } from "@phosphor-icons/react";
import { Kv } from "../common";
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

function plain(value: JsonValue | undefined) {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value) || isRecord(value))
    return <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(value, null, 2)}</pre>;
  return String(value);
}

/** Every field of one record, with its clocks, in a dialog. */
export function RecordDialog({ record, fields, title, onClose }: { record: JsonRecord | null; fields: Field[]; title?: string; onClose: () => void }) {
  const time = record?._time;
  const clocks = time && isRecord(time) ? Object.entries(time) : [];
  const known = new Set(fields.map((field) => field.name));
  const extra = record ? Object.keys(record).filter((key) => !known.has(key) && key !== "_time") : [];
  const name = record ? (record.name ?? record.title ?? record.id) : undefined;
  return (
    <Dialog.Root open={record !== null} onOpenChange={(open: boolean) => (open ? undefined : onClose())}>
      <Dialog size="xl" className="max-h-[85vh] overflow-y-auto p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <Dialog.Title className="font-display text-2xl text-kumo-strong">{title ?? (isText(name) ? name : "Record")}</Dialog.Title>
          <Dialog.Close aria-label="Close" render={(props) => <Button {...props} variant="ghost" size="sm" icon={<XIcon />} aria-label="Close" />} />
        </div>
        {record ? (
          <div className="grid gap-5">
            <Kv
              items={[
                ...fields.map((field) => ({ term: `${humanize(field.name)}${field.unit ? ` (${field.unit})` : ""}`, value: <Cell record={record} field={field} /> })),
                ...extra.map((key) => ({ term: humanize(key), value: plain(record[key]) })),
              ]}
            />
            {clocks.length ? (
              <div className="grid gap-2 rounded-lg bg-kumo-recessed p-4">
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-kumo-subtle">Clocks</p>
                <Kv items={clocks.map(([key, value]) => ({ term: TIME_LABEL.get(key) ?? humanize(key), value: isText(value) ? fmt.dateTime(value) : plain(value) }))} />
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </Dialog.Root>
  );
}
