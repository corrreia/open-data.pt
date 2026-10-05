import { Badge, Button, Input, LayerCard, Loader } from "@cloudflare/kumo";
import {
  ArrowRightIcon,
  BankIcon,
  BroadcastIcon,
  BuildingsIcon,
  ChartLineUpIcon,
  CloudSunIcon,
  DatabaseIcon,
  HeartbeatIcon,
  LeafIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  ScalesIcon,
  TrainIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useMemo, type ReactNode } from "react";
import { ListingRows } from "../components/ListingRows";
import { Eyebrow, RelativeTime, SectionHead, StatTile } from "../components/common";
import { mountPage } from "../components/mount";
import { PublisherMark } from "../components/PublisherMark";
import { Shell } from "../components/Shell";
import { apiGet, productHref } from "../lib/api";
import { buildListings, buildPublishers, fetchFeeds, fetchProducts, publisherHref, topicLabel, type Listing, emptyLast } from "../lib/catalog";
import { fmt } from "../lib/format";
import { useQuery } from "../lib/query";
import { localHref } from "../lib/locale";
import type { OutagesResponse } from "../lib/types";
import { HOME } from "../text/home";
import { LISTINGS } from "../text/listings";

const TOPIC_ICON = new Map<string, ReactNode>([
  ["cities", <BuildingsIcon size={22} />],
  ["mobility", <TrainIcon size={22} />],
  ["energy", <LightningIcon size={22} />],
  ["economy", <ChartLineUpIcon size={22} />],
  ["health", <HeartbeatIcon size={22} />],
  ["environment", <LeafIcon size={22} />],
  ["society", <UsersThreeIcon size={22} />],
  ["culture", <BankIcon size={22} />],
  ["weather", <CloudSunIcon size={22} />],
  ["government", <ScalesIcon size={22} />],
  ["telecom", <BroadcastIcon size={22} />],
]);

const newest = (a: Listing, b: Listing) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

