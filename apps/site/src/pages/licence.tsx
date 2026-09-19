import { Badge, Breadcrumbs, Button, Empty, LayerCard, Link, Loader } from "@cloudflare/kumo";
import { ArrowRightIcon, ScalesIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { DatasetCard } from "../components/DatasetCard";
import { ErrorNote, Kv, PageHead, StatTile, bodyRows, cardRows } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { buildDatasets, buildLicences, fetchFeeds, fetchProducts, licenceHref, productCount, publisherHref, topicsOf, type Licence, emptyLast } from "../lib/catalog";
import { fmt, plural } from "../lib/format";
import { useQuery } from "../lib/query";

const wanted = new URLSearchParams(window.location.search).get("id");

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
          <a key={licence.id} href={licenceHref(licence.id)} className={`group rounded-lg no-underline ${cardRows(4)}`}>
            <LayerCard className={`transition-[box-shadow] group-hover:ring-kumo-focus/40 ${cardRows(4)}`}>
              <LayerCard.Secondary className="flex items-center justify-between text-xs">
                <span>
                  {plural(licence.datasets.length, "dataset")} · {plural(licence.publishers.size, "publisher")}
                </span>
                <ArrowRightIcon size={14} className="text-kumo-subtle transition-transform group-hover:translate-x-0.5" />
              </LayerCard.Secondary>
              <LayerCard.Primary className={`gap-2.5 ${bodyRows(3)}`}>
                <h2 className="font-display text-xl leading-snug text-kumo-strong">{licence.name}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {topicsOf(licence).map((topic) => (
                    <Badge key={topic} variant="outline">
                      {topic}
                    </Badge>
                  ))}
                </div>
                <p className="line-clamp-2 text-xs text-kumo-subtle" title={[...licence.publishers.values()].map((publisher) => publisher.name).join(" · ")}>
                  {[...licence.publishers.values()]
                    .map((publisher) => publisher.name)
                    .slice(0, 3)
                    .join(" · ")}
                  {licence.publishers.size > 3 ? ` · +${licence.publishers.size - 3} more` : ""}
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
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <LayerCard>
          <LayerCard.Secondary>About these terms</LayerCard.Secondary>
          <LayerCard.Primary>
            <Kv
              items={[
                licence.url
                  ? {
                      term: "Text",
                      value: (
                        <Link href={licence.url} target="_blank" rel="noopener noreferrer">
                          {new URL(licence.url).hostname} <Link.ExternalIcon />
                        </Link>
                      ),
                    }
                  : { term: "Text", value: "The publisher names no licence. Check its site for reuse terms." },
                {
                  term: "Publishers",
                  value: (
                    <ul className="grid gap-1.5">
                      {[...licence.publishers.values()].map((publisher) => (
                        <li key={publisher.id}>
                          <a href={publisherHref(publisher.id)} className="inline-flex min-h-6 items-center text-kumo-link hover:underline">
                            {publisher.name}
                          </a>
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
        <div className="flex items-center gap-2 py-16 text-sm text-kumo-subtle">
          <Loader size="sm" /> Loading licences…
        </div>
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
