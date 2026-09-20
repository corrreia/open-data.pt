import { Badge, Breadcrumbs, Button, Empty, LayerCard, Link } from "@cloudflare/kumo";
import { ArrowRightIcon, BuildingsIcon, HeartbeatIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { DatasetCard } from "../components/DatasetCard";
import { ErrorNote, Kv, PageHead, Placeholder, StatTile, bodyRows, cardRows } from "../components/common";
import { PublisherMark } from "../components/PublisherMark";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { buildDatasets, buildPublishers, fetchFeeds, fetchProducts, licenceHref, productCount, publisherHref, topicsOf, type Publisher, emptyLast } from "../lib/catalog";
import { fmt, plural } from "../lib/format";
import { useQuery } from "../lib/query";

const wanted = new URLSearchParams(window.location.search).get("id");

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
          <a key={publisher.id} href={publisherHref(publisher.id)} className={`group rounded-lg no-underline ${cardRows(4)}`}>
            <LayerCard className={`transition-[box-shadow] group-hover:ring-kumo-focus/40 ${cardRows(4)}`}>
              <LayerCard.Secondary className="flex items-center justify-between text-xs">
                <span>
                  {plural(publisher.datasets.length, "dataset")} · {fmt.int(productCount(publisher.datasets))} tables and series
                </span>
                <ArrowRightIcon size={14} className="text-kumo-subtle transition-transform group-hover:translate-x-0.5" />
              </LayerCard.Secondary>
              <LayerCard.Primary className={`gap-2.5 ${bodyRows(3)}`}>
                <h2 className="flex items-center gap-2.5 font-display text-xl leading-snug text-kumo-strong">
                  <PublisherMark publisher={publisher} size={36} />
                  <span className="min-w-0">{publisher.name}</span>
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {topicsOf(publisher).map((topic) => (
                    <Badge key={topic} variant="outline">
                      {topic}
                    </Badge>
                  ))}
                </div>
                <p className="wrap-anywhere font-mono text-xs text-kumo-subtle">{[...publisher.hosts.keys()].join(" · ")}</p>
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
        <PageHead
          eyebrow="Publisher"
          title={
            <span className="flex flex-wrap items-center gap-3">
              <PublisherMark publisher={publisher} size={52} />
              <span className="min-w-0">{publisher.name}</span>
            </span>
          }
        >
          {plural(publisher.datasets.length, "dataset")} published by {publisher.name}, collected from where they share them.
        </PageHead>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <LayerCard>
          <LayerCard.Secondary>About this publisher’s data</LayerCard.Secondary>
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
                publisher.url
                  ? {
                      term: "Site",
                      value: (
                        <Link href={publisher.url} target="_blank" rel="noopener noreferrer">
                          {new URL(publisher.url).hostname} <Link.ExternalIcon />
                        </Link>
                      ),
                    }
                  : null,
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
                {
                  term: "Licences",
                  value: (
                    <ul className="grid gap-1.5">
                      {[...publisher.licences.values()].map((licence) => (
                        <li key={licence.id}>
                          <a href={licenceHref(licence.id)} className="inline-flex min-h-6 items-center text-kumo-link hover:underline">
                            {licence.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ),
                },
                { term: "Updates", value: live ? `${plural(live, "dataset")} ${live === 1 ? "changes" : "change"} several times an hour` : "Hourly or less often" },
              ]}
            />
          </LayerCard.Primary>
        </LayerCard>
        <div className="grid grid-cols-2 content-start gap-3">
          <StatTile label="Datasets" value={fmt.int(publisher.datasets.length)} note={`${fmt.int(productCount(publisher.datasets))} tables and series`} />
          <StatTile
            label="Freshness"
            value={late === 0 ? "all current" : `${late} late`}
            tone={late === 0 ? "ok" : "warn"}
            note={late === 0 ? "every dataset within its update window" : "past their expected update"}
          />
          <div className="col-span-2">
            <Button variant="secondary" icon={<HeartbeatIcon />} className="w-full" onClick={() => window.location.assign(`/status/#pub-${publisher.id}`)}>
              See collection status by hour
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
  const publisher = wanted ? publishers?.find((candidate) => candidate.id === wanted) : undefined;

  if (publisher) document.title = `${publisher.name} · open-data.pt`;

  return (
    <Shell section="publishers">
      <ErrorNote
        error={products.error ?? feeds.error}
        what="the publishers"
        onRetry={() => {
          void products.refetch();
          void feeds.refetch();
        }}
      />
      {!publishers && !(products.error ?? feeds.error) ? (
        <Placeholder rows={4} label="Loading the publishers" />
      ) : !publishers ? null : wanted && !publisher ? (
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
