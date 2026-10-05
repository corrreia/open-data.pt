import { Badge, Breadcrumbs, Button, Empty, LayerCard, Link } from "@cloudflare/kumo";
import { ArrowRightIcon, BuildingsIcon, HeartbeatIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { ListingRows } from "../components/ListingRows";
import { ErrorNote, Kv, PageHead, Placeholder, StatTile, TagRow, bodyRows, cardRows } from "../components/common";
import { PublisherMark, PublisherWatermark } from "../components/PublisherMark";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { buildListings, buildPublishers, fetchFeeds, fetchProducts, licenceHref, publisherHref, topicsOf, type Publisher, emptyLast } from "../lib/catalog";
import { fmt } from "../lib/format";
import { localHref } from "../lib/locale";
import { useQuery } from "../lib/query";
import { LISTINGS } from "../text/listings";
import { PUBLISHER } from "../text/publisher";

const wanted = new URLSearchParams(window.location.search).get("id");

function PublisherIndex({ publishers }: { publishers: Publisher[] }) {
  const listings = publishers.reduce((sum, publisher) => sum + publisher.listings.length, 0);
  return (
    <>
      <PageHead eyebrow={PUBLISHER.indexEyebrow} title={PUBLISHER.indexTitle}>
        {PUBLISHER.indexIntro(publishers.length, listings)}
      </PageHead>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(19rem,100%),1fr))] gap-3">
        {publishers.map((publisher) => (
          <a key={publisher.id} href={publisherHref(publisher.id)} className={`group rounded-lg no-underline ${cardRows(4)}`}>
            <LayerCard className={`transition-[box-shadow] group-hover:ring-kumo-focus/40 ${cardRows(4)}`}>
              <LayerCard.Secondary className="flex items-center justify-between text-xs">
                <span>{LISTINGS.count(publisher.listings.length)}</span>
                <ArrowRightIcon size={14} className="text-kumo-subtle transition-transform group-hover:translate-x-0.5" />
              </LayerCard.Secondary>
              {/* The mark is the card's background rather than a tile beside the name: publishers
                  draw their marks in every proportion, and a row of them at one size was a row of
                  different sizes. */}
              <LayerCard.Primary className={`relative isolate gap-2.5 overflow-hidden ${bodyRows(3)}`}>
                <PublisherWatermark publisher={publisher} height={116} />
                <h2 className="font-display text-xl leading-snug text-kumo-strong">{publisher.name}</h2>
                {/* Cards in a row share their tracks, so one card whose topics wrapped to a second
                    line left a line of empty space in every other card. Three topics fit on one line
                    at any card width, and the rest are counted. */}
                <TagRow items={topicsOf(publisher)} />

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
  const live = publisher.listings.filter((listing) => listing.updates === "live").length;
  const late = publisher.listings.filter((listing) => listing.tone !== "ok").length;
  const own = publisher.url ? new URL(publisher.url).hostname : undefined;
  const elsewhere = [...publisher.hosts.entries()].filter(([host]) => host !== own);
  return (
    <>
      <div className="relative isolate grid gap-4 overflow-hidden">
        <PublisherWatermark publisher={publisher} height={224} />
        <Breadcrumbs>
          <Breadcrumbs.Link href={localHref("/publisher/")} icon={<BuildingsIcon size={15} />}>
            {PUBLISHER.breadcrumb}
          </Breadcrumbs.Link>
          <Breadcrumbs.Separator />
          <Breadcrumbs.Current>{publisher.name}</Breadcrumbs.Current>
        </Breadcrumbs>
        <PageHead
          eyebrow={PUBLISHER.eyebrow}
          title={
            <span className="flex flex-wrap items-center gap-3">
              <PublisherMark publisher={publisher} size={52} />
              <span className="min-w-0">{publisher.name}</span>
            </span>
          }
        >
          {PUBLISHER.collectedFrom(publisher.name)}
        </PageHead>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <LayerCard>
          <LayerCard.Secondary>{PUBLISHER.about}</LayerCard.Secondary>
          <LayerCard.Primary>
            <Kv
              items={[
                {
                  term: PUBLISHER.topics,
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
                      term: PUBLISHER.site,
                      value: (
                        <Link href={publisher.url} target="_blank" rel="noopener noreferrer">
                          {new URL(publisher.url).hostname} <Link.ExternalIcon />
                        </Link>
                      ),
                    }
                  : null,
                // Only the portals that are not the publisher's own site: a publisher who serves their
                // own data had the same link twice, once as "Site" and once here.
                elsewhere.length > 0
                  ? {
                      term: PUBLISHER.publishedAt,
                      value: (
                        <span className="flex flex-wrap gap-x-4 gap-y-1">
                          {elsewhere.map(([host, href]) => (
                            <Link key={host} href={href} target="_blank" rel="noopener noreferrer">
                              {host} <Link.ExternalIcon />
                            </Link>
                          ))}
                        </span>
                      ),
                    }
                  : null,
                {
                  term: PUBLISHER.licences,
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
                {
                  term: PUBLISHER.updates,
                  value: live ? PUBLISHER.liveUpdates(live) : PUBLISHER.hourlyOrLess,
                },
              ]}
            />
          </LayerCard.Primary>
        </LayerCard>
        <div className="grid grid-cols-2 content-start gap-3">
          <StatTile label={LISTINGS.tablesAndSeries} value={fmt.int(publisher.listings.length)} note={topicsOf(publisher).join(" · ")} />
          <StatTile
            label={PUBLISHER.freshness}
            value={late === 0 ? PUBLISHER.allCurrent : PUBLISHER.late(late)}
            tone={late === 0 ? "ok" : "warn"}
            note={late === 0 ? PUBLISHER.withinWindow : PUBLISHER.pastExpected}
          />
          <div className="col-span-2">
            <Button variant="secondary" icon={<HeartbeatIcon />} className="w-full" onClick={() => window.location.assign(localHref(`/status/#pub-${publisher.id}`))}>
              {PUBLISHER.seeStatus}
            </Button>
          </div>
        </div>
      </div>

      <section aria-labelledby="listings-title" className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="listings-title" className="font-display text-2xl text-kumo-strong">
            {LISTINGS.tablesAndSeries}
          </h2>
          {/* A long list is searched and filtered where every list is: the catalog, narrowed to them. */}
          <Link href={localHref(`/catalog/?publisher=${encodeURIComponent(publisher.id)}`)}>{LISTINGS.searchInCatalog}</Link>
        </div>
        <ListingRows listings={[...publisher.listings].sort((a, b) => emptyLast(a, b) || a.title.localeCompare(b.title))} underPublisher />
      </section>
    </>
  );
}

function Publishers() {
  const products = useQuery("products", fetchProducts);
  const feeds = useQuery("feeds", fetchFeeds);
  const publishers = useMemo(() => (products.data && feeds.data ? buildPublishers(buildListings(products.data, feeds.data)) : undefined), [products.data, feeds.data]);
  const publisher = wanted ? publishers?.find((candidate) => candidate.id === wanted) : undefined;

  if (publisher) document.title = `${publisher.name} · open-data.pt`;

  return (
    <Shell section="publishers">
      <ErrorNote
        error={products.error ?? feeds.error}
        what={PUBLISHER.errorWhat}
        onRetry={() => {
          void products.refetch();
          void feeds.refetch();
        }}
      />
      {!publishers && !(products.error ?? feeds.error) ? (
        <Placeholder rows={4} label={PUBLISHER.loading} />
      ) : !publishers ? null : wanted && !publisher ? (
        <Empty
          icon={<BuildingsIcon size={40} className="text-kumo-inactive" />}
          title={PUBLISHER.notFound}
          description={PUBLISHER.notFoundDescription}
          contents={
            <Button variant="primary" onClick={() => window.location.assign(localHref("/publisher/"))}>
              {PUBLISHER.all}
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
