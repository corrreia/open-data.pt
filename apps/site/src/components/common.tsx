import { Badge, LayerCard } from "@cloudflare/kumo";
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

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function subscribeMode(listener: () => void) {
  const onChange = () => {
    document.documentElement.dataset.mode = darkQuery.matches ? "dark" : "light";
    listener();
  };
  darkQuery.addEventListener("change", onChange);
  return () => darkQuery.removeEventListener("change", onChange);
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

// A kind of data is a category, not a state: an outlined badge keeps the label in text colours and lets a dot carry the hue.
const ROLE_DOT = {
  green: "var(--color-series-1)",
  blue: "var(--color-series-2)",
  orange: "var(--color-series-3)",
  purple: "var(--color-series-4)",
  teal: "var(--color-series-5)",
} satisfies { [badge in (typeof ROLE)[Role]["badge"]]: string };

export function RoleBadge({ role }: { role: Role }) {
  const meta = ROLE[role];
  return (
    <Badge variant="outline" icon={<span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: ROLE_DOT[meta.badge] }} />}>
      {meta.label}
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
  return <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.12em] text-kumo-brand">{children}</p>;
}

export function SectionHead({ eyebrow, title, id, children }: { eyebrow: string; title: string; id?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
      <div className="grid gap-1.5">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id={id} className="font-display text-[1.7rem] leading-tight text-kumo-strong sm:text-3xl">
          {title}
        </h2>
      </div>
      {children ? <div className="max-w-xl text-sm text-kumo-subtle">{children}</div> : null}
    </div>
  );
}

export function StatTile({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone }) {
  const color = tone === "bad" ? "text-kumo-danger" : tone === "warn" ? "text-kumo-warning" : tone === "ok" ? "text-kumo-success" : "text-kumo-strong";
  return (
    <LayerCard className="flex h-full flex-col">
      <LayerCard.Secondary className="font-mono text-[0.7rem] uppercase tracking-[0.08em]">{label}</LayerCard.Secondary>
      <LayerCard.Primary className="flex-1">
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
  const shown = items.filter((item): item is KvItem => Boolean(item) && item !== null && item !== false && item !== undefined && item.value !== null && item.value !== undefined && item.value !== "");
  return (
    <dl className="grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {shown.map((item) => (
        <div key={item.term} className="contents">
          <dt className="text-kumo-subtle">{item.term}</dt>
          <dd className="min-w-0 break-words text-kumo-default">{item.value}</dd>
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
      {children ? <div className="max-w-2xl text-base leading-relaxed text-kumo-subtle sm:text-lg">{children}</div> : null}
    </header>
  );
}

export function ErrorNote({ error }: { error: Error | undefined }) {
  if (!error) return null;
  return <p className="rounded-lg bg-kumo-danger-tint px-3 py-2 text-sm text-kumo-danger">{error.message}</p>;
}