function Home() {
  const products = useQuery("products", fetchProducts);
  const feeds = useQuery("feeds", fetchFeeds);
  const outages = useQuery("outages:1", () => apiGet<OutagesResponse>("/api/outages?days=1"), { staleMs: 60_000, refreshMs: 60_000 });

  const listings = useMemo(() => (products.data && feeds.data ? buildListings(products.data, feeds.data) : []), [products.data, feeds.data]);
  const publishers = useMemo(() => buildPublishers(listings), [listings]);
  const live = useMemo(() => listings.filter((listing) => listing.updates === "live").sort((a, b) => emptyLast(a, b) || newest(a, b)), [listings]);
  const recent = useMemo(
    () =>
      listings
        .filter((listing) => listing.updates !== "live")
        .sort((a, b) => emptyLast(a, b) || newest(a, b))
        .slice(0, 8),
    [listings],
  );
  const failing = outages.data?.data.filter((outage) => !outage.endedAt && outage.feedId).length;

  const topics = useMemo(() => {
    const counts = new Map<string, { listings: number; publishers: Map<string, number> }>();
    for (const listing of listings) {
      for (const topic of listing.topics) {
        const entry = counts.get(topic) ?? { listings: 0, publishers: new Map<string, number>() };
        entry.listings += 1;
        entry.publishers.set(listing.publisher.name, (entry.publishers.get(listing.publisher.name) ?? 0) + 1);
        counts.set(topic, entry);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1].listings - a[1].listings || a[0].localeCompare(b[0]));
  }, [listings]);

  return (
    <Shell section="home">
      <section aria-labelledby="hero-title" className="grid items-center gap-10 pt-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:pt-14">
        <div className="grid gap-6">
          <Eyebrow>{HOME.eyebrow}</Eyebrow>
          <h1 id="hero-title" className="font-display text-5xl leading-[1.02] text-kumo-strong sm:text-6xl">
            {HOME.heading.before}
            <em className="text-kumo-brand">{HOME.heading.emphasis}</em>
            {HOME.heading.after}
          </h1>
          <p className="max-w-[36rem] text-lg leading-relaxed text-kumo-subtle">{HOME.intro}</p>
          <form action={localHref("/catalog/")} method="get" role="search" className="flex max-w-xl flex-wrap gap-2">
            <Input name="q" size="lg" className="min-w-0 flex-1 basis-64" placeholder={HOME.searchPlaceholder} aria-label={HOME.searchLabel} autoComplete="off" />
            <Button type="submit" variant="primary" size="lg" icon={<MagnifyingGlassIcon />}>
              {HOME.search}
            </Button>
          </form>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-kumo-subtle">
            <a href={localHref("/catalog/")} className="font-medium text-kumo-link">
              {HOME.browse}
            </a>
            <a href={localHref("/start/")} className="font-medium text-kumo-link">
              {HOME.useApi}
            </a>
            <a href={localHref("/start/#mcp")} className="font-medium text-kumo-link">
              {HOME.connectAssistant}
            </a>
            <span className="hidden sm:inline">
              {HOME.pressBefore} <kbd className="rounded border border-kumo-line bg-kumo-base px-1.5 font-mono text-xs">⌘K</kbd> {HOME.pressAfter}
            </span>
          </p>
        </div>

        {/* The first thing a visitor sees moving: what arrived in the last minutes. */}
        <LayerCard aria-label={HOME.liveLabel}>
          <LayerCard.Secondary className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-kumo-success opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex size-2 rounded-full bg-kumo-success" />
              </span>
              {HOME.rightNow}
            </span>
            <a href={localHref("/status/")} className="text-xs text-kumo-subtle hover:text-kumo-strong">
              {failing === undefined ? HOME.checking : failing === 0 ? HOME.everythingCollecting : HOME.sourcesNotCollecting(failing)}
            </a>
          </LayerCard.Secondary>
          <LayerCard.Primary className="p-0">
            {live.length === 0 ? (
              <div className="flex items-center gap-2 p-4 text-sm text-kumo-subtle">
                <Loader size="sm" /> {HOME.loadingLive}
              </div>
            ) : (
              <ul className="divide-y divide-kumo-hairline">
                {live.slice(0, 6).map((listing) => (
                  <li key={listing.id}>
                    <a href={productHref(listing.id)} className="flex items-center gap-3 px-4 py-2.5 text-sm no-underline hover:bg-kumo-tint">
                      <span className="min-w-0 flex-1">
                        <span className="block text-pretty font-medium text-kumo-strong">{listing.title}</span>
                        <span className="block text-xs text-kumo-subtle">
                          {listing.publisher.name} · {fmt.every(listing.cadence)}
                        </span>
                      </span>
                      <RelativeTime value={listing.updatedAt} className="shrink-0 font-mono text-xs text-kumo-subtle" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </LayerCard.Primary>
        </LayerCard>
      </section>

      <section aria-label={HOME.atAGlance} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={LISTINGS.tablesAndSeries} value={listings.length ? fmt.int(listings.length) : "—"} note={HOME.fromPublishers(publishers.length)} />
        <StatTile label={HOME.publishers} value={publishers.length ? fmt.int(publishers.length) : "—"} note={HOME.institutionsAndOperators} />
        <StatTile label={HOME.nearRealTime} value={live.length ? fmt.int(live.length) : "—"} note={HOME.severalTimesAnHour} />
        <StatTile
          label={HOME.collection}
          tone={failing === undefined ? undefined : failing === 0 ? "ok" : "warn"}
          value={
            <a href={localHref("/status/")} className="no-underline">
              {failing === undefined ? "—" : failing === 0 ? HOME.allCollecting : HOME.notCollecting(failing)}
            </a>
          }
          note={failing === 0 ? HOME.everythingCollected : HOME.seeStatus}
        />
      </section>

      <section aria-labelledby="topics-title">
        <SectionHead eyebrow={HOME.topicsEyebrow} title={HOME.topicsTitle} id="topics-title" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] gap-3">
          {topics.map(([topic, entry]) => (
            <a key={topic} href={localHref(`/catalog/?topic=${encodeURIComponent(topic)}`)} className="group rounded-lg no-underline">
              <LayerCard className="flex h-full flex-col transition-[box-shadow] group-hover:ring-kumo-focus/40">
                <LayerCard.Primary className="grid flex-1 content-start gap-2">
                  <span className="flex items-center justify-between text-kumo-brand">
                    {TOPIC_ICON.get(topic) ?? <DatabaseIcon size={22} />}
                    <ArrowRightIcon size={16} className="text-kumo-subtle transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="font-display text-xl text-kumo-strong">{topicLabel(topic)}</span>
                  <span className="font-mono text-xs text-kumo-subtle">{LISTINGS.count(entry.listings)}</span>
                  <TopicPublishers publishers={entry.publishers} />
                </LayerCard.Primary>
              </LayerCard>
            </a>
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-title">
        {/* What changes several times an hour is the panel at the top of this page; these are the rest,
            newest first, so nobody reads the same rows twice on one page. */}
        <SectionHead eyebrow={HOME.recentEyebrow} title={HOME.recentTitle} id="recent-title">
          {HOME.recentIntro}
        </SectionHead>
        <ListingRows listings={recent} />
      </section>

      <section aria-labelledby="publishers-title">
        <SectionHead eyebrow={HOME.publishers} title={HOME.publishersTitle} id="publishers-title">
          <a href={localHref("/publisher/")} className="font-medium text-kumo-link">
            {HOME.allPublishers}
          </a>
        </SectionHead>
        <ul className="flex flex-wrap gap-2">
          {publishers.map((publisher) => (
            <li key={publisher.id}>
              <a
                href={publisherHref(publisher.id)}
                className="inline-flex items-center gap-2 rounded-full bg-kumo-base py-1.5 pl-2 pr-3 text-sm text-kumo-default no-underline ring-1 ring-kumo-line hover:bg-kumo-tint"
              >
                <PublisherMark publisher={publisher} size={18} className="rounded-md" />
                {publisher.name}
                <Badge variant="secondary">{publisher.listings.length}</Badge>
              </a>
            </li>
          ))}
        </ul>
        {publishers.length === 0 && !products.error ? (
          <Badge variant="neutral" appearance="dot">
            {HOME.loading}
          </Badge>
        ) : null}
      </section>
    </Shell>
  );
}

/** The three publishers with the most datasets in a topic, with every publisher of the topic on hover. */
function TopicPublishers({ publishers }: { publishers: Map<string, number> }) {
  const ranked = [...publishers.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return (
    <span className="line-clamp-2 text-xs text-kumo-subtle" title={ranked.join(" · ")}>
      {ranked.slice(0, 3).join(" · ")}
      {ranked.length > 3 ? LISTINGS.more(ranked.length - 3) : ""}
    </span>
  );
}

mountPage(<Home />);
