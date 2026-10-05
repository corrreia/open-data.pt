import { Breadcrumbs, Button, Empty, LayerCard, Link } from "@cloudflare/kumo";
import { ArrowRightIcon, ScalesIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { ListingRows } from "../components/ListingRows";
import { PublisherMark } from "../components/PublisherMark";
import { ErrorNote, PageHead, Placeholder, StatTile, bodyRows, cardRows } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { buildLicences, buildListings, fetchFeeds, fetchProducts, licenceHref, publisherHref, topicsOf, type Licence, emptyLast } from "../lib/catalog";
import { fmt } from "../lib/format";
import { localHref } from "../lib/locale";
import { useQuery } from "../lib/query";
import { LICENCE } from "../text/licence";
import { LISTINGS } from "../text/listings";

const wanted = new URLSearchParams(window.location.search).get("id");

/** How many of this licence's tables and series one publisher accounts for. */
const listingsOf = (licence: Licence, publisherId: string) => licence.listings.filter((listing) => listing.publisher.id === publisherId).length;

/**
 * As many publisher names as the card's two lines hold, then a count of the rest. Counting a fixed
 * three names cut the count itself off when the names were long ones: “Comissão de Acesso aos
 * Documentos Administrativos · +13…” said less than “+14 more”. The full list is the row's tooltip.
 */
function publisherSummary(names: string[], budget = 64) {
  const shown: string[] = [];
  let used = 0;
  for (const name of names) {
    if (shown.length > 0 && used + name.length > budget) break;
    shown.push(name);
    used += name.length + 3;
  }
  const hidden = names.length - shown.length;
  return `${shown.join(" · ")}${hidden > 0 ? LISTINGS.more(hidden) : ""}`;
}

function LicenceIndex({ licences }: { licences: Licence[] }) {
  const listings = licences.reduce((sum, licence) => sum + licence.listings.length, 0);
  return (
    <>
      <PageHead eyebrow={LICENCE.indexEyebrow} title={LICENCE.indexTitle}>
        {LICENCE.indexIntro(licences.length, listings)}
      </PageHead>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(19rem,100%),1fr))] gap-3">
        {licences.map((licence) => (
          <a key={licence.id} href={licenceHref(licence.id)} className={`group rounded-lg no-underline ${cardRows(3)}`}>
            <LayerCard className={`transition-[box-shadow] group-hover:ring-kumo-focus/40 ${cardRows(3)}`}>
              <LayerCard.Secondary className="flex items-center justify-between text-xs">
                <span>{LICENCE.cardCount(licence.listings.length, licence.publishers.size)}</span>
                <ArrowRightIcon size={14} className="text-kumo-subtle transition-transform group-hover:translate-x-0.5" />
              </LayerCard.Secondary>
              {/* No topics here: a licence is a set of terms, and the topics under it are whatever
                  its publishers happen to publish. The licence's own page lists them. */}
              <LayerCard.Primary className={`gap-2.5 ${bodyRows(2)}`}>
                <h2 className="font-display text-xl leading-snug text-kumo-strong">{licence.name}</h2>
                <p className="line-clamp-2 text-xs text-kumo-subtle" title={[...licence.publishers.values()].map((publisher) => publisher.name).join(" · ")}>
                  {publisherSummary([...licence.publishers.values()].map((publisher) => publisher.name))}
                </p>
              </LayerCard.Primary>
            </LayerCard>
          </a>
        ))}
      </div>
    </>
  );
}

