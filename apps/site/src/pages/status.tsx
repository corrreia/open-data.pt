import { Badge, Banner, Button, LayerCard, Loader, Meter } from "@cloudflare/kumo";
import { ArrowSquareOutIcon, CaretRightIcon, CheckCircleIcon, WarningCircleIcon, WarningIcon } from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ErrorNote, PageHead, SectionHead } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { apiGet, productHref } from "../lib/api";
import { fetchFeeds, fetchProducts, publisherHref } from "../lib/catalog";
import { fmt, plural } from "../lib/format";
import { useQuery } from "../lib/query";
import {
  STATUS_DAYS as DAYS,
  STATUS_HOURS,
  statusHours,
  measureStatus as measure,
  outageSpan as spanOf,
  type StatusBar as Bar,
  type StatusIncident as Incident,
  type StatusLevel as Level,
  type StatusMeasurement as Measured,
  type StatusMember as Member,
} from "../lib/status-history";
import type { Feed, Outage, OutageCause, OutagesResponse, Product } from "../lib/types";

const INCIDENTS_SHOWN = 25;
/** Incidents read out per hour; the tooltip shows four. */
const SPOKEN_INCIDENTS = 10;
const DAY_MS = 86_400_000;
/** Real-time feeds run every minute; nothing attempted for this long means collection has stopped. */
const STALL_MS = 10 * 60_000;

const LEVELS: { level: Level; label: string }[] = [
  { level: "ok", label: "No recorded issues" },
  { level: "major", label: "Partly affected" },
  { level: "severe", label: "All tracked time affected" },
  { level: "none", label: "Not tracked" },
];

/** Why an outage happened, as the middle of a sentence: publisher names keep their capitals. */
const CAUSE_CLAUSE = {
  source: (publisher) => `${publisher ?? "the publisher"}’s service did not answer`,
  collection: () => "collection failed on this site’s side",
  platform: () => "open-data.pt was not running collections",
} satisfies { [cause in OutageCause]: (publisher: string | undefined) => string };

/** The same, starting a sentence; the site's name stays lower case. */
const causeSentence = (cause: OutageCause, publisher: string | undefined) => {
  const clause = CAUSE_CLAUSE[cause](publisher);
  return clause.startsWith("open-data.pt") ? clause : `${clause.charAt(0).toLocaleUpperCase()}${clause.slice(1)}`;
};
const CAUSE_BADGE = { source: "warning", collection: "error", platform: "neutral" } as const;
const CAUSE_LABEL = { source: "Source unavailable", collection: "Collection error", platform: "Platform paused" } as const;

function feedMember(feed: Feed, outages: Outage[]): Member {
  const member: Member = { label: feed.title, outages };
  const created = feed.createdAt ? Date.parse(feed.createdAt) : Number.NaN;
  if (Number.isFinite(created)) member.since = created;
  return member;
}

function uptimeText(uptime: number | null) {
  if (uptime === null) return "no record yet";
  if (uptime >= 0.99995) return "100% issue-free";
  return `${(Math.floor(uptime * 10_000) / 100).toFixed(2)}% issue-free`;
}

/* ---------- One tooltip for every bar on the page ---------- */

interface TipState {
  x: number;
  y: number;
  content: ReactNode;
}

const HOUR_LABEL = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "shortOffset" });

function hourLabel(bar: Bar): string {
  return `${HOUR_LABEL.format(bar.hour.start)} to ${HOUR_LABEL.format(bar.hour.end)}`;
}

function hourSummary(bar: Bar): string {
  if (bar.level === "none") return "No tracked collection history";
  if (bar.level === "ok") return "No recorded collection issues during tracked time";
  return `${bar.affected} of ${bar.trackedMembers} tracked datasets affected, up to ${fmt.duration(bar.longest)} in this hour`;
}

interface BarNotes {
  partlyTracked: boolean;
  lines: string[];
}

/** Details beyond the hour's summary: a partially tracked hour and each incident. Shared by the tooltip and screen readers. */
function barNotes(bar: Bar, describe: (incident: Incident) => string, now: number): BarNotes {
  return {
    partlyTracked: bar.observedMs > 0 && bar.observedMs < Math.min(bar.hour.end, now) - bar.hour.start,
    lines: bar.incidents.map(describe),
  };
}

