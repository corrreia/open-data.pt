import { Badge, Button, LayerCard, SkeletonLine } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, BellIcon, ChartLineIcon, PulseIcon, SigmaIcon, TableIcon, WarningCircleIcon, type Icon } from "@phosphor-icons/react";
import { useSyncExternalStore, type ReactNode } from "react";
import { ROLE, type Tone } from "../lib/catalog";
import { fmt } from "../lib/format";
import type { Role } from "../lib/types";

/* ---------- One clock for the page: every relative time and countdown ticks together ---------- */

const clockListeners = new Set<() => void>();
let clockNow = Date.now();
let clockTimer: number | undefined;

function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  clockTimer ??= window.setInterval(() => {
    clockNow = Date.now();
    for (const each of clockListeners) each();
  }, 1000);
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockTimer !== undefined) {
      window.clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

export const useNow = () => useSyncExternalStore(subscribeClock, () => clockNow);

/* ---------- Colour mode, for charts and map tiles that draw their own colours ---------- */

// mount.tsx sets data-mode when the system theme changes; this only tells components to redraw.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function subscribeMode(listener: () => void) {
  darkQuery.addEventListener("change", listener);
  return () => darkQuery.removeEventListener("change", listener);
}
export const useDarkMode = () => useSyncExternalStore(subscribeMode, () => darkQuery.matches);

/* ---------- Small pieces ---------- */

export function RelativeTime({ value, className }: { value: string | null | undefined; className?: string }) {
  const now = useNow();
  if (!value) return <span className="text-kumo-subtle">—</span>;
  return (
    <time dateTime={value} title={fmt.dateTime(value)} className={className}>
      {fmt.relative(value, now)}
    </time>
  );
}

export function Countdown({ value }: { value: string | undefined }) {
  const now = useNow();
  return (
    <time dateTime={value} title={value ? fmt.dateTime(value) : undefined} className="font-mono text-[0.92em]">
      {fmt.countdown(value, now)}
    </time>
  );
}

/**
 * A kind of data is a category, not a state. Each kind keeps its own colour, on an icon rather
 * than a dot: a dot beside a status badge's dot read as another status, while a table, pulse,
 * bell, chart or sigma says which kind it is even where the hue is close to a status colour.
 */
export const ROLE_ICON = {
  reference: TableIcon,
  "current-state": PulseIcon,
  "event-log": BellIcon,
  "time-series": ChartLineIcon,
  summary: SigmaIcon,
} satisfies { [role in Role]: Icon };

const ROLE_COLOR = {
  reference: "var(--color-series-1)",
  "current-state": "var(--color-series-2)",
  "event-log": "var(--color-series-3)",
  "time-series": "var(--color-series-4)",
  summary: "var(--color-series-5)",
} satisfies { [role in Role]: string };

export function RoleBadge({ role }: { role: Role }) {
  const RoleIcon = ROLE_ICON[role];
  return (
    <Badge variant="outline" icon={<RoleIcon aria-hidden="true" size={12} weight="fill" className="shrink-0" style={{ color: ROLE_COLOR[role] }} />}>
      {ROLE[role].label}
    </Badge>
  );
}

const TONE_BADGE = { ok: "success", warn: "warning", bad: "error" } as const;

export function ToneBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <Badge variant={TONE_BADGE[tone]} appearance="dot">
      {children}
    </Badge>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-kumo-brand">{children}</p>;
}

/** The heading of a section, with its explanation right under it rather than across the page. */
export function SectionHead({ eyebrow, title, id, children }: { eyebrow: string; title: string; id?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 grid gap-1.5">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 id={id} className="font-display text-2xl leading-tight text-kumo-strong sm:text-3xl">
        {title}
      </h2>
      {children ? <div className="mt-1 max-w-[42rem] text-sm text-kumo-subtle">{children}</div> : null}
    </div>
  );
}

/**
 * Cards set side by side in a grid share its rows: with `cardRows(n)` on each card (n rows: its
 * header, then each line of its body), a header or title that wraps to two lines moves the matching
 * part of every card in that row down together, instead of only its own. A card's body spans the
 * rows after its header with `bodyRows(n - 1)`. The grid's rows must be auto (the default); outside
 * a grid it lays out as before.
 *
 * `items-start` is what keeps a shared row honest: a row is as tall as the tallest card's content,
 * and without it every other card's content is stretched to that height — a row of badges beside a
 * card whose badges wrapped grew into tall ovals.
 */
