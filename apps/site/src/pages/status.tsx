import { Badge, Banner, Button, LayerCard, Loader, Meter } from "@cloudflare/kumo";
import { ArrowSquareOutIcon, CaretRightIcon, CheckCircleIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type PointerEvent, type ReactNode } from "react";
import { ErrorNote, PageHead, SectionHead } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { apiGet, productHref } from "../lib/api";
import { fetchFeeds, fetchProducts, publisherHref, slugify } from "../lib/catalog";
import { fmt, plural } from "../lib/format";
import { useQuery } from "../lib/query";
import type { Feed, Outage, OutageCause, OutagesResponse, Product } from "../lib/types";

const DAYS = 3;
const INCIDENTS_SHOWN = 25;
const DAY_MS = 86_400_000;
/** A day's colour follows its longest outage: a short blip, a real outage, most of the day. */
const MINOR_MS = 30 * 60_000;
const SEVERE_MS = 6 * 3_600_000;
/** Real-time feeds run every minute; nothing attempted for this long means collection has stopped. */
const STALL_MS = 10 * 60_000;

type Level = "ok" | "minor" | "major" | "severe" | "none";

const LEVELS: { level: Level; label: string }[] = [
  { level: "ok", label: "No downtime" },
  { level: "minor", label: "Under 30 min" },
  { level: "major", label: "Under 6 h" },
  { level: "severe", label: "6 h or more" },
  { level: "none", label: "Not recorded yet" },
];

const CAUSE_TEXT = {
  source: (publisher) => `${publisher ?? "The publisher"}'s service did not answer`,
  collection: () => "Collection failed on this site's side",
  platform: () => "open-data.pt was not running collections",
} satisfies { [cause in OutageCause]: (publisher: string | undefined) => string };
const CAUSE_BADGE = { source: "warning", collection: "error", platform: "neutral" } as const;
const CAUSE_LABEL = { source: "Source unavailable", collection: "Collection error", platform: "Platform paused" } as const;

interface Day {
  start: number;
  end: number;
}

interface Incident {
  label: string;
  outage: Outage;
  ms: number;
}

interface Bar {
  day: Day;
  level: Level;
  longest: number;
  affected: number;
  incidents: Incident[];
}

interface Measured {
  bars: Bar[];
  uptime: number | null;
}

/** The last `count` local calendar days, oldest first. */
function calendarDays(count: number, now: number): Day[] {
  const today = new Date(now);
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (count - 1 - index));
    return { start: start.getTime(), end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime() };
  });
}

const spanOf = (outage: Outage, now: number): [number, number] => [Date.parse(outage.startedAt), outage.endedAt ? Date.parse(outage.endedAt) : now];
const overlap = ([start, end]: [number, number], from: number, to: number) => Math.max(0, Math.min(end, to) - Math.max(start, from));
const levelOf = (longest: number): Level => (longest === 0 ? "ok" : longest < MINOR_MS ? "minor" : longest < SEVERE_MS ? "major" : "severe");

interface Member {
  label: string;
  outages: Outage[];
}

/**
 * One row of bars for a group of members (a publisher's datasets, or the platform): per day, the longest
 * outage of any member; over the window, the share of member-time that was collected.
 */
function measure(members: Member[], days: Day[], now: number, tracked: number): Measured {
  const windowStart = Math.max(days[0]?.start ?? now, tracked);
  const trackedMs = Math.max(0, now - windowStart);
  let down = 0;
  const bars = days.map((day): Bar => {
    if (day.end <= tracked) return { day, level: "none", longest: 0, affected: 0, incidents: [] };
    const from = Math.max(day.start, tracked);
    const to = Math.min(day.end, now);
    let longest = 0;
    const incidents: Incident[] = [];
    const affected = new Set<string>();
    for (const member of members) {
      let memberDown = 0;
      for (const outage of member.outages) {
        const ms = overlap(spanOf(outage, now), from, to);
        if (ms > 0) {
          memberDown += ms;
          incidents.push({ label: member.label, outage, ms });
          affected.add(member.label);
        }
      }
      longest = Math.max(longest, memberDown);
      down += memberDown;
    }
    return { day, level: levelOf(longest), longest, affected: affected.size, incidents };
  });
  return { bars, uptime: trackedMs > 0 && members.length > 0 ? 1 - down / (trackedMs * members.length) : null };
}

