import { Badge, Breadcrumbs, Button, LayerCard, Link, Loader, Tabs, Tooltip } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, ArrowRightIcon, CheckCircleIcon, CircleNotchIcon, ClockIcon, CompassIcon, MinusCircleIcon, XCircleIcon, type Icon } from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Countdown, ErrorNote, Eyebrow, Kv, PageHead, RelativeTime, RoleBadge, ToneBadge, bodyRows, cardRows } from "../components/common";
import { mountPage } from "../components/mount";
import { ChangesView, CorrectionsView, EventHistoryView } from "../components/product/HistoryViews";
import { SchemaView } from "../components/product/SchemaView";
import { RecordsView } from "../components/product/RecordsView";
import { ChunkBoundary } from "../components/ChunkBoundary";
import { Shell } from "../components/Shell";
import { ApiError, apiGet, productPath } from "../lib/api";
import { PublisherMark } from "../components/PublisherMark";
import { ROLE, freshness, licenceHref, openableUrl, publisherHref, throughOf } from "../lib/catalog";
import { fmt } from "../lib/format";
import { localHref } from "../lib/locale";
import { newIssue } from "../lib/project";
import { invalidate, useQuery } from "../lib/query";
import type { Acquisition, AcquisitionStatus, Feed, Product } from "../lib/types";
import { LOADING, PRODUCT } from "../text/product";

// The heavy views load when their tab is opened: Leaflet for the map, ECharts for the chart, Shiki for the curl example.
const MapView = lazy(() => import("../components/product/MapView"));
const SeriesView = lazy(() => import("../components/product/SeriesView"));
const ApiView = lazy(() => import("../components/product/ApiView"));

const slug = new URLSearchParams(window.location.search).get("slug");

interface RunLook {
  icon: Icon;
  className: string;
}

// Each outcome has its own glyph, so a run reads without its colour.
const RUN_LOOK = {
  succeeded: { icon: CheckCircleIcon, className: "text-kumo-success" },
  unchanged: { icon: MinusCircleIcon, className: "text-kumo-subtle" },
  failed: { icon: XCircleIcon, className: "text-kumo-danger" },
  running: { icon: CircleNotchIcon, className: "text-kumo-info" },
  queued: { icon: ClockIcon, className: "text-kumo-subtle" },
} satisfies { [status in AcquisitionStatus]: RunLook };
const RUN_LABEL = PRODUCT.runLabel;

/** What a run's completeness means to a reader. */
const COMPLETENESS = new Map(Object.entries(PRODUCT.completeness));

interface TabDef {
  value: string;
  label: string;
  count?: number;
  render: () => ReactNode;
}

function Pending() {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-kumo-subtle">
      <Loader size="sm" aria-label={LOADING} /> {PRODUCT.loading}
    </div>
  );
}

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320;
  return (
    <div className="grid max-w-3xl gap-1">
      <p className={`max-w-[38rem] text-base leading-relaxed text-kumo-subtle sm:text-lg ${long && !open ? "line-clamp-3" : ""}`}>{text}</p>
      {long ? (
        <Button size="sm" variant="ghost" className="-ml-2 justify-self-start" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? PRODUCT.showLess : PRODUCT.showMore}
        </Button>
      ) : null}
    </div>
  );
}