const ROW_SPAN = { 2: "row-span-2", 3: "row-span-3", 4: "row-span-4" } as const;
export const cardRows = (rows: keyof typeof ROW_SPAN) => `${ROW_SPAN[rows]} grid grid-rows-subgrid gap-y-0`;
export const bodyRows = (rows: keyof typeof ROW_SPAN) => `${ROW_SPAN[rows]} grid grid-rows-subgrid content-start items-start`;

/**
 * Tags on a card, as many as fit on one line and a count of the rest. A card in a grid shares its
 * rows with its neighbours, so a second line of tags in one card is a second line of space in all of
 * them; the hidden tags are in the row's tooltip, and the page the card leads to lists them all.
 */
export function TagRow({ items, max = 3 }: { items: string[]; max?: number }) {
  if (items.length === 0) return null;
  const hidden = items.length - max;
  return (
    <div className="flex flex-wrap items-start gap-1.5" title={items.join(" · ")}>
      {items.slice(0, max).map((item) => (
        <Badge key={item} variant="outline">
          {item}
        </Badge>
      ))}
      {hidden > 0 ? <Badge variant="outline">+{hidden}</Badge> : null}
    </div>
  );
}

export function StatTile({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone }) {
  const color = tone === "bad" ? "text-kumo-danger" : tone === "warn" ? "text-kumo-warning" : tone === "ok" ? "text-kumo-success" : "text-kumo-strong";
  return (
    <LayerCard className={cardRows(2)}>
      <LayerCard.Secondary className="font-mono text-xs uppercase tracking-[0.08em]">{label}</LayerCard.Secondary>
      <LayerCard.Primary>
        <div className={`font-display text-3xl leading-none tabular-nums ${color}`}>{value}</div>
        {note ? <div className="mt-2 text-xs text-kumo-subtle">{note}</div> : null}
      </LayerCard.Primary>
    </LayerCard>
  );
}

export interface KvItem {
  term: string;
  value: ReactNode;
}

/** Term and value pairs, skipping the ones without a value. */
export function Kv({ items }: { items: (KvItem | null | false | undefined)[] }) {
  const shown = items.filter(
    (item): item is KvItem => Boolean(item) && item !== null && item !== false && item !== undefined && item.value !== null && item.value !== undefined && item.value !== "",
  );
  return (
    <dl className="grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {shown.map((item) => (
        <div key={item.term} className="contents">
          <dt className="text-kumo-subtle">{item.term}</dt>
          <dd className="min-w-0 wrap-anywhere text-kumo-default">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="grid gap-4 pb-2 pt-4 sm:pt-8">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h1 className="max-w-[22ch] font-display text-4xl leading-[1.05] text-kumo-strong sm:text-5xl">{title}</h1>
      {children ? <div className="max-w-[34rem] text-base leading-relaxed text-kumo-subtle sm:max-w-[38rem] sm:text-lg">{children}</div> : null}
    </header>
  );
}

/**
 * A failed read: what could not load, why in the server's or browser's words, and a way to try
 * again. It is an alert, so a screen reader hears it when it appears.
 */
/**
 * What a list or card looks like while it loads: lines the width of the text that will replace
 * them, instead of a spinner beside the word "Loading".
 */
export function Placeholder({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="grid gap-3">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="grid gap-2 rounded-lg bg-kumo-base p-4 ring-1 ring-kumo-line">
          <SkeletonLine minWidth={30} maxWidth={60} />
          <SkeletonLine minWidth={60} maxWidth={90} blockHeight={10} />
        </div>
      ))}
    </div>
  );
}

export function ErrorNote({ error, what = "this", onRetry }: { error: Error | undefined; what?: string; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex flex-wrap items-start gap-x-4 gap-y-2 rounded-lg bg-kumo-danger-tint px-3 py-2.5 text-sm text-kumo-danger">
      <WarningCircleIcon aria-hidden="true" size={18} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Could not load {what}.</p>
        <p className="wrap-anywhere">
          {error.message}. {onRetry ? "Try again, or reload the page." : "Reload the page to try again."}
        </p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" icon={<ArrowClockwiseIcon />} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
