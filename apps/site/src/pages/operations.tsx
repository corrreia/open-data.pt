import { Badge, Button, Loader, Popover, Select } from "@cloudflare/kumo";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { DataTable, type Column } from "../components/DataTable";
import { Countdown, ErrorNote, PageHead, RelativeTime, SectionHead } from "../components/common";
import { mountPage } from "../components/mount";
import { Activity, type FeedLookup } from "../components/ops/Activity";
import { HealthBadge, HealthWord, feedHealth, healthLabel, type Health } from "../components/ops/health";
import { RunBadge, acquisitionsKey, fetchAcquisitions, runStatus, triggerLabel } from "../components/ops/runs";
import { useHashLanding } from "../components/ops/useHashLanding";
import { Shell } from "../components/Shell";
import { productHref } from "../lib/api";
import { fetchFeeds, fetchProducts, formatOf } from "../lib/catalog";
import { fmt, plural } from "../lib/format";
import { useQuery } from "../lib/query";
import type { Acquisition, Feed, Product } from "../lib/types";

interface PageSection {
  id: string;
  label: string;
}

const SECTIONS: PageSection[] = [
  { id: "activity", label: "Activity" },
  { id: "feeds", label: "Feeds" },
  { id: "acquisitions", label: "Acquisitions" },
];

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

/* ---------- Links that stay short in a cell or a card ---------- */

interface Named {
  id: string;
  title: string;
  href?: string;
}

