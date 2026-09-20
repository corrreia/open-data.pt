import { Badge, Breadcrumbs, Button, Empty, LayerCard, Link } from "@cloudflare/kumo";
import { ArrowRightIcon, ScalesIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { DatasetCard } from "../components/DatasetCard";
import { ErrorNote, Kv, PageHead, Placeholder, StatTile, bodyRows, cardRows } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { buildDatasets, buildLicences, fetchFeeds, fetchProducts, licenceHref, productCount, publisherHref, topicsOf, type Licence, emptyLast } from "../lib/catalog";
import { fmt, plural } from "../lib/format";
import { useQuery } from "../lib/query";

const wanted = new URLSearchParams(window.location.search).get("id");

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
        {/* The terms themselves are the point of this page, so the way to read them sits next to the
            title. Where a licence names no text, the card below links each publisher's own site,
            which is where their terms are stated. */}
        {licence.url ? (
          <p className="text-sm">
            <Link href={licence.url} target="_blank" rel="noopener noreferrer">
              Read the full text at {new URL(licence.url).hostname} <Link.ExternalIcon />
            </Link>
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <LayerCard>
          <LayerCard.Secondary>About these terms</LayerCard.Secondary>
          <LayerCard.Primary>
            <Kv
              items={[
                {
                  term: "Text",
                  value: licence.url ? (
                    <Link href={licence.url} target="_blank" rel="noopener noreferrer">
                      {new URL(licence.url).hostname} <Link.ExternalIcon />
                    </Link>
                  ) : (
                    "Stated by each publisher, on their own site."
                  ),
                },
                {
                  term: "Publishers",
                  value: (
                    // Their page here, and their own site beside it: that site is where a publisher
                    // that names no licence states what may be done with the data.
                    <ul className="grid gap-1.5">
                      {[...licence.publishers.values()].map((publisher) => (
                        <li key={publisher.id} className="flex flex-wrap items-center gap-x-2">
                          <a href={publisherHref(publisher.id)} className="inline-flex min-h-6 items-center text-kumo-link hover:underline">
                            {publisher.name}
                          </a>
                          {publisher.url ? (
                            <Link href={publisher.url} target="_blank" rel="noopener noreferrer" className="text-xs">
                              {new URL(publisher.url).hostname} <Link.ExternalIcon />
                            </Link>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ),
                },
                {
                  term: "Topics",
                  value: (
                    <span className="flex flex-wrap gap-1.5">
                      {topicsOf(licence).map((topic) => (
                        <Badge key={topic} variant="outline">
                          {topic}
                        </Badge>
                      ))}
                    </span>
                  ),
                },
              ]}
            />
          </LayerCard.Primary>
        </LayerCard>
        <div className="grid grid-cols-2 content-start gap-3">
          <StatTile label="Datasets" value={fmt.int(licence.datasets.length)} note={`${fmt.int(productCount(licence.datasets))} tables and series`} />
          <StatTile label="Publishers" value={fmt.int(licence.publishers.size)} note="serving data under these terms" />
        </div>
      </div>

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