function ProductPage() {
  const product = useQuery(slug ? `product:${slug}` : null, () => apiGet<Product>(productPath(slug ?? "")));
  const feedId = product.data?.feedId;
  const feed = useQuery(feedId ? `feed:${feedId}` : null, () => apiGet<{ data: Feed }>(`/api/feeds/${encodeURIComponent(feedId ?? "")}`).then((result) => result.data));
  const acquisitions = useQuery(feedId ? `acquisitions:${feedId}` : null, () =>
    apiGet<{ data: Acquisition[] }>(`/api/acquisitions?feedId=${encodeURIComponent(feedId ?? "")}&limit=20`).then((result) => result.data),
  );
  // The open tab lives in the address, so a link can land on the map or the API.
  const [tab, setTab] = useState<string | undefined>(() => window.location.hash.slice(1) || undefined);
  const openTab = (value: string) => {
    setTab(value);
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${value}`);
  };
  const [refreshKey, setRefreshKey] = useState(0);
  const version = useRef<number | undefined>(undefined);

  // A product collected several times an hour refreshes itself at its own pace.
  const cadence = product.data?.cadenceSeconds;
  useEffect(() => {
    if (!cadence || cadence >= 3600) return undefined;
    const timer = setInterval(
      () => {
        invalidate(`product:${slug}`);
        invalidate(`feed:${feedId}`);
        invalidate(`acquisitions:${feedId}`);
      },
      Math.max(30_000, cadence * 1000),
    );
    return () => clearInterval(timer);
  }, [cadence, feedId]);

  // A new published version reloads the open view in place.
  useEffect(() => {
    const current = product.data?.version;
    if (current === undefined) return;
    if (version.current !== undefined && version.current !== current) setRefreshKey((key) => key + 1);
    version.current = current;
  }, [product.data?.version]);

  const data = product.data;
  const tabs = useMemo<TabDef[]>(() => {
    if (!data) return [];
    const list: TabDef[] = [];
    const mappable =
      data.schema.fields.some((field) => field.type === "geometry") ||
      (data.schema.fields.some((field) => field.type === "latitude") && data.schema.fields.some((field) => field.type === "longitude"));
    // Data with places opens on its map, the same rows one tab away as a table; while the source lists nothing, the table says so first.
    const mapTab: TabDef = { value: "map", label: PRODUCT.tabs.map, render: () => <MapView product={data} refreshKey={refreshKey} /> };
    if (mappable && data.rowCount > 0) list.push(mapTab);
    if (data.role === "time-series")
      list.push({ value: "series", label: PRODUCT.tabs.series, render: () => <SeriesView product={data} refreshKey={refreshKey} withHistory={data.exposeHistory} /> });
    else list.push({ value: "records", label: PRODUCT.tabs.records, count: data.rowCount, render: () => <RecordsView product={data} refreshKey={refreshKey} /> });
    if (mappable && data.rowCount === 0) list.push(mapTab);
    if (data.hasChanges && data.exposeHistory) list.push({ value: "changes", label: PRODUCT.tabs.changes, render: () => <ChangesView product={data} refreshKey={refreshKey} /> });
    if (data.role === "time-series") list.push({ value: "corrections", label: PRODUCT.tabs.corrections, render: () => <CorrectionsView product={data} refreshKey={refreshKey} /> });
    if (data.role === "event-log" && data.exposeHistory) list.push({ value: "history", label: PRODUCT.tabs.history, render: () => <EventHistoryView product={data} /> });
    list.push({ value: "schema", label: PRODUCT.tabs.schema, count: data.schema.fields.length, render: () => <SchemaView product={data} /> });
    list.push({ value: "api", label: PRODUCT.tabs.api, render: () => <ApiView product={data} /> });
    return list;
  }, [data, refreshKey]);

  // A dataset that does not exist and one that failed to load are different problems, with different ways out.
  const missing = !slug || (product.error instanceof ApiError && product.error.status === 404);
  if (missing) {
    document.title = PRODUCT.notFoundTitle;
    return (
      <Shell section="product">
        <PageHead eyebrow={PRODUCT.eyebrow} title={slug ? PRODUCT.noDatasetHere : PRODUCT.noDatasetChosen}>
          {slug ? PRODUCT.nothingNamed(slug) : PRODUCT.chooseOne}
        </PageHead>
        <div>
          <Button variant="primary" icon={<CompassIcon />} onClick={() => window.location.assign(localHref("/catalog/"))}>
            {PRODUCT.openCatalog}
          </Button>
        </div>
      </Shell>
    );
  }
  if (product.error) {
    document.title = PRODUCT.unavailableTitle;
    return (
      <Shell section="product">
        <PageHead eyebrow={PRODUCT.eyebrow} title={PRODUCT.couldNotLoad} />
        <ErrorNote error={product.error} what={PRODUCT.theDataset} onRetry={() => void product.refetch()} />
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell section="product">
        <Pending />
      </Shell>
    );
  }

  document.title = `${data.title} · open-data.pt`;
  const active = tabs.find((each) => each.value === tab) ?? tabs[0];
  const fresh = freshness(data, feed.data);
  const current =
    acquisitions.data?.find((acquisition) => acquisition.id === data.currentAcquisitionId) ?? acquisitions.data?.find((acquisition) => acquisition.status === "succeeded");
  const source = openableUrl(feed.data?.sourceUrl);

  return (
    <Shell section="product">
      <header className="grid gap-4 pt-2">
        <Breadcrumbs size="sm">
          <Breadcrumbs.Link href={localHref("/catalog/")}>{PRODUCT.catalog}</Breadcrumbs.Link>
          <Breadcrumbs.Separator />
          {feed.data ? (
            <>
              <Breadcrumbs.Link href={publisherHref(feed.data.publisher.id)}>{feed.data.publisher.name}</Breadcrumbs.Link>
              <Breadcrumbs.Separator />
            </>
          ) : null}
          <Breadcrumbs.Current>{data.title}</Breadcrumbs.Current>
        </Breadcrumbs>
        <div className="flex flex-wrap items-center gap-2">
          <RoleBadge role={data.role} />
          <ToneBadge tone={fresh.tone}>{fresh.label}</ToneBadge>
          {data.rowCount === 0 ? <Badge variant="outline">{PRODUCT.emptyAtSource}</Badge> : null}
          <Badge variant="outline">{PRODUCT.version(fmt.int(data.version))}</Badge>
          <Button
            size="sm"
            variant="ghost"
            icon={<ArrowClockwiseIcon />}
            loading={product.fetching}
            onClick={() => {
              invalidate(`product:${slug}`);
              invalidate(`feed:${feedId}`);
              invalidate(`acquisitions:${feedId}`);
              setRefreshKey((key) => key + 1);
            }}
          >
            {PRODUCT.checkForUpdates}
          </Button>
        </div>
        <h1 className={`font-display leading-[1.08] text-kumo-strong ${data.title.length > 60 ? "max-w-[46ch] text-3xl" : "max-w-[24ch] text-4xl sm:text-5xl"}`}>{data.title}</h1>
        {data.description ? <Description text={data.description} /> : null}
        {feed.data ? (
          // Who made it, and the way to say it is broken. The source, the terms and the schedule are
          // each stated once, in the cards beside this; a heading that repeated them cost a reader on
          // a phone five lines before the data.
          <p className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-kumo-subtle">
            <span className="inline-flex flex-wrap items-center gap-x-1.5">
              {PRODUCT.publishedBy}
              <a
                href={publisherHref(feed.data.publisher.id)}
                className="inline-flex items-center gap-1.5 font-medium text-kumo-strong underline decoration-kumo-line underline-offset-4 hover:decoration-kumo-strong"
              >
                <PublisherMark publisher={feed.data.publisher} size={20} className="rounded-sm" />
                {feed.data.publisher.name}
              </a>
            </span>
            <Link href={newIssue("broken-source", { title: `Broken: ${data.title}`, page: window.location.href })}>{PRODUCT.reportProblem}</Link>
          </p>
        ) : null}
      </header>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section aria-label={PRODUCT.views} className="grid min-w-0 gap-5">
          <Tabs
            variant="underline"
            value={active?.value}
            onValueChange={openTab}
            tabs={tabs.map((each) => ({
              value: each.value,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {each.label}
                  {each.count !== undefined ? <span className="font-mono text-xs text-kumo-subtle">{fmt.compact(each.count)}</span> : null}
                </span>
              ),
            }))}
          />
          {/* Kumo's Tabs render only the tab list; the panel it controls is named here. */}
          <div role="tabpanel" aria-label={active?.label} tabIndex={0} className="min-w-0 rounded-lg">
            <ChunkBoundary key={active?.value}>
              <Suspense fallback={<Pending />}>{active?.render()}</Suspense>
            </ChunkBoundary>
          </div>
        </section>

        <aside aria-label={PRODUCT.about} className="grid gap-3 lg:sticky lg:top-20">
          <LayerCard>
            <LayerCard.Secondary>{PRODUCT.whereFrom}</LayerCard.Secondary>
            <LayerCard.Primary>
              <Kv
                items={[
                  // No publisher row: the heading above names them, and this card is the source and its terms.
                  source
                    ? {
                        term: PRODUCT.original,
                        value: (
                          <Link href={source.href} target="_blank" rel="noopener noreferrer">
                            {source.hostname} <Link.ExternalIcon />
                          </Link>
                        ),
                      }
                    : null,
                  feed.data ? { term: PRODUCT.shared, value: throughOf(feed.data) } : null,
                  {
                    term: PRODUCT.licence,
                    value: data.licence ? (
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <a href={licenceHref(data.licence.id)} className="text-kumo-link hover:underline">
                          {data.licence.name}
                        </a>
                        {data.licence.url ? (
                          <Link href={data.licence.url} target="_blank" rel="noopener noreferrer">
                            {PRODUCT.licenceText} <Link.ExternalIcon />
                          </Link>
                        ) : null}
                      </span>
                    ) : (
                      PRODUCT.asStated
                    ),
                  },
                  data.attribution ? { term: PRODUCT.attribution, value: data.attribution } : null,
                ]}
              />
            </LayerCard.Primary>
          </LayerCard>
          <LayerCard>
            <LayerCard.Secondary>{PRODUCT.whatThisIs}</LayerCard.Secondary>
            <LayerCard.Primary className="grid gap-3">
              <Kv items={[{ term: PRODUCT.kind, value: ROLE[data.role].label }]} />
              <p className="text-xs leading-relaxed text-kumo-subtle">{ROLE[data.role].description}</p>
            </LayerCard.Primary>
          </LayerCard>
          <LayerCard>
            <LayerCard.Secondary>{PRODUCT.howCollected}</LayerCard.Secondary>
            <LayerCard.Primary>
              <Kv
                items={[
                  {
                    term: PRODUCT.cadence,
                    value: (
                      <span className="grid gap-1">
                        <span>{fmt.every(data.cadenceSeconds)}</span>
                        <Link className="text-xs" href={newIssue("faster-cadence", { title: `Cadence: ${data.title}`, page: window.location.href })}>
                          {PRODUCT.moreOften}
                        </Link>
                      </span>
                    ),
                  },
                  feed.data ? { term: PRODUCT.nextRun, value: feed.data.enabled ? <Countdown value={feed.data.nextRunAt} /> : PRODUCT.paused } : null,
                  feed.data?.lastSuccessAt ? { term: PRODUCT.lastCollected, value: <RelativeTime value={feed.data.lastSuccessAt} /> } : null,
                  { term: PRODUCT.history, value: data.historyMode === "changes" ? PRODUCT.everyChange : PRODUCT.latestOnly },
                  acquisitions.data?.length
                    ? {
                        term: PRODUCT.recentRuns,
                        value: (
                          <span className="grid gap-1">
                            <span className="flex flex-wrap">
                              {acquisitions.data.slice(0, 6).map((run) => {
                                const look = RUN_LOOK[run.status];
                                const RunIcon = look.icon;
                                const label = `${RUN_LABEL[run.status]} · ${fmt.dateTime(run.completedAt ?? run.requestedAt)}${run.error ? ` · ${run.error}` : ""}`;
                                return (
                                  <Tooltip key={run.id} content={label}>
                                    <span role="img" aria-label={label} className={`inline-flex size-6 items-center justify-center rounded-full ${look.className}`}>
                                      <RunIcon size={14} weight="fill" aria-hidden="true" />
                                    </span>
                                  </Tooltip>
                                );
                              })}
                            </span>
                            <span className="text-xs text-kumo-subtle">{PRODUCT.runsHint}</span>
                          </span>
                        ),
                      }
                    : null,
                  { term: PRODUCT.catalogEntry, value: <Link href="/api/catalog.dcat.json">DCAT JSON-LD</Link> },
                ]}
              />
            </LayerCard.Primary>
          </LayerCard>
        </aside>
      </div>

      <section aria-labelledby="lineage-title" className="grid gap-4">
        <div className="grid gap-1.5">
          <Eyebrow>{PRODUCT.lineage}</Eyebrow>
          <h2 id="lineage-title" className="font-display text-2xl text-kumo-strong sm:text-3xl">
            {PRODUCT.lineageTitle}
          </h2>
          <p className="max-w-[42rem] text-sm text-kumo-subtle">{PRODUCT.lineageIntro}</p>
        </div>
        {/* Two columns before four: four only once each card is wide enough for a publisher's full name. */}
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Step
            n={1}
            label={PRODUCT.stepSource}
            title={
              feed.data ? (
                <a href={publisherHref(feed.data.publisher.id)} className="hover:underline">
                  {feed.data.publisher.name}
                </a>
              ) : (
                <Loader size="sm" aria-label={LOADING} />
              )
            }
          >
            {/* Where it was read from is stated once, in the card above; this step is when they published it. */}
            {current?.sourcePublishedAt ? <span>{PRODUCT.sourcePublished(fmt.dateTime(current.sourcePublishedAt))}</span> : null}
          </Step>
          <Step
            n={2}
            label={PRODUCT.stepRead}
            title={
              current ? (
                <RelativeTime value={current.observedAt} />
              ) : acquisitions.loading ? (
                <Loader size="sm" aria-label={LOADING} />
              ) : data.version > 0 ? (
                PRODUCT.earlier
              ) : (
                PRODUCT.notYet
              )
            }
          >
            {current ? (
              <>
                <span>
                  {fmt.dateTime(current.observedAt)}
                  {current.completeness ? `, ${COMPLETENESS.get(current.completeness) ?? current.completeness}` : ""}
                </span>
                {current.revisions !== undefined ? <span>{PRODUCT.rowsRead(fmt.int(current.rows ?? 0), fmt.int(current.revisions))}</span> : null}
              </>
            ) : acquisitions.loading ? null : (
              <span>{data.version > 0 ? PRODUCT.earlierRun : PRODUCT.noCollectionYet}</span>
            )}
          </Step>
          <Step n={3} label={PRODUCT.stepChecked} title={current?.normalizer ? PRODUCT.checkedBy(current.normalizer.id) : data.version > 0 ? PRODUCT.earlier : PRODUCT.notYet}>
            {current?.normalizer ? (
              <>
                <span className="flex flex-wrap items-center gap-2">
                  {PRODUCT.codeVersion(current.normalizer.version)} <Badge variant={current.status === "failed" ? "error" : "success"}>{RUN_LABEL[current.status]}</Badge>
                </span>
                {current.quality ? (
                  <span>
                    {PRODUCT.kept(fmt.int(current.quality.acceptedRecords))}
                    {current.quality.rejectedRecords ? PRODUCT.leftOut(fmt.int(current.quality.rejectedRecords)) : ""}
                  </span>
                ) : null}
              </>
            ) : (
              <span>{data.version > 0 ? PRODUCT.checkedEarlier : PRODUCT.nothingChecked}</span>
            )}
          </Step>
          <Step n={4} label={PRODUCT.stepPublished} title={<RelativeTime value={data.updatedAt} />} last>
            <span>{PRODUCT.versionRows(fmt.int(data.version), fmt.int(data.rowCount), data.role === "time-series")}</span>
            {data.watermark ? <span>{PRODUCT.dataThrough(fmt.dateTime(data.watermark))}</span> : null}
            <span>{PRODUCT.staleAfter(fmt.span(data.staleAfterSeconds))}</span>
          </Step>
        </ol>
      </section>
    </Shell>
  );
}

/**
 * One step of the lineage. Steps share three rows (label, title, details), so a publisher name
 * that wraps moves every step's details down together.
 */
function Step({ n, label, title, last = false, children }: { n: number; label: string; title: ReactNode; last?: boolean; children: ReactNode }) {
  return (
    <li className={`relative ${cardRows(3)}`}>
      <LayerCard className={cardRows(3)}>
        <LayerCard.Secondary className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.08em]">
          <span className="grid size-5 place-items-center rounded-full bg-kumo-brand text-xs font-semibold text-kumo-inverse">{n}</span>
          {label}
        </LayerCard.Secondary>
        <LayerCard.Primary className={`gap-1 text-xs text-kumo-subtle ${bodyRows(2)}`}>
          <span className="font-display text-lg text-kumo-strong">{title}</span>
          <span className="grid content-start gap-1">{children}</span>
        </LayerCard.Primary>
      </LayerCard>
      {last ? null : (
        <ArrowRightIcon aria-hidden="true" size={16} className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-kumo-canvas text-kumo-subtle lg:block" />
      )}
    </li>
  );
}

mountPage(<ProductPage />);