/** A few names inline; the rest behind a "+N" popover, so a policy used by twenty feeds keeps its card short. */
function NameList({ items, shown = 2, noun }: { items: Named[]; shown?: number; noun: string }) {
  if (items.length === 0) return <span className="text-kumo-subtle">—</span>;
  const rest = items.slice(shown);
  const name = (item: Named) =>
    item.href ? (
      <a href={item.href} title={item.title} className="inline-block max-w-[13rem] truncate align-bottom text-kumo-link hover:underline">
        {item.title}
      </a>
    ) : (
      <Badge variant="outline" className="max-w-full">
        <span className="truncate" title={item.title}>
          {item.title}
        </span>
      </Badge>
    );
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {items.slice(0, shown).map((item) => (
        <span key={item.id} className="min-w-0 max-w-full">
          {name(item)}
        </span>
      ))}
      {rest.length ? (
        <Popover>
          <Popover.Trigger render={<Button variant="secondary" size="sm" aria-label={`${plural(rest.length, `more ${noun}`)}`} />}>+{rest.length}</Popover.Trigger>
          <Popover.Content className="max-h-72 w-72 max-w-[90vw] overflow-y-auto p-3">
            <ul className="grid gap-1.5 text-sm">
              {rest.map((item) => (
                <li key={item.id} className="min-w-0 truncate">
                  {item.href ? (
                    <a href={item.href} className="text-kumo-link hover:underline">
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                </li>
              ))}
            </ul>
          </Popover.Content>
        </Popover>
      ) : null}
    </span>
  );
}

const productLinks = (products: Product[]): Named[] => products.map((product) => ({ id: product.id, title: product.title, href: productHref(product.slug) }));

/* ---------- Feeds ---------- */

interface FeedRow {
  feed: Feed;
  source: string;
  cadence: number | undefined;
  health: Health;
  label: string;
  products: Product[];
}

const FEED_COLUMNS: Column<FeedRow>[] = [
  {
    key: "feed",
    header: "Feed",
    sort: (row) => row.feed.title,
    text: (row) => `${row.feed.title} ${row.feed.publisher} ${row.source}`,
    className: "min-w-[16rem] whitespace-normal",
    cell: (row) => (
      <span className="grid gap-0.5">
        <span className="font-medium text-kumo-strong">{row.feed.title}</span>
        <span className="text-xs text-kumo-subtle">
          {row.feed.publisher} · {row.source}
        </span>
      </span>
    ),
  },
  { key: "cadence", header: "Cadence", className: "whitespace-nowrap", sort: (row) => row.cadence, text: (row) => fmt.every(row.cadence), cell: (row) => fmt.every(row.cadence) },
  {
    key: "lastSuccess",
    header: "Last success",
    mono: true,
    className: "whitespace-nowrap",
    sort: (row) => row.feed.lastSuccessAt,
    cell: (row) => <RelativeTime value={row.feed.lastSuccessAt} />,
  },
  {
    key: "nextRun",
    header: "Next run",
    mono: true,
    className: "whitespace-nowrap",
    sort: (row) => (row.feed.enabled ? row.feed.nextRunAt : undefined),
    text: () => "",
    cell: (row) => (row.feed.enabled ? <Countdown value={row.feed.nextRunAt} /> : <span className="text-kumo-subtle">paused</span>),
  },
  { key: "health", header: "Status", sort: (row) => row.label, cell: (row) => <HealthBadge feed={row.feed} health={row.health} /> },
  {
    key: "products",
    header: "Products",
    text: (row) => row.products.map((product) => product.title).join(" "),
    className: "min-w-[15rem] whitespace-normal",
    cell: (row) => <NameList items={productLinks(row.products)} noun="products" />,
  },
];

const HEALTH_ORDER: Health[] = ["Healthy", "Collecting", "Retrying", "Stale", "Never succeeded", "Never run", "Paused"];

function FeedsSection({ feeds, productsByFeed, loading }: { feeds: Feed[]; productsByFeed: Map<string, Product[]>; loading: boolean }) {
  const rows = useMemo(() => {
    const now = Date.now();
    return [...feeds]
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((feed): FeedRow => {
        const health = feedHealth(feed, now);
        return {
          feed,
          source: formatOf(feed),
          cadence: feed.cadenceSeconds ?? undefined,
          health,
          label: healthLabel(feed, health),
          products: productsByFeed.get(feed.id) ?? [],
        };
      });
  }, [feeds, productsByFeed]);

  const counts = useMemo(() => groupBy(rows, (row) => row.health), [rows]);

  return (
    <section id="feeds" aria-labelledby="feeds-title" className="scroll-mt-24">
      <SectionHead eyebrow="Feeds" title="What is being collected" id="feeds-title">
        Every collection job, the publisher it reads from, how often it runs and how it is doing. Each feed publishes one or more products.
      </SectionHead>
      <div className="grid gap-4">
        {rows.length ? (
          <p className="flex flex-wrap items-center gap-2 text-sm" aria-label="Feeds by status">
            {HEALTH_ORDER.filter((health) => counts.has(health)).map((health) => (
              <span key={health} className="inline-flex items-center gap-1.5">
                <HealthWord health={health} />
                <span className="font-mono text-xs text-kumo-subtle">{fmt.int(counts.get(health)?.length ?? 0)}</span>
              </span>
            ))}
          </p>
        ) : null}
        {loading && rows.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-kumo-subtle">
            <Loader size="sm" /> Loading feeds…
          </div>
        ) : (
          <DataTable
            label="Feeds"
            rows={rows}
            columns={FEED_COLUMNS}
            rowKey={(row) => row.feed.id}
            filterPlaceholder="Filter by feed, publisher, status…"
            downloadName="feeds"
            maxHeight="min(65vh, 34rem)"
            empty="No feeds yet. Feeds install themselves within minutes of a deploy."
            exportRow={(row) => ({
              id: row.feed.id,
              slug: row.feed.slug,
              title: row.feed.title,
              publisher: row.feed.publisher,
              source: row.source,
              cadenceSeconds: row.cadence ?? null,
              lastSuccessAt: row.feed.lastSuccessAt ?? null,
              nextRunAt: row.feed.nextRunAt ?? null,
              status: row.label,
              products: row.products.map((product) => product.slug).join(" "),
            })}
          />
        )}
      </div>
    </section>
  );
}

/* ---------- Acquisitions ---------- */

interface AcquisitionRow {
  acquisition: Acquisition;
  feedTitle: string;
  took: number | undefined;
  outcome: string;
}

