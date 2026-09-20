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
import { DatasetCard } from "../components/DatasetCard";
import { Eyebrow, RelativeTime, SectionHead, StatTile } from "../components/common";
import { mountPage } from "../components/mount";
import { PublisherMark } from "../components/PublisherMark";
import { Shell } from "../components/Shell";
import { apiGet, productHref } from "../lib/api";
import { buildDatasets, buildPublishers, fetchFeeds, fetchProducts, productCount, publisherHref, topicLabel, type Dataset, emptyLast } from "../lib/catalog";
import { fmt, plural } from "../lib/format";
import { useQuery } from "../lib/query";
import type { OutagesResponse } from "../lib/types";

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

const newest = (a: Dataset, b: Dataset) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

function Home() {
  const products = useQuery("products", fetchProducts);
  const feeds = useQuery("feeds", fetchFeeds);
  const outages = useQuery("outages:1", () => apiGet<OutagesResponse>("/api/outages?days=1"), { staleMs: 60_000, refreshMs: 60_000 });

  const datasets = useMemo(() => (products.data && feeds.data ? buildDatasets(products.data, feeds.data) : []), [products.data, feeds.data]);
  const publishers = useMemo(() => buildPublishers(datasets), [datasets]);
  const live = useMemo(() => datasets.filter((dataset) => dataset.updates === "live").sort((a, b) => emptyLast(a, b) || newest(a, b)), [datasets]);
  const recent = useMemo(
    () =>
      datasets
        .filter((dataset) => dataset.updates !== "live")
        .sort((a, b) => emptyLast(a, b) || newest(a, b))
        .slice(0, 6),
    [datasets],
  );
  const failing = outages.data?.data.filter((outage) => !outage.endedAt && outage.feedId).length;

  const topics = useMemo(() => {
    const counts = new Map<string, { datasets: number; publishers: Map<string, number> }>();
    for (const dataset of datasets) {
      for (const topic of dataset.topics) {
        const entry = counts.get(topic) ?? { datasets: 0, publishers: new Map<string, number>() };
        entry.datasets += 1;
        entry.publishers.set(dataset.publisher.name, (entry.publishers.get(dataset.publisher.name) ?? 0) + 1);
        counts.set(topic, entry);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1].datasets - a[1].datasets || a[0].localeCompare(b[0]));
  }, [datasets]);

  return (
    <Shell section="home">
      <section aria-labelledby="hero-title" className="grid items-center gap-10 pt-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:pt-14">
        <div className="grid gap-6">
          <Eyebrow>Portuguese public data</Eyebrow>
          <h1 id="hero-title" className="font-display text-5xl leading-[1.02] text-kumo-strong sm:text-6xl">
            Public data from Portugal, <em className="text-kumo-brand">in one place</em>.
          </h1>
          <p className="max-w-[36rem] text-lg leading-relaxed text-kumo-subtle">
            Datasets published by Portuguese institutions and operators, collected from where they publish them and served in one consistent format. Free to use, with no key and no
            account. Every dataset names its publisher and links back to the source.
          </p>
          <form action="/catalog/" method="get" role="search" className="flex max-w-xl flex-wrap gap-2">
            <Input
              name="q"
              size="lg"
              className="min-w-0 flex-1 basis-64"
              placeholder="Search datasets: metro, fuel prices, population…"
              aria-label="Search datasets"
              autoComplete="off"
            />
            <Button type="submit" variant="primary" size="lg" icon={<MagnifyingGlassIcon />}>
              Search
            </Button>
          </form>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-kumo-subtle">
            <a href="/catalog/" className="font-medium text-kumo-link">
              Browse the whole catalog
            </a>
            <a href="/start/" className="font-medium text-kumo-link">
              Use the API
            </a>
            <a href="/start/#mcp" className="font-medium text-kumo-link">
              Connect an AI assistant
            </a>
            <span className="hidden sm:inline">
              or press <kbd className="rounded border border-kumo-line bg-kumo-base px-1.5 font-mono text-xs">⌘K</kbd> anywhere
            </span>
          </p>
        </div>

        {/* The first thing a visitor sees moving: what arrived in the last minutes. */}
        <LayerCard aria-label="Collected in the last minutes">
          <LayerCard.Secondary className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-kumo-success opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex size-2 rounded-full bg-kumo-success" />
              </span>
              Right now
            </span>
            <a href="/status/" className="text-xs text-kumo-subtle hover:text-kumo-strong">
              {failing === undefined ? "Checking collection…" : failing === 0 ? "Every dataset collecting" : `${plural(failing, "dataset")} not collecting`}
            </a>
          </LayerCard.Secondary>
          <LayerCard.Primary className="p-0">
            {live.length === 0 ? (
              <div className="flex items-center gap-2 p-4 text-sm text-kumo-subtle">
                <Loader size="sm" /> Loading live data…
              </div>
            ) : (
              <ul className="divide-y divide-kumo-hairline">
                {live.slice(0, 6).map((dataset) => (
                  <li key={dataset.feed.id}>
                    <a href={productHref(dataset.products[0]?.product.slug ?? "")} className="flex items-center gap-3 px-4 py-2.5 text-sm no-underline hover:bg-kumo-tint">
                      <span className="min-w-0 flex-1">
                        <span className="block text-pretty font-medium text-kumo-strong">{dataset.title}</span>
                        <span className="block text-xs text-kumo-subtle">
                          {dataset.publisher.name} · {fmt.every(dataset.cadence)}
                        </span>
                      </span>
                      <RelativeTime value={dataset.updatedAt} className="shrink-0 font-mono text-xs text-kumo-subtle" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </LayerCard.Primary>
        </LayerCard>
      </section>

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Datasets" value={datasets.length ? fmt.int(datasets.length) : "—"} note={`${fmt.int(productCount(datasets))} tables and series`} />
        <StatTile label="Publishers" value={publishers.length ? fmt.int(publishers.length) : "—"} note="institutions and operators" />
        <StatTile label="Near real time" value={live.length ? fmt.int(live.length) : "—"} note="collected several times an hour" />
        <StatTile
          label="Collection"
          tone={failing === undefined ? undefined : failing === 0 ? "ok" : "warn"}
          value={
            <a href="/status/" className="no-underline">
              {failing === undefined ? "—" : failing === 0 ? "All collecting" : `${fmt.int(failing)} not collecting`}
            </a>
          }
          note={failing === 0 ? "every dataset is being collected" : "see the status page"}
        />
      </section>

      <section aria-labelledby="topics-title">
        <SectionHead eyebrow="Topics" title="Browse by topic" id="topics-title" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] gap-3">
          {topics.map(([topic, entry]) => (
            <a key={topic} href={`/catalog/?topic=${encodeURIComponent(topic)}`} className="group rounded-lg no-underline">
              <LayerCard className="flex h-full flex-col transition-[box-shadow] group-hover:ring-kumo-focus/40">
                <LayerCard.Primary className="grid flex-1 content-start gap-2">
                  <span className="flex items-center justify-between text-kumo-brand">
                    {TOPIC_ICON.get(topic) ?? <DatabaseIcon size={22} />}
                    <ArrowRightIcon size={16} className="text-kumo-subtle transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="font-display text-xl text-kumo-strong">{topicLabel(topic)}</span>
                  <span className="font-mono text-xs text-kumo-subtle">{plural(entry.datasets, "dataset")}</span>
                  <TopicPublishers publishers={entry.publishers} />
                </LayerCard.Primary>
              </LayerCard>
            </a>
          ))}
        </div>
      </section>

      <section aria-labelledby="live-title">
        <SectionHead eyebrow="Live" title="Changing as you read" id="live-title">
          Vehicle positions, waiting times and service alerts, collected every few minutes.
        </SectionHead>
        <div className="grid gap-3">
          {live.slice(0, 6).map((dataset) => (
            <DatasetCard key={dataset.feed.id} dataset={dataset} />
          ))}
        </div>
      </section>

      <section aria-labelledby="recent-title">
        <SectionHead eyebrow="Recently updated" title="New from the publishers" id="recent-title">
          Datasets whose publisher released new or changed data most recently.
        </SectionHead>
        <div className="grid gap-3">
          {recent.map((dataset) => (
            <DatasetCard key={dataset.feed.id} dataset={dataset} />
          ))}
        </div>
      </section>

      <section aria-labelledby="publishers-title">
        <SectionHead eyebrow="Publishers" title="Where the data comes from" id="publishers-title">
          <a href="/publisher/" className="font-medium text-kumo-link">
            All publishers
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
                <Badge variant="secondary">{publisher.datasets.length}</Badge>
              </a>
            </li>
          ))}
        </ul>
        {publishers.length === 0 && !products.error ? (
          <Badge variant="neutral" appearance="dot">
            Loading
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
      {ranked.length > 3 ? ` · +${ranked.length - 3} more` : ""}
    </span>
  );
}

mountPage(<Home />);