function LicencePage({ licence }: { licence: Licence }) {
  return (
    <>
      <div className="grid gap-4">
        <Breadcrumbs>
          <Breadcrumbs.Link href={localHref("/licence/")} icon={<ScalesIcon size={15} />}>
            {LICENCE.breadcrumb}
          </Breadcrumbs.Link>
          <Breadcrumbs.Separator />
          <Breadcrumbs.Current>{licence.name}</Breadcrumbs.Current>
        </Breadcrumbs>
        <PageHead eyebrow={LICENCE.eyebrow} title={licence.name}>
          {licence.description ?? LICENCE.fallbackDescription(licence.listings.length, licence.publishers.size)}
        </PageHead>
        {/* The one place the terms are linked. Where a licence names no text, the publishers below
            are the way to them: each states their own, on their own site, from their page here. */}
        {licence.url ? (
          <p className="text-sm">
            <Link href={licence.url} target="_blank" rel="noopener noreferrer">
              {LICENCE.readFullText(new URL(licence.url).hostname)} <Link.ExternalIcon />
            </Link>
          </p>
        ) : null}
      </div>

      {/* Three tiles across, not a tall list of publishers beside two small ones: the page's facts
          are short, and the publishers are a section of their own below, where the width is. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(13rem,100%),1fr))] gap-3">
        <StatTile label={LISTINGS.tablesAndSeries} value={fmt.int(licence.listings.length)} note={topicsOf(licence).join(" · ")} />
        <StatTile label={LICENCE.publishers} value={fmt.int(licence.publishers.size)} note={LICENCE.servingUnder} />
        <StatTile label={LICENCE.topics} value={fmt.int(licence.topics.size)} note={topicsOf(licence).join(" · ")} />
      </div>

      <section aria-labelledby="publishers-title" className="grid gap-3">
        <h2 id="publishers-title" className="font-display text-2xl text-kumo-strong">
          {LICENCE.publishers}
        </h2>
        {/* One link each, to their page here. Their own site is on that page; two links to the same
            institution from one row only made the reader choose between them. */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-3">
          {[...licence.publishers.values()].map((publisher) => (
            <a key={publisher.id} href={publisherHref(publisher.id)} className="group h-full rounded-lg no-underline">
              <LayerCard className="h-full transition-[box-shadow] group-hover:ring-kumo-focus/40">
                {/* Kumo stacks a card's primary layer, and a card told to fill its row has to fill it
                    all the way: one row of its own — mark, name, count, arrow — that grows with the card. */}
                <LayerCard.Primary className="h-full flex-row items-center gap-3">
                  <PublisherMark publisher={publisher} size={34} />
                  <span className="min-w-0">
                    <span className="line-clamp-3 text-sm font-medium text-kumo-strong" title={publisher.name}>
                      {publisher.name}
                    </span>
                    <span className="block text-xs text-kumo-subtle">{LISTINGS.count(listingsOf(licence, publisher.id))}</span>
                  </span>
                  <ArrowRightIcon size={14} className="ml-auto shrink-0 text-kumo-subtle transition-transform group-hover:translate-x-0.5" />
                </LayerCard.Primary>
              </LayerCard>
            </a>
          ))}
        </div>
      </section>

      <section aria-labelledby="listings-title" className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="listings-title" className="font-display text-2xl text-kumo-strong">
            {LISTINGS.tablesAndSeries}
          </h2>
          <Link href={localHref(`/catalog/?licence=${encodeURIComponent(licence.id)}`)}>{LISTINGS.searchInCatalog}</Link>
        </div>
        <ListingRows listings={[...licence.listings].sort((a, b) => emptyLast(a, b) || a.publisher.name.localeCompare(b.publisher.name) || a.title.localeCompare(b.title))} />
      </section>
    </>
  );
}

function Licences() {
  const products = useQuery("products", fetchProducts);
  const feeds = useQuery("feeds", fetchFeeds);
  const licences = useMemo(() => (products.data && feeds.data ? buildLicences(buildListings(products.data, feeds.data)) : undefined), [products.data, feeds.data]);
  const licence = wanted ? licences?.find((candidate) => candidate.id === wanted) : undefined;

  if (licence) document.title = `${licence.name} · open-data.pt`;

  return (
    <Shell section="licences">
      <ErrorNote
        error={products.error ?? feeds.error}
        what={LICENCE.errorWhat}
        onRetry={() => {
          void products.refetch();
          void feeds.refetch();
        }}
      />
      {!licences && !(products.error ?? feeds.error) ? (
        <Placeholder rows={3} label={LICENCE.loading} />
      ) : !licences ? null : wanted && !licence ? (
        <Empty
          icon={<ScalesIcon size={40} className="text-kumo-inactive" />}
          title={LICENCE.notFound}
          description={LICENCE.notFoundDescription}
          contents={
            <Button variant="primary" onClick={() => window.location.assign(localHref("/licence/"))}>
              {LICENCE.all}
            </Button>
          }
        />
      ) : licence ? (
        <LicencePage licence={licence} />
      ) : (
        <LicenceIndex licences={licences} />
      )}
    </Shell>
  );
}

mountPage(<Licences />);
