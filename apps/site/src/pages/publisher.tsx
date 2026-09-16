import { Badge, Breadcrumbs, Button, Empty, LayerCard, Link, Loader } from "@cloudflare/kumo";
import { ArrowRightIcon, BuildingsIcon, HeartbeatIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { DatasetCard } from "../components/DatasetCard";
import { ErrorNote, Kv, PageHead, StatTile } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { buildDatasets, buildPublishers, fetchFeeds, fetchProducts, productCount, publisherHref, topicsOf, type Publisher, emptyLast } from "../lib/catalog";
import { fmt, plural } from "../lib/format";
import { useQuery } from "../lib/query";

const wanted = new URLSearchParams(window.location.search).get("name");

function PublisherIndex({ publishers }: { publishers: Publisher[] }) {
  const datasets = publishers.reduce((sum, publisher) => sum + publisher.datasets.length, 0);
  return (
    <>
      <PageHead eyebrow="Publishers" title="Who publishes the data">
        {fmt.int(publishers.length)} institutions and operators, {fmt.int(datasets)} datasets. Each dataset is collected from where its publisher shares it, keeps their licence,
        and links back to their source.
      </PageHead>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(19rem,100%),1fr))] gap-3">
        {publishers.map((publisher) => (
          <a key={publisher.slug} href={publisherHref(publisher.name)} className="group no-underline">
            <LayerCard className="flex h-full flex-col transition-shadow group-hover:shadow-[0_0_0_2px_var(--color-kumo-focus)]">
              <LayerCard.Secondary className="flex items-center justify-between text-xs">
                <span>
                  {plural(publisher.datasets.length, "dataset")} · {fmt.int(productCount(publisher.datasets))} tables and series
                </span>
                <ArrowRightIcon size={14} className="text-kumo-subtle transition-transform group-hover:translate-x-0.5" />
              </LayerCard.Secondary>
              <LayerCard.Primary className="grid flex-1 content-start gap-2.5">
                <h2 className="font-display text-xl leading-snug text-kumo-strong">{publisher.name}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {topicsOf(publisher).map((topic) => (
                    <Badge key={topic} variant="outline">
                      {topic}
                    </Badge>
                  ))}
                </div>
                {publisher.hosts.size ? <p className="break-all font-mono text-[0.7rem] text-kumo-subtle">{[...publisher.hosts.keys()].join(" · ")}</p> : null}
              </LayerCard.Primary>
            </LayerCard>
          </a>
        ))}
      </div>
    </>
  );
}

function PublisherPage({ publisher }: { publisher: Publisher }) {
  const live = publisher.datasets.filter((dataset) => dataset.updates === "live").length;
  const late = publisher.datasets.filter((dataset) => dataset.tone !== "ok").length;
  return (
    <>
      <div className="grid gap-4">
        <Breadcrumbs>
          <Breadcrumbs.Link href="/publisher/" icon={<BuildingsIcon size={15} />}>
            Publishers
          </Breadcrumbs.Link>
          <Breadcrumbs.Separator />
          <Breadcrumbs.Current>{publisher.name}</Breadcrumbs.Current>
        </Breadcrumbs>
        <PageHead eyebrow="Publisher" title={publisher.name}>
          {plural(publisher.datasets.length, "dataset")} published by {publisher.name}, collected from where they share them.
        </PageHead>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <LayerCard>
          <LayerCard.Secondary>About this publisher's data</LayerCard.Secondary>
          <LayerCard.Primary>
            <Kv
              items={[
                {
                  term: "Topics",
                  value: (
                    <span className="flex flex-wrap gap-1.5">
                      {topicsOf(publisher).map((topic) => (
                        <Badge key={topic} variant="outline">
                          {topic}
                        </Badge>
                      ))}
                    </span>
                  ),
                },
                publisher.hosts.size
                  ? {
                      term: "Published at",
                      value: (
                        <span className="flex flex-wrap gap-x-4 gap-y-1">
                          {[...publisher.hosts.entries()].map(([host, href]) => (
                            <Link key={host} href={href} target="_blank" rel="noopener noreferrer">
                              {host} <Link.ExternalIcon />
                            </Link>
                          ))}
                        </span>
                      ),
                    }
                  : null,
                { term: "Licences", value: [...publisher.licences].join(" · ") || "As stated by the publisher" },
                { term: "Updates", value: live ? `${plural(live, "dataset")} ${live === 1 ? "changes" : "change"} several times an hour` : "Hourly or less often" },
              ]}
            />
          </LayerCard.Primary>
        </LayerCard>
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="Datasets" value={fmt.int(publisher.datasets.length)} note={`${fmt.int(productCount(publisher.datasets))} tables and series`} />
          <StatTile
            label="Freshness"
            value={late === 0 ? "all current" : `${late} late`}
            tone={late === 0 ? "ok" : "warn"}
            note={late === 0 ? "every dataset within its update window" : "past their expected update"}
          />
          <div className="col-span-2">
            <Button variant="secondary" icon={<HeartbeatIcon />} className="w-full" onClick={() => window.location.assign(`/status/#pub-${publisher.slug}`)}>
              Collection status, day by day
            </Button>
          </div>
        </div>
      </div>

      <section aria-labelledby="datasets-title" className="grid gap-3">
        <h2 id="datasets-title" className="font-display text-2xl text-kumo-strong">
          Datasets
        </h2>
        {[...publisher.datasets]
          .sort((a, b) => emptyLast(a, b) || a.title.localeCompare(b.title))
          .map((dataset) => (
            <DatasetCard key={dataset.feed.id} dataset={dataset} showPublisher={false} />
          ))}
      </section>
    </>
  );
}

function Publishers() {
  const products = useQuery("products", fetchProducts);
  const feeds = useQuery("feeds", fetchFeeds);
  const publishers = useMemo(() => (products.data && feeds.data ? buildPublishers(buildDatasets(products.data, feeds.data)) : undefined), [products.data, feeds.data]);
  const publisher = wanted ? publishers?.find((candidate) => candidate.slug === wanted) : undefined;

  if (publisher) document.title = `${publisher.name} · open-data.pt`;

  return (
    <Shell section="publishers">
      <ErrorNote error={products.error ?? feeds.error} />
      {!publishers ? (
        <div className="flex items-center gap-2 py-16 text-sm text-kumo-subtle">
          <Loader size="sm" /> Loading publishers…
        </div>
      ) : wanted && !publisher ? (
        <Empty
          icon={<BuildingsIcon size={40} className="text-kumo-inactive" />}
          title="Publisher not found"
          description="No dataset on open-data.pt comes from a publisher by that name."
          contents={
            <Button variant="primary" onClick={() => window.location.assign("/publisher/")}>
              All publishers
            </Button>
          }
        />
      ) : publisher ? (
        <PublisherPage publisher={publisher} />
      ) : (
        <PublisherIndex publishers={publishers} />
      )}
    </Shell>
  );
}

mountPage(<Publishers />);