const tookOf = (acquisition: Acquisition) =>
  acquisition.startedAt && acquisition.completedAt ? new Date(acquisition.completedAt).getTime() - new Date(acquisition.startedAt).getTime() : undefined;

function outcomeOf(acquisition: Acquisition) {
  if (acquisition.error) return acquisition.error;
  if (acquisition.status === "unchanged") return "Source unchanged";
  return acquisition.eventTime ? `data through ${fmt.dateTime(acquisition.eventTime)}` : "";
}

const ACQUISITION_COLUMNS: Column<AcquisitionRow>[] = [
  {
    key: "status",
    header: "Status",
    sort: (row) => runStatus(row.acquisition.status).label,
    text: (row) => `${runStatus(row.acquisition.status).label} ${row.acquisition.status}`,
    cell: (row) => <RunBadge status={row.acquisition.status} />,
  },
  {
    key: "feed",
    header: "Feed",
    sort: (row) => row.feedTitle,
    className: "min-w-[14rem] whitespace-normal",
    cell: (row) => <span className="font-medium text-kumo-strong">{row.feedTitle}</span>,
  },
  {
    key: "requested",
    header: "Requested",
    mono: true,
    className: "whitespace-nowrap",
    sort: (row) => row.acquisition.requestedAt,
    text: () => "",
    cell: (row) => <RelativeTime value={row.acquisition.requestedAt} />,
  },
  { key: "took", header: "Took", align: "end", className: "whitespace-nowrap", sort: (row) => row.took, cell: (row) => fmt.took(row.took) },
  {
    key: "observed",
    header: "Observed",
    mono: true,
    className: "whitespace-nowrap",
    sort: (row) => row.acquisition.observedAt,
    text: () => "",
    cell: (row) => fmt.dateTime(row.acquisition.observedAt),
  },
  { key: "completeness", header: "Completeness", sort: (row) => row.acquisition.completeness, cell: (row) => row.acquisition.completeness ?? "—" },
  { key: "rows", header: "Rows", align: "end", sort: (row) => row.acquisition.rows, cell: (row) => fmt.int(row.acquisition.rows) },
  { key: "changes", header: "Changes", align: "end", sort: (row) => row.acquisition.revisions, cell: (row) => fmt.int(row.acquisition.revisions) },
  {
    key: "trigger",
    header: "Trigger",
    sort: (row) => triggerLabel(row.acquisition.trigger),
    cell: (row) => <span className="text-kumo-subtle">{triggerLabel(row.acquisition.trigger)}</span>,
  },
  {
    key: "outcome",
    header: "Outcome",
    sort: (row) => row.outcome,
    className: "min-w-[16rem] whitespace-normal",
    cell: (row) => (
      <span title={row.outcome} className={`line-clamp-2 break-words ${row.acquisition.error ? "text-kumo-danger" : "text-kumo-subtle"}`}>
        {row.outcome}
      </span>
    ),
  },
];

const ALL_FEEDS = "all";

