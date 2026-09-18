import { Badge, Breadcrumbs, Button, Empty, LayerCard, Link, Loader } from "@cloudflare/kumo";
import { ArrowRightIcon, ScalesIcon } from "@phosphor-icons/react";
import { useMemo } from "react";
import { DatasetCard } from "../components/DatasetCard";
import { ErrorNote, Kv, PageHead, StatTile } from "../components/common";
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
        {fmt.int(licences.length)} sets of terms over {fmt.int(datasets)} datasets, each as its publisher states it. Where a publisher states none, its own terms apply. Cite the
        publisher, not open-data.pt.
      </PageHead>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(19rem,100%),1fr))] gap-3">
        {licences.map((licence) => (
          <a key={licence.id} href={licenceHref(licence.id)} className="group no-underline">
            <LayerCard className="flex h-full flex-col transition-shadow group-hover:shadow-[0_0_0_2px_var(--color-kumo-focus)]">
              <LayerCard.Secondary className="flex items-center justify-between text-xs">
                <span>
                  {plural(licence.datasets.length, "dataset")} · {plural(licence.publishers.size, "publisher")}
                </span>
                <ArrowRightIcon size={14} className="text-kumo-subtle transition-transform group-hover:translate-x-0.5" />
              </LayerCard.Secondary>
              <LayerCard.Primary className="grid flex-1 content-start gap-2.5">
                <h2 className="font-display text-xl leading-snug text-kumo-strong">{licence.name}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {topicsOf(licence).map((topic) => (
                    <Badge key={topic} variant="outline">
                      {topic}
                    </Badge>
                  ))}
                </div>
                <p className="truncate text-xs text-kumo-subtle">
                  {[...licence.publishers.values()]
                    .map((publisher) => publisher.name)
                    .slice(0, 3)
                    .join(" · ")}
                  {licence.publishers.size > 3 ? ` · +${licence.publishers.size - 3}` : ""}
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
                  : { term: "Text", value: "Not published as a single document; the publisher's own terms apply." },
                {
                  term: "Publishers",
                  value: (
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {[...licence.publishers.values()].map((publisher) => (
                        <a key={publisher.id} href={publisherHref(publisher.id)} className="text-kumo-link hover:underline">
                          {publisher.name}
                        </a>
                      ))}
                    </span>
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
        <div className="grid grid-cols-2 gap-3">
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
      <ErrorNote error={products.error ?? feeds.error} />
      {!licences ? (
        <div className="flex items-center gap-2 py-16 text-sm text-kumo-subtle">
          <Loader size="sm" /> Loading licences…
        </div>
      ) : wanted && !licence ? (
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