/** A bounded, spoken form of the tooltip's details, or undefined when there is nothing beyond the label. */
function barDescription(bar: Bar, describe: (incident: Incident) => string, now: number): string | undefined {
  const { partlyTracked, lines } = barNotes(bar, describe, now);
  const spoken = [...(partlyTracked ? ["Tracking began during this hour."] : []), ...lines.slice(0, SPOKEN_INCIDENTS)];
  if (lines.length > SPOKEN_INCIDENTS) spoken.push(`and ${lines.length - SPOKEN_INCIDENTS} more`);
  return spoken.length > 0 ? spoken.join(". ") : undefined;
}

function barTip(bar: Bar, describe: (incident: Incident) => string, now: number): ReactNode {
  const { partlyTracked, lines } = barNotes(bar, describe, now);
  return (
    <>
      <strong className="text-kumo-strong">{hourLabel(bar)}</strong>
      {bar.hour.end > now ? <span>Current hour, in progress</span> : null}
      <span>{hourSummary(bar)}</span>
      {partlyTracked ? <span>Tracking began during this hour.</span> : null}
      {lines.slice(0, 4).map((line, index) => (
        <span key={index} className="text-kumo-subtle">
          {line}
        </span>
      ))}
      {lines.length > 4 ? <span className="text-kumo-subtle">and {lines.length - 4} more</span> : null}
    </>
  );
}