function uptimeText(uptime: number | null) {
  if (uptime === null) return "no record yet";
  if (uptime >= 0.99995) return "100% collected";
  return `${(Math.floor(uptime * 10_000) / 100).toFixed(2)}% collected`;
}

/* ---------- One tooltip for every bar on the page ---------- */

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

function barTip(bar: Bar, describe: (incident: Incident) => string): ReactNode {
  const summary =
    bar.level === "none" ? "Not recorded yet" : bar.level === "ok" ? "Collected all day" : bar.affected > 1 ? `${bar.affected} datasets affected, longest ${fmt.duration(bar.longest)}` : `Down for ${fmt.duration(bar.longest)}`;
  const lines = bar.incidents.map(describe);
  return (
    <>
      <strong className="text-kumo-strong">{fmt.date(bar.day.start)}</strong>
      <span>{summary}</span>
      {lines.slice(0, 4).map((line, index) => (
        <span key={index} className="text-kumo-subtle">
          {line}
        </span>
      ))}
      {lines.length > 4 ? <span className="text-kumo-subtle">and {lines.length - 4} more</span> : null}
    </>
  );
}

function Bars({ measured, label, describe, onTip, height = "h-8" }: { measured: Measured; label: string; describe: (incident: Incident) => string; onTip: (tip: TipState | null) => void; height?: string }) {
  const show = (event: PointerEvent<HTMLSpanElement>, bar: Bar) => {
    const box = event.currentTarget.getBoundingClientRect();
    onTip({ x: box.left + box.width / 2, y: box.bottom + 8, content: barTip(bar, describe) });
  };
  return (
    <span role="img" aria-label={`${label}: ${uptimeText(measured.uptime)} over the last ${DAYS} days`} className={`flex ${height} gap-[2px]`} onPointerLeave={() => onTip(null)}>
      {measured.bars.map((bar) => (
        <span key={bar.day.start} data-level={bar.level} onPointerEnter={(event) => show(event, bar)} className="uptime-bar min-w-0 flex-1 rounded-[2px] transition-opacity hover:opacity-60" />
      ))}
    </span>
  );
}

/* ---------- Page ---------- */

function useMinuteClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function StatusPage() {
  const outages = useQuery(`outages:${DAYS}`, () => apiGet<OutagesResponse>(`/api/outages?days=${DAYS}`), { staleMs: 30_000, refreshMs: 60_000 });
  const feeds = useQuery("feeds", fetchFeeds, { refreshMs: 60_000 });
  const products = useQuery("products", fetchProducts);
  const now = useMinuteClock();
  const [tip, setTip] = useState<TipState | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(window.location.hash ? [window.location.hash.slice(1)] : []));
  const [showAll, setShowAll] = useState(false);

  const model = useMemo(() => {
    if (!outages.data || !feeds.data) return undefined;
    const tracked = outages.data.trackedSince ? Date.parse(outages.data.trackedSince) : now;
    const days = calendarDays(DAYS, now);
    const enabled = feeds.data.filter((feed) => feed.enabled);
    const byFeed = new Map<string, Outage[]>();
    const platform: Outage[] = [];
    for (const outage of outages.data.data) {
      if (outage.feedId === null) platform.push(outage);
      else byFeed.set(outage.feedId, [...(byFeed.get(outage.feedId) ?? []), outage]);
    }
    const openOf = (feed: Feed) => (byFeed.get(feed.id) ?? []).find((outage) => !outage.endedAt);
    const publishers = new Map<string, Feed[]>();
    for (const feed of enabled) publishers.set(feed.publisher, [...(publishers.get(feed.publisher) ?? []), feed]);
    const rows = [...publishers.entries()]
      .map(([name, members]) => ({
        name,
        slug: slugify(name),
        members,
        failing: members.filter(openOf),
        measured: measure(members.map((feed) => ({ label: feed.title, outages: byFeed.get(feed.id) ?? [] })), days, now, tracked),
      }))
      .sort((a, b) => Number(b.failing.length > 0) - Number(a.failing.length > 0) || a.name.localeCompare(b.name));
    return {
      tracked,
      days,
      enabled,
      byFeed,
      openOf,
      rows,
      platform: measure([{ label: "Collection", outages: platform }], days, now, tracked),
      lastAttempt: enabled.map((feed) => feed.lastAttemptAt).filter((value): value is string => Boolean(value)).sort().at(-1),
    };
  }, [outages.data, feeds.data, now]);

  // An address like /status/#pub-carris-metropolitana opens and scrolls to that publisher.
  useEffect(() => {
    if (!model || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [model]);

  const firstProduct = useMemo(() => {
    const map = new Map<string, Product>();
    for (const product of products.data ?? []) if (!map.has(product.feedId)) map.set(product.feedId, product);
    return map;
  }, [products.data]);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Shell section="status">
      <section className="grid gap-5">
        <PageHead eyebrow="Status" title="Is everything being collected?" />
        <ErrorNote error={outages.error ?? feeds.error} />
        {model ? <StateBanner model={model} now={now} /> : <div className="flex items-center gap-2 text-sm text-kumo-subtle"><Loader size="sm" /> Checking collection…</div>}
        <p className="text-xs text-kumo-subtle">
          {outages.data?.trackedSince ? `Downtime has been recorded since ${fmt.dateTime(outages.data.trackedSince)}; earlier days show as not recorded. Updated every minute.` : "No downtime has been recorded yet."}
        </p>
      </section>

      {model ? (
        <>
          <section aria-labelledby="platform-title">
            <SectionHead eyebrow="Platform" title="Collection on open-data.pt" id="platform-title">
              Whether this site was running its collections at all. When it stops, every dataset stops updating.
            </SectionHead>
            <LayerCard>
              <LayerCard.Primary className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-kumo-strong">Collection runs</span>
                  <span className="flex items-center gap-3">
                    <Badge variant="success" appearance="dot">Running</Badge>
                    <span className="font-mono text-xs text-kumo-subtle">{uptimeText(model.platform.uptime)}</span>
                  </span>
                </div>
                <Bars measured={model.platform} label="Collection runs" onTip={setTip} describe={(incident) => `Stopped for ${fmt.duration(incident.ms)}`} />
              </LayerCard.Primary>
            </LayerCard>
          </section>

          <section aria-labelledby="sources-title">
            <SectionHead eyebrow="Sources" title="Each publisher, day by day" id="sources-title">
              A day turns amber or red when one of the publisher's datasets could not be collected, because their service did not answer or collection failed here. Open a publisher to see each dataset.
            </SectionHead>
            <Legend />
            <LayerCard className="overflow-hidden p-0">
              <ul className="divide-y divide-kumo-hairline">
                {model.rows.map((row) => {
                  const id = `pub-${row.slug}`;
                  const expanded = open.has(id);
                  return (
                    <li key={row.slug} id={id} className="scroll-mt-24">
                      <div className="grid gap-3 px-4 py-3.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <button type="button" onClick={() => toggle(id)} aria-expanded={expanded} className="flex min-w-0 items-center gap-1.5 text-left font-semibold text-kumo-strong">
                            <CaretRightIcon size={14} className={`shrink-0 text-kumo-subtle transition-transform ${expanded ? "rotate-90" : ""}`} />
                            <span className="truncate">{row.name}</span>
                          </button>
                          <a href={publisherHref(row.name)} aria-label={`${row.name}'s datasets`} className="text-kumo-subtle hover:text-kumo-strong">
                            <ArrowSquareOutIcon size={14} />
                          </a>
                          <span className="ml-auto flex items-center gap-3">
                            {row.failing.length ? <Badge variant="warning" appearance="dot">{row.failing.length} of {row.members.length} not collecting</Badge> : <Badge variant="success" appearance="dot">Collecting</Badge>}
                            <span className="hidden font-mono text-xs text-kumo-subtle sm:inline">{uptimeText(row.measured.uptime)}</span>
                          </span>
                        </div>
                        <Bars measured={row.measured} label={row.name} onTip={setTip} describe={(incident) => `${incident.label}: ${fmt.duration(incident.ms)}, ${CAUSE_TEXT[incident.outage.cause](row.name).toLowerCase()}`} />
                      </div>
                      {expanded ? (
                        <div className="grid gap-4 border-t border-kumo-hairline bg-kumo-recessed px-4 py-4 sm:pl-9">
                          {row.measured.uptime !== null ? (
                            <Meter label={`${row.name} over the last ${DAYS} days`} value={Math.round(row.measured.uptime * 10_000) / 100} customValue={uptimeText(row.measured.uptime)} indicatorClassName="from-kumo-success via-kumo-success to-kumo-success" />
                          ) : null}
                          <ul className="grid gap-3">
                            {row.members.map((feed) => {
                              const current = model.openOf(feed);
                              const product = firstProduct.get(feed.id);
                              const measured = measure([{ label: feed.title, outages: model.byFeed.get(feed.id) ?? [] }], model.days, now, model.tracked);
                              return (
                                <li key={feed.id} className="grid gap-2">
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                    {product ? <a href={productHref(product.slug)} className="font-medium text-kumo-default hover:underline">{feed.title}</a> : <span className="font-medium">{feed.title}</span>}
                                    <span className="ml-auto flex items-center gap-3">
                                      {current ? <Badge variant={CAUSE_BADGE[current.cause]} appearance="dot">{CAUSE_LABEL[current.cause]}</Badge> : <Badge variant="success" appearance="dot">Collecting</Badge>}
                                      <span className="hidden font-mono text-xs text-kumo-subtle sm:inline">{uptimeText(measured.uptime)}</span>
                                    </span>
                                  </div>
                                  <Bars measured={measured} label={feed.title} height="h-5" onTip={setTip} describe={(incident) => `${fmt.duration(incident.ms)}, ${CAUSE_TEXT[incident.outage.cause](feed.publisher).toLowerCase()}`} />
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </LayerCard>
          </section>

          <section aria-labelledby="incidents-title">
            <SectionHead eyebrow="History" title="Past incidents" id="incidents-title">
              The last {DAYS} days, newest first. <a href="/operations/#activity" className="font-medium text-kumo-link">Every run, as it happens</a>
            </SectionHead>
            <Incidents outages={outages.data?.data ?? []} feeds={feeds.data ?? []} firstProduct={firstProduct} now={now} showAll={showAll} onShowAll={() => setShowAll(true)} />
          </section>
        </>
      ) : null}

      {tip ? (
        <div role="tooltip" className="pointer-events-none fixed z-50 grid max-w-[min(22rem,calc(100vw-1rem))] -translate-x-1/2 gap-0.5 rounded-lg bg-kumo-base px-3 py-2 text-xs shadow-lg ring-1 ring-kumo-line" style={{ left: Math.min(window.innerWidth - 180, Math.max(180, tip.x)), top: tip.y }}>
          {tip.content}
        </div>
      ) : null}
    </Shell>
  );
}

interface Model {
  enabled: Feed[];
  openOf: (feed: Feed) => Outage | undefined;
  lastAttempt: string | undefined;
}

function StateBanner({ model, now }: { model: Model; now: number }) {
  const failing = model.enabled.filter(model.openOf);
  if (model.lastAttempt && now - Date.parse(model.lastAttempt) > STALL_MS) {
    return <Banner variant="error" icon={<WarningCircleIcon weight="fill" />} title="Collection seems to have stopped." description={`No dataset has been collected since ${fmt.dateTime(model.lastAttempt)}. Data already published stays available.`} />;
  }
  if (failing.length > 0) {
    const publishers = [...new Set(failing.map((feed) => feed.publisher))];
    return (
      <Banner
        variant="alert"
        icon={<WarningIcon weight="fill" />}
        title={`${fmt.int(failing.length)} of ${fmt.int(model.enabled.length)} datasets ${failing.length === 1 ? "is" : "are"} not being collected right now.`}
        description={`Affected: ${publishers.join(", ")}. Their last published data stays available and collection retries by itself.`}
      />
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-xl bg-kumo-success-tint px-4 py-3.5 ring-1 ring-kumo-success/25">
      <CheckCircleIcon weight="fill" size={22} className="mt-0.5 shrink-0 text-kumo-success" />
      <div className="grid gap-0.5">
        <p className="font-display text-xl text-kumo-success">All {fmt.int(model.enabled.length)} datasets are being collected.</p>
        <p className="text-sm text-kumo-subtle">Every source answered its last collection.</p>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div aria-hidden="true" className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 font-mono text-[0.7rem] text-kumo-subtle">
      <span>Last {DAYS} days</span>
      <span className="flex flex-wrap gap-x-4 gap-y-1 font-sans text-xs">
        {LEVELS.map(({ level, label }) => (
          <span key={level} className="inline-flex items-center gap-1.5">
            <span data-level={level} className="uptime-bar inline-block h-3.5 w-2 rounded-[2px]" />
            {label}
          </span>
        ))}
      </span>
      <span>Today</span>
    </div>
  );
}

function Incidents({ outages, feeds, firstProduct, now, showAll, onShowAll }: { outages: Outage[]; feeds: Feed[]; firstProduct: Map<string, Product>; now: number; showAll: boolean; onShowAll: () => void }) {
  const feedsById = new Map(feeds.map((feed) => [feed.id, feed]));
  const since = now - DAYS * DAY_MS;
  const recent = outages
    .filter((outage) => spanOf(outage, now)[1] >= since && (outage.feedId === null || feedsById.has(outage.feedId)))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (recent.length === 0) {
    return (
      <LayerCard>
        <LayerCard.Primary className="flex items-center gap-2 text-sm text-kumo-subtle">
          <CheckCircleIcon className="text-kumo-success" /> No incidents in the last {DAYS} days.
        </LayerCard.Primary>
      </LayerCard>
    );
  }
  const shown = showAll ? recent : recent.slice(0, INCIDENTS_SHOWN);
  const days = new Map<string, Outage[]>();
  for (const outage of shown) {
    const key = new Date(outage.startedAt).toDateString();
    days.set(key, [...(days.get(key) ?? []), outage]);
  }
  return (
    <div className="grid gap-5">
      {[...days.values()].map((group) => (
        <div key={group[0]?.startedAt} className="grid gap-2">
          <h3 className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-kumo-subtle">{fmt.date(group[0]?.startedAt)}</h3>
          {group.map((outage) => {
            const feed = outage.feedId ? feedsById.get(outage.feedId) : undefined;
            const product = outage.feedId ? firstProduct.get(outage.feedId) : undefined;
            const [start, end] = spanOf(outage, now);
            const ongoing = !outage.endedAt;
            return (
              <LayerCard key={`${outage.feedId}-${outage.startedAt}`} className={ongoing ? "ring-2 ring-kumo-warning/40" : undefined}>
                <LayerCard.Secondary className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="tabular-nums">
                    {ongoing ? `Since ${fmt.time(outage.startedAt)}` : `${fmt.time(outage.startedAt)} to ${fmt.time(outage.endedAt)}`}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={CAUSE_BADGE[outage.cause]}>{CAUSE_LABEL[outage.cause]}</Badge>
                    <Badge variant={ongoing ? "warning" : "outline"}>{ongoing ? `ongoing, ${fmt.duration(end - start)} so far` : fmt.duration(end - start)}</Badge>
                  </span>
                </LayerCard.Secondary>
                <LayerCard.Primary className="grid gap-1">
                  <p className="font-medium text-kumo-strong">
                    {feed ? (
                      <>
                        <a href={publisherHref(feed.publisher)} className="hover:underline">{feed.publisher}</a>
                        <span className="text-kumo-subtle"> · </span>
                        {product ? <a href={productHref(product.slug)} className="hover:underline">{feed.title}</a> : feed.title}
                      </>
                    ) : (
                      "All datasets"
                    )}
                  </p>
                  <p className="text-sm text-kumo-subtle">
                    {CAUSE_TEXT[outage.cause](feed?.publisher)}
                    {outage.failures > 1 ? ` (${plural(outage.failures, "attempt")})` : ""}.
                  </p>
                  {outage.lastError ? <p className="break-words font-mono text-[0.72rem] text-kumo-subtle">{outage.lastError.length > 180 ? `${outage.lastError.slice(0, 177)}…` : outage.lastError}</p> : null}
                </LayerCard.Primary>
              </LayerCard>
            );
          })}
        </div>
      ))}
      {recent.length > shown.length ? (
        <Button variant="secondary" className="justify-self-start" onClick={onShowAll}>
          Show all {recent.length} incidents
        </Button>
      ) : null}
    </div>
  );
}

mountPage(<StatusPage />);