function AcquisitionsSection({ feeds, feedsById }: { feeds: Feed[]; feedsById: Map<string, Feed> }) {
  const [feedId, setFeedId] = useState("");
  const acquisitions = useQuery(acquisitionsKey(feedId), () => fetchAcquisitions(feedId), { staleMs: 20_000, refreshMs: 60_000 });
  const rows = useMemo(
    () =>
      (acquisitions.data ?? []).map((acquisition): AcquisitionRow => ({
        acquisition,
        feedTitle: feedsById.get(acquisition.feedId)?.title ?? acquisition.feedId,
        took: tookOf(acquisition),
        outcome: outcomeOf(acquisition),
      })),
    [acquisitions.data, feedsById],
  );
  const items = useMemo(
    () => [{ label: "All feeds", value: ALL_FEEDS }, ...[...feeds].sort((a, b) => a.title.localeCompare(b.title)).map((feed) => ({ label: feed.title, value: feed.id }))],
    [feeds],
  );

  return (
    <section id="acquisitions" aria-labelledby="acquisitions-title" className="scroll-mt-24">
      <SectionHead eyebrow="Acquisitions" title="Every attempt, including the failed ones" id="acquisitions-title">
        The newest hundred attempts the runners made, of every feed or of one. Sort by how long one took, or filter for the failures.
      </SectionHead>
      <div className="grid gap-3">
        <ErrorNote error={acquisitions.error} />
        <DataTable
          label="Acquisitions"
          rows={rows}
          columns={ACQUISITION_COLUMNS}
          rowKey={(row) => row.acquisition.id}
          initialSort={{ key: "requested", direction: "desc" }}
          filterPlaceholder="Filter by feed, status, error…"
          downloadName={feedId ? `acquisitions-${feedsById.get(feedId)?.slug ?? feedId}` : "acquisitions"}
          empty={acquisitions.loading ? "Loading acquisitions…" : "No acquisitions yet. The runners have not woken up."}
          toolbar={
            <>
              <Select
                aria-label="Filter by feed"
                className="w-64 max-w-full"
                value={feedId || ALL_FEEDS}
                onValueChange={(value: string | null) => setFeedId(!value || value === ALL_FEEDS ? "" : value)}
                items={items}
              />
              <Button variant="ghost" icon={<ArrowClockwiseIcon />} loading={acquisitions.fetching} onClick={() => void acquisitions.refetch()}>
                Refresh
              </Button>
            </>
          }
          exportRow={(row) => ({
            id: row.acquisition.id,
            feedId: row.acquisition.feedId,
            feed: row.feedTitle,
            status: row.acquisition.status,
            trigger: row.acquisition.trigger,
            requestedAt: row.acquisition.requestedAt,
            startedAt: row.acquisition.startedAt ?? null,
            completedAt: row.acquisition.completedAt ?? null,
            observedAt: row.acquisition.observedAt ?? null,
            tookMs: row.took ?? null,
            completeness: row.acquisition.completeness ?? null,
            rows: row.acquisition.rows ?? null,
            changes: row.acquisition.revisions ?? null,
            error: row.acquisition.error ?? null,
          })}
        />
      </div>
    </section>
  );
}

/* ---------- Page ---------- */

function Operations() {
  const feeds = useQuery("feeds", fetchFeeds, { refreshMs: 60_000 });
  const products = useQuery("products", fetchProducts, { staleMs: 60_000 });

  const feedList = useMemo(() => feeds.data ?? [], [feeds.data]);
  const lookup = useMemo(
    (): FeedLookup => ({ feedsById: new Map(feedList.map((feed) => [feed.id, feed])), productsByFeed: groupBy(products.data ?? [], (product) => product.feedId) }),
    [feedList, products.data],
  );

  useHashLanding(Boolean(feeds.data && products.data));

  return (
    <Shell section="operations">
      <div className="grid gap-6">
        <PageHead eyebrow="Operations" title="Every feed, every attempt.">
          Nobody starts or stops anything: feeds install themselves, collect on their own cadence, and retry by themselves when something breaks. This page shows what each feed
          collects and what every run produced. The{" "}
          <a href="/status/" className="font-medium text-kumo-link">
            status page
          </a>{" "}
          shows downtime day by day.
        </PageHead>
        <nav aria-label="On this page" className="flex flex-wrap gap-1.5">
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="rounded-full bg-kumo-base px-3 py-1 text-sm text-kumo-default no-underline ring-1 ring-kumo-line hover:bg-kumo-tint"
            >
              {section.label}
            </a>
          ))}
        </nav>
        <ErrorNote error={feeds.error ?? products.error} />
      </div>

      <Activity lookup={lookup} />
      <FeedsSection feeds={feedList} productsByFeed={lookup.productsByFeed} loading={feeds.loading} />
      <AcquisitionsSection feeds={feedList} feedsById={lookup.feedsById} />
    </Shell>
  );
}

mountPage(<Operations />);