function Bars({
  measured,
  label,
  describe,
  onTip,
  now,
  height = "h-8",
}: {
  measured: Measured;
  label: string;
  describe: (incident: Incident) => string;
  onTip: (tip: TipState | null) => void;
  now: number;
  height?: string;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const instructions = useId();
  const detailsPrefix = useId();
  const descriptions = measured.bars.map((bar) => barDescription(bar, describe, now));
  const [active, setActive] = useState(STATUS_HOURS - 1);
  const show = (element: HTMLButtonElement, bar: Bar) => {
    const box = element.getBoundingClientRect();
    onTip({ x: box.left + box.width / 2, y: box.bottom + 8, content: barTip(bar, describe, now) });
  };
  return (
    <span>
      <span id={instructions} className="sr-only">
        One bar per hour. Use left and right arrows to inspect hours, Home and End to jump, and Escape to dismiss details.
      </span>
      {descriptions.map((description, index) =>
        description ? (
          <span key={index} id={`${detailsPrefix}-${index}`} className="sr-only">
            {description}
          </span>
        ) : null,
      )}
      <span
        ref={root}
        role="group"
        data-status-timeline
        aria-describedby={instructions}
        aria-label={`${label}: ${uptimeText(measured.uptime)} over ${STATUS_HOURS} hourly slots`}
        className={`flex ${height} items-end gap-px sm:gap-[2px]`}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse" && !root.current?.contains(document.activeElement)) onTip(null);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onTip(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onTip(null);
            return;
          }
          const next =
            event.key === "ArrowLeft"
              ? Math.max(0, active - 1)
              : event.key === "ArrowRight"
                ? Math.min(STATUS_HOURS - 1, active + 1)
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? STATUS_HOURS - 1
                    : undefined;
          if (next === undefined) return;
          event.preventDefault();
          root.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
        }}
      >
        {measured.bars.map((bar, index) => (
          <button
            key={bar.hour.start}
            type="button"
            tabIndex={active === index ? 0 : -1}
            data-level={bar.level}
            data-hour-start={bar.hour.start}
            data-current={bar.hour.end > now}
            aria-label={`${hourLabel(bar)}: ${hourSummary(bar)}${bar.hour.end > now ? "; current hour in progress" : ""}`}
            aria-describedby={descriptions[index] ? `${detailsPrefix}-${index}` : undefined}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") show(event.currentTarget, bar);
            }}
            onFocus={(event) => {
              setActive(index);
              show(event.currentTarget, bar);
            }}
            onClick={(event) => {
              setActive(index);
              show(event.currentTarget, bar);
            }}
            className="uptime-bar min-w-0 flex-1 rounded-[2px] border-0 p-0 hover:outline hover:outline-1 hover:outline-offset-1 hover:outline-kumo-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kumo-strong"
          />
        ))}
      </span>
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
  const tipHalfWidth = Math.min(176, (window.innerWidth - 16) / 2);

  useEffect(() => {
    if (!tip) return;
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-status-timeline]")) setTip(null);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [tip]);

  const model = useMemo(() => {
    if (!outages.data || !feeds.data) return undefined;
    const tracked = outages.data.trackedSince ? Date.parse(outages.data.trackedSince) : now;
    const hours = statusHours(now);
    const enabled = feeds.data.filter((feed) => feed.enabled);
    const byFeed = new Map<string, Outage[]>();
    const platform: Outage[] = [];
    for (const outage of outages.data.data) {
      if (outage.feedId === null) platform.push(outage);
      else byFeed.set(outage.feedId, [...(byFeed.get(outage.feedId) ?? []), outage]);
    }
    const openOf = (feed: Feed) => (byFeed.get(feed.id) ?? []).find((outage) => !outage.endedAt);
    const publishers = new Map<string, Feed[]>();
    for (const feed of enabled) publishers.set(feed.publisher.id, [...(publishers.get(feed.publisher.id) ?? []), feed]);
    const rows = [...publishers.entries()]
      .map(([slug, members]) => ({
        name: members[0]?.publisher.name ?? slug,
        slug,
        members,
        failing: members.filter(openOf),
        measured: measure(
          members.map((feed) => feedMember(feed, byFeed.get(feed.id) ?? [])),
          hours,
          now,
          tracked,
        ),
      }))
      .sort((a, b) => Number(b.failing.length > 0) - Number(a.failing.length > 0) || a.name.localeCompare(b.name));
    return {
      tracked,
      hours,
      enabled,
      byFeed,
      openOf,
      rows,
      platform: measure([{ label: "Collection", outages: platform }], hours, now, tracked),
      lastAttempt: enabled
        .map((feed) => feed.lastAttemptAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1),
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
  // The catalog counts a dataset once it serves a table or series; a feed with none yet is collected but not counted.
  // The banner counts the failing ones from this same set, so its two numbers always belong together.
  const counted = model ? (products.data ? model.enabled.filter((feed) => firstProduct.has(feed.id)) : model.enabled) : [];

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
        {/* One state at a time: the error, or the wait, or the answer. */}
        <ErrorNote
          error={outages.error ?? feeds.error}
          what="the collection status"
          onRetry={() => {
            void outages.refetch();
            void feeds.refetch();
          }}
        />
        {model ? (
          <StateBanner model={model} now={now} counted={counted} />
        ) : outages.error || feeds.error ? null : (
          <div className="flex items-center gap-2 text-sm text-kumo-subtle">
            <Loader size="sm" /> Checking collection…
          </div>
        )}
        {outages.data ? (
          <p className="text-xs text-kumo-subtle">
            {outages.data.trackedSince
              ? `Collection incidents have been recorded since ${fmt.dateTime(outages.data.trackedSince)}; earlier hours are not tracked. Updated every minute.`
              : "No collection history has been recorded yet."}
          </p>
        ) : null}
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
                    <Badge variant="success" appearance="dot">
                      Running
                    </Badge>
                    <span className="font-mono text-xs text-kumo-subtle">{uptimeText(model.platform.uptime)}</span>
                  </span>
                </div>
                <Bars now={now} measured={model.platform} label="Collection runs" onTip={setTip} describe={(incident) => `Stopped for ${fmt.duration(incident.ms)}`} />
              </LayerCard.Primary>
            </LayerCard>
          </section>

          <section aria-labelledby="sources-title">
            <SectionHead eyebrow="Sources" title="Each publisher, hour by hour" id="sources-title">
              One bar per hour across {DAYS} days, including the current hour in progress. Hours with a recorded collection issue are drawn full height and in warmer colours. These
              are collection records, not checks of the publishers’ websites. Percentages leave out untracked time.
            </SectionHead>
            <Legend start={model.hours[0]?.start ?? now} />
            <LayerCard className="overflow-hidden p-0">
              <ul className="divide-y divide-kumo-hairline">
                {model.rows.map((row) => {
                  const id = `pub-${row.slug}`;
                  const expanded = open.has(id);
                  return (
                    <li key={row.slug} id={id}>
                      {/* minmax(0,1fr): an auto track grows to the widest row inside it and pushes the badge past the card's edge. */}
                      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 py-3.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <button
                            type="button"
                            onClick={() => toggle(id)}
                            aria-expanded={expanded}
                            className="flex min-w-0 items-center gap-1.5 text-left font-semibold text-kumo-strong"
                          >
                            <CaretRightIcon size={14} weight="bold" className={`shrink-0 text-kumo-subtle transition-transform ${expanded ? "rotate-90" : ""}`} />
                            <span className="min-w-0 wrap-break-word">{row.name}</span>
                          </button>
                          <a
                            href={publisherHref(row.slug)}
                            aria-label={`${row.name}’s datasets`}
                            className="grid size-6 place-items-center rounded text-kumo-subtle hover:text-kumo-strong"
                          >
                            <ArrowSquareOutIcon size={14} aria-hidden="true" />
                          </a>
                          <span className="ml-auto flex items-center gap-3">
                            {row.failing.length ? (
                              <Badge variant="warning" appearance="dot">
                                {row.failing.length} of {row.members.length} not collecting
                              </Badge>
                            ) : (
                              <Badge variant="success" appearance="dot">
                                Collecting
                              </Badge>
                            )}
                            <span className="hidden font-mono text-xs text-kumo-subtle sm:inline">{uptimeText(row.measured.uptime)}</span>
                          </span>
                        </div>
                        <Bars
                          now={now}
                          measured={row.measured}
                          label={row.name}
                          onTip={setTip}
                          describe={(incident) => `${incident.label}: ${fmt.duration(incident.ms)}, ${CAUSE_CLAUSE[incident.outage.cause](row.name)}`}
                        />
                      </div>
                      {expanded ? (
                        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 border-t border-kumo-hairline bg-kumo-recessed px-4 py-4 sm:pl-9">
                          {row.measured.uptime !== null ? (
                            <Meter
                              label={`${row.name} over the last ${DAYS} days`}
                              value={Math.round(row.measured.uptime * 10_000) / 100}
                              customValue={uptimeText(row.measured.uptime)}
                              indicatorClassName="from-kumo-success via-kumo-success to-kumo-success"
                            />
                          ) : null}
                          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
                            {row.members.map((feed) => {
                              const current = model.openOf(feed);
                              const product = firstProduct.get(feed.id);
                              const measured = measure([feedMember(feed, model.byFeed.get(feed.id) ?? [])], model.hours, now, model.tracked);
                              return (
                                <li key={feed.id} className="grid grid-cols-[minmax(0,1fr)] gap-2">
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                                    {product ? (
                                      <a href={productHref(product.slug)} className="font-medium text-kumo-default hover:underline">
                                        {feed.title}
                                      </a>
                                    ) : (
                                      <span className="font-medium">{feed.title}</span>
                                    )}
                                    <span className="ml-auto flex items-center gap-3">
                                      {current ? (
                                        <Badge variant={CAUSE_BADGE[current.cause]} appearance="dot">
                                          {CAUSE_LABEL[current.cause]}
                                        </Badge>
                                      ) : (
                                        <Badge variant="success" appearance="dot">
                                          Collecting
                                        </Badge>
                                      )}
                                      <span className="hidden font-mono text-xs text-kumo-subtle sm:inline">{uptimeText(measured.uptime)}</span>
                                    </span>
                                  </div>
                                  <Bars
                                    now={now}
                                    measured={measured}
                                    label={feed.title}
                                    height="h-5"
                                    onTip={setTip}
                                    describe={(incident) => `${fmt.duration(incident.ms)}, ${CAUSE_CLAUSE[incident.outage.cause](feed.publisher.name)}`}
                                  />
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
              The last {DAYS} days, newest first.{" "}
              <a href="/operations/#activity" className="font-medium text-kumo-link">
                Every run, as it happens
              </a>
            </SectionHead>
            <Incidents outages={outages.data?.data ?? []} feeds={feeds.data ?? []} firstProduct={firstProduct} now={now} showAll={showAll} onShowAll={() => setShowAll(true)} />
          </section>
        </>
      ) : null}

      {tip ? (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 grid max-h-[min(240px,calc(100vh-1rem))] max-w-[min(22rem,calc(100vw-1rem))] -translate-x-1/2 gap-0.5 overflow-hidden rounded-lg bg-kumo-overlay px-3 py-2 text-xs shadow-md outline outline-kumo-line"
          style={{ left: Math.max(tipHalfWidth + 8, Math.min(window.innerWidth - tipHalfWidth - 8, tip.x)), top: Math.max(8, Math.min(window.innerHeight - 248, tip.y)) }}
        >
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

/** `counted` are the feeds the catalog counts as datasets, so both of the banner's numbers come from one set. */
function StateBanner({ model, now, counted }: { model: Model; now: number; counted: Feed[] }) {
  const failing = counted.filter(model.openOf);
  if (model.lastAttempt && now - Date.parse(model.lastAttempt) > STALL_MS) {
    return (
      <Banner
        variant="error"
        icon={<WarningCircleIcon weight="fill" />}
        title="Collection seems to have stopped."
        description={`No dataset has been collected since ${fmt.dateTime(model.lastAttempt)}. Data already published stays available.`}
      />
    );
  }
  if (failing.length > 0) {
    const publishers = [...new Set(failing.map((feed) => feed.publisher.name))];
    return (
      <Banner
        variant="alert"
        icon={<WarningIcon weight="fill" />}
        title={`${fmt.int(failing.length)} of ${fmt.int(counted.length)} datasets ${failing.length === 1 ? "is" : "are"} not being collected right now.`}
        description={`Affected: ${publishers.join(", ")}. Their last published data stays available and collection retries by itself.`}
      />
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-xl bg-kumo-success-tint px-4 py-3.5 ring-1 ring-kumo-success/25">
      <CheckCircleIcon weight="fill" size={22} className="mt-0.5 shrink-0 text-kumo-success" />
      <div className="grid gap-0.5">
        <p className="font-display text-xl text-kumo-success">All {fmt.int(counted.length)} datasets are being collected.</p>
        <p className="text-sm text-kumo-subtle">Every source answered its last collection.</p>
      </div>
    </div>
  );
}

function Legend({ start }: { start: number }) {
  return (
    <div aria-hidden="true" className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 font-mono text-xs text-kumo-subtle">
      <span>{fmt.dateTime(start)}</span>
      <span className="flex flex-wrap gap-x-4 gap-y-1 font-sans text-xs">
        {LEVELS.map(({ level, label }) => (
          <span key={level} className="inline-flex items-center gap-1.5">
            <span className="flex h-3.5 items-end">
              <span data-level={level} className={`uptime-bar inline-block w-2 rounded-[2px] ${level === "ok" || level === "none" ? "h-2.5" : "h-3.5"}`} />
            </span>
            {label}
          </span>
        ))}
      </span>
      <span>Now · {STATUS_HOURS} hourly bars</span>
    </div>
  );
}

function Incidents({
  outages,
  feeds,
  firstProduct,
  now,
  showAll,
  onShowAll,
}: {
  outages: Outage[];
  feeds: Feed[];
  firstProduct: Map<string, Product>;
  now: number;
  showAll: boolean;
  onShowAll: () => void;
}) {
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
          <h3 className="font-mono text-xs uppercase tracking-[0.08em] text-kumo-subtle">{fmt.date(group[0]?.startedAt)}</h3>
          {group.map((outage) => {
            const feed = outage.feedId ? feedsById.get(outage.feedId) : undefined;
            const product = outage.feedId ? firstProduct.get(outage.feedId) : undefined;
            const [start, end] = spanOf(outage, now);
            const ongoing = !outage.endedAt;
            return (
              <LayerCard key={`${outage.feedId}-${outage.startedAt}`} className={ongoing ? "ring-2 ring-kumo-warning/40" : undefined}>
                <LayerCard.Secondary className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="tabular-nums">{ongoing ? `Since ${fmt.time(outage.startedAt)}` : `${fmt.time(outage.startedAt)} to ${fmt.time(outage.endedAt)}`}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant={CAUSE_BADGE[outage.cause]}>{CAUSE_LABEL[outage.cause]}</Badge>
                    <Badge variant={ongoing ? "warning" : "outline"}>{ongoing ? `ongoing, ${fmt.duration(end - start)} so far` : fmt.duration(end - start)}</Badge>
                  </span>
                </LayerCard.Secondary>
                <LayerCard.Primary className="grid gap-1">
                  <p className="font-medium text-kumo-strong">
                    {feed ? (
                      <>
                        <a href={publisherHref(feed.publisher.id)} className="hover:underline">
                          {feed.publisher.name}
                        </a>
                        <span className="text-kumo-subtle"> · </span>
                        {product ? (
                          <a href={productHref(product.slug)} className="hover:underline">
                            {feed.title}
                          </a>
                        ) : (
                          feed.title
                        )}
                      </>
                    ) : (
                      "All datasets"
                    )}
                  </p>
                  <p className="text-sm text-kumo-subtle">
                    {causeSentence(outage.cause, feed?.publisher.name)}
                    {outage.failures > 1 ? ` (${plural(outage.failures, "attempt")})` : ""}.
                  </p>
                  {outage.lastError ? (
                    <p className="wrap-anywhere font-mono text-xs text-kumo-subtle">{outage.lastError.length > 180 ? `${outage.lastError.slice(0, 177)}…` : outage.lastError}</p>
                  ) : null}
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
