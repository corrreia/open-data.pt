import { Breadcrumbs, Button, Empty, LayerCard, Link } from "@cloudflare/kumo";
import { ArrowRightIcon, ScalesIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { DatasetCard } from "../components/DatasetCard";
import { PublisherMark } from "../components/PublisherMark";
import { ErrorNote, PageHead, Placeholder, StatTile, bodyRows, cardRows } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { buildDatasets, buildLicences, fetchFeeds, fetchProducts, licenceHref, productCount, publisherHref, topicsOf, type Licence, emptyLast } from "../lib/catalog";
import { fmt, plural } from "../lib/format";
import { useQuery } from "../lib/query";

const wanted = new URLSearchParams(window.location.search).get("id");

/** How many of this licence's datasets one publisher accounts for. */
const datasetsOf = (licence: Licence, publisherId: string) => licence.datasets.filter((dataset) => dataset.publisher.id === publisherId).length;

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
  return `${shown.join(" · ")}${hidden > 0 ? ` · +${hidden} more` : ""}`;
}

function LicenceIndex({ licences }: { licences: Licence[] }) {
  const datasets = licences.reduce((sum, licence) => sum + licence.datasets.length, 0);
  return (
    <>
      <PageHead eyebrow="Licences" title="The terms the data is served under">
        {fmt.int(licences.length)} sets of terms over {fmt.int(datasets)} datasets, each as its publisher states it. Where a publisher states no licence, the dataset is listed
        under “No licence stated”: check the publisher’s site before you reuse it. Cite the publisher, not open-data.pt.
      </PageHead>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(19rem,100%),1fr))] gap-3">
        {licences.map((licence) => (
          <a key={licence.id} href={licenceHref(licence.id)} className={`group rounded-lg no-underline ${cardRows(3)}`}>
            <LayerCard className={`transition-[box-shadow] group-hover:ring-kumo-focus/40 ${cardRows(3)}`}>
              <LayerCard.Secondary className="flex items-center justify-between text-xs">
                <span>
                  {plural(licence.datasets.length, "dataset")} · {plural(licence.publishers.size, "publisher")}
                </span>
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
          <Breadcrumbs.Link href="/licence/" icon={<ScalesIcon size={15} />}>
            Licences
          </Breadcrumbs.Link>
          <Breadcrumbs.Separator />
          <Breadcrumbs.Current>{licence.name}</Breadcrumbs.Current>
        </Breadcrumbs>
        <PageHead eyebrow="Licence" title={licence.name}>
          {licence.description ??
            `${plural(licence.datasets.length, "dataset")} from ${plural(licence.publishers.size, "publisher")}, served under these terms as their publishers state them.`}
        </PageHead>
        {/* The one place the terms are linked. Where a licence names no text, the publishers below
            are the way to them: each states their own, on their own site, from their page here. */}
        {licence.url ? (
          <p className="text-sm">
            <Link href={licence.url} target="_blank" rel="noopener noreferrer">
              Read the full text at {new URL(licence.url).hostname} <Link.ExternalIcon />
            </Link>
          </p>
        ) : null}
      </div>

      {/* Three tiles across, not a tall list of publishers beside two small ones: the page's facts
          are short, and the publishers are a section of their own below, where the width is. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(13rem,100%),1fr))] gap-3">
        <StatTile label="Datasets" value={fmt.int(licence.datasets.length)} note={`${fmt.int(productCount(licence.datasets))} tables and series`} />
        <StatTile label="Publishers" value={fmt.int(licence.publishers.size)} note="serving data under these terms" />
        <StatTile label="Topics" value={fmt.int(licence.topics.size)} note={topicsOf(licence).join(" · ")} />
      </div>

      <section aria-labelledby="publishers-title" className="grid gap-3">
        <h2 id="publishers-title" className="font-display text-2xl text-kumo-strong">
          Publishers
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
                    <span className="block text-xs text-kumo-subtle">{plural(datasetsOf(licence, publisher.id), "dataset")}</span>
                  </span>
                  <ArrowRightIcon size={14} className="ml-auto shrink-0 text-kumo-subtle transition-transform group-hover:translate-x-0.5" />
                </LayerCard.Primary>
              </LayerCard>
            </a>
          ))}
        </div>
      </section>

      <section aria-labelledby="datasets-title" className="grid gap-3">
        <h2 id="datasets-title" className="font-display text-2xl text-kumo-strong">
          Datasets
        </h2>
        {[...licence.datasets]
          .sort((a, b) => emptyLast(a, b) || a.publisher.name.localeCompare(b.publisher.name) || a.title.localeCompare(b.title))
          .map((dataset) => (
            <DatasetCard key={dataset.feed.id} dataset={dataset} />
          ))}
      </section>
    </>
  );
}

function Licences() {
  const products = useQuery("products", fetchProducts);
  const feeds = useQuery("feeds", fetchFeeds);
  const licences = useMemo(() => (products.data && feeds.data ? buildLicences(buildDatasets(products.data, feeds.data)) : undefined), [products.data, feeds.data]);
  const licence = wanted ? licences?.find((candidate) => candidate.id === wanted) : undefined;

  if (licence) document.title = `${licence.name} · open-data.pt`;

  return (
    <Shell section="licences">
      <ErrorNote
        error={products.error ?? feeds.error}
        what="the licences"
        onRetry={() => {
          void products.refetch();
          void feeds.refetch();
        }}
      />
      {!licences && !(products.error ?? feeds.error) ? (
        <Placeholder rows={3} label="Loading the licences" />
      ) : !licences ? null : wanted && !licence ? (
        <Empty
          icon={<ScalesIcon size={40} className="text-kumo-inactive" />}
          title="Licence not found"
          description="No dataset on open-data.pt is served under terms by that name."
          contents={
            <Button variant="primary" onClick={() => window.location.assign("/licence/")}>
              All licences
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
