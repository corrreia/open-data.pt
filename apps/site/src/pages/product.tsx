import { Badge, Breadcrumbs, Button, Empty, LayerCard, Link, Loader, Tabs, Tooltip } from "@cloudflare/kumo";
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  ClockIcon,
  CompassIcon,
  DatabaseIcon,
  MinusCircleIcon,
  XCircleIcon,
  type Icon,
} from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Countdown, Kv, RelativeTime, RoleBadge, ToneBadge } from "../components/common";
import { mountPage } from "../components/mount";
import { ChangesView, CorrectionsView, EventHistoryView } from "../components/product/HistoryViews";
import { SchemaView } from "../components/product/SchemaView";
import { RecordsView } from "../components/product/RecordsView";
import { ChunkBoundary } from "../components/ChunkBoundary";
import { Shell } from "../components/Shell";
import { apiGet, productPath } from "../lib/api";
import { ROLE, freshness, openableUrl, publisherHref, throughOf } from "../lib/catalog";
import { fmt } from "../lib/format";
import { newIssue } from "../lib/project";
import { invalidate, useQuery } from "../lib/query";
import type { Acquisition, AcquisitionStatus, Feed, Product } from "../lib/types";

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
const RUN_LABEL = { succeeded: "Published", unchanged: "Unchanged", failed: "Failed", running: "Running", queued: "Queued" } satisfies { [status in AcquisitionStatus]: string };

interface TabDef {
  value: string;
  label: string;
  count?: number;
  render: () => ReactNode;
}

function Pending() {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-kumo-subtle">
      <Loader size="sm" /> Loading…
    </div>
  );
}

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320;
  return (
    <div className="grid max-w-3xl gap-1">
      <p className={`text-base leading-relaxed text-kumo-subtle sm:text-lg ${long && !open ? "line-clamp-3" : ""}`}>{text}</p>
      {long ? (
        <Button size="sm" variant="ghost" className="justify-self-start" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Show less" : "Show more"}
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
    const mapTab: TabDef = { value: "map", label: "Map", render: () => <MapView product={data} refreshKey={refreshKey} /> };
    if (mappable && data.rowCount > 0) list.push(mapTab);
    if (data.role === "time-series")
      list.push({ value: "series", label: "Series", render: () => <SeriesView product={data} refreshKey={refreshKey} withHistory={data.exposeHistory} /> });
    else list.push({ value: "records", label: "Records", count: data.rowCount, render: () => <RecordsView product={data} refreshKey={refreshKey} /> });
    if (mappable && data.rowCount === 0) list.push(mapTab);
    if (data.hasChanges && data.exposeHistory) list.push({ value: "changes", label: "Changes", render: () => <ChangesView product={data} refreshKey={refreshKey} /> });
    if (data.role === "time-series") list.push({ value: "corrections", label: "Corrections", render: () => <CorrectionsView product={data} refreshKey={refreshKey} /> });
    if (data.role === "event-log" && data.exposeHistory) list.push({ value: "history", label: "Event history", render: () => <EventHistoryView product={data} /> });
    list.push({ value: "schema", label: "Schema", count: data.schema.fields.length, render: () => <SchemaView product={data} /> });
    list.push({ value: "api", label: "API", render: () => <ApiView product={data} /> });
    return list;
  }, [data, refreshKey]);

  if (!slug || product.error) {
    return (
      <Shell section="product">
        <Empty
          icon={<DatabaseIcon size={40} className="text-kumo-inactive" />}
          title={slug ? "Product not found" : "No product selected"}
          description={product.error?.message ?? "Choose a product from the catalog."}
          contents={
            <Button variant="primary" icon={<CompassIcon />} onClick={() => window.location.assign("/catalog/")}>
              Open the catalog
            </Button>
          }
        />
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
          <Breadcrumbs.Link href="/catalog/">Catalog</Breadcrumbs.Link>
          <Breadcrumbs.Separator />
          {feed.data ? (
            <>
              <Breadcrumbs.Link href={publisherHref(feed.data.publisher)}>{feed.data.publisher}</Breadcrumbs.Link>
              <Breadcrumbs.Separator />
            </>
          ) : null}
          <Breadcrumbs.Current>{data.title}</Breadcrumbs.Current>
        </Breadcrumbs>
        <div className="flex flex-wrap items-center gap-2">
          <RoleBadge role={data.role} />
          <ToneBadge tone={fresh.tone}>{fresh.label}</ToneBadge>
          {data.rowCount === 0 ? <Badge variant="outline">Empty at the source</Badge> : null}
          <Badge variant="outline">version {fmt.int(data.version)}</Badge>
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
            Refresh
          </Button>
        </div>
        <h1 className={`font-display leading-[1.08] text-kumo-strong ${data.title.length > 60 ? "max-w-[46ch] text-3xl" : "max-w-[24ch] text-4xl sm:text-5xl"}`}>{data.title}</h1>
        {data.description ? <Description text={data.description} /> : null}
        {feed.data ? (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-kumo-subtle">
            <span>
              Published by{" "}
              <a href={publisherHref(feed.data.publisher)} className="font-medium text-kumo-strong underline decoration-kumo-line underline-offset-4 hover:decoration-kumo-strong">
                {feed.data.publisher}
              </a>
            </span>
            {source ? (
              <>
                <span aria-hidden="true">·</span>
                <Link href={source.href} target="_blank" rel="noopener noreferrer">
                  Original source <Link.ExternalIcon />
                </Link>
              </>
            ) : null}
            {data.licence ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{data.licence}</span>
              </>
            ) : null}
            <span aria-hidden="true">·</span>
            <span>
              Updated <RelativeTime value={data.updatedAt} />
            </span>
            <span aria-hidden="true">·</span>
            <span>{fmt.every(data.cadenceSeconds)}</span>
            <span aria-hidden="true">·</span>
            <Link href={newIssue("broken-source", { title: `Broken: ${data.title}`, page: window.location.href })}>Report a problem</Link>
          </p>
        ) : null}
      </header>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <section aria-label="Product views" className="grid min-w-0 gap-5">
          <Tabs
            variant="underline"
            value={active?.value}
            onValueChange={openTab}
            tabs={tabs.map((each) => ({
              value: each.value,
              label: (
                <span className="inline-flex items-center gap-1.5">
                  {each.label}
                  {each.count !== undefined ? <span className="font-mono text-[0.7rem] text-kumo-subtle">{fmt.compact(each.count)}</span> : null}
                </span>
              ),
            }))}
          />
          <ChunkBoundary key={active?.value}>
            <Suspense fallback={<Pending />}>
              <div>{active?.render()}</div>
            </Suspense>
          </ChunkBoundary>
        </section>

        <aside aria-label="About this product" className="grid gap-3 lg:sticky lg:top-20">
          <LayerCard>
            <LayerCard.Secondary>Where it comes from</LayerCard.Secondary>
            <LayerCard.Primary>
              <Kv
                items={[
                  feed.data
                    ? {
                        term: "Publisher",
                        value: (
                          <a href={publisherHref(feed.data.publisher)} className="text-kumo-link hover:underline">
                            {feed.data.publisher}
                          </a>
                        ),
                      }
                    : null,
                  source
                    ? {
                        term: "Original",
                        value: (
                          <Link href={source.href} target="_blank" rel="noopener noreferrer">
                            {source.hostname} <Link.ExternalIcon />
                          </Link>
                        ),
                      }
                    : null,
                  feed.data ? { term: "Shared", value: throughOf(feed.data) } : null,
                  { term: "Licence", value: data.licence ?? "As stated by the publisher" },
                  data.attribution ? { term: "Attribution", value: data.attribution } : null,
                ]}
              />
            </LayerCard.Primary>
          </LayerCard>
          <LayerCard>
            <LayerCard.Secondary>What this is</LayerCard.Secondary>
            <LayerCard.Primary className="grid gap-3">
              <Kv items={[{ term: "Kind", value: ROLE[data.role].label }]} />
              <p className="text-xs leading-relaxed text-kumo-subtle">{ROLE[data.role].description}</p>
            </LayerCard.Primary>
          </LayerCard>
          <LayerCard>
            <LayerCard.Secondary>How it is collected</LayerCard.Secondary>
            <LayerCard.Primary>
              <Kv
                items={[
                  { term: "Cadence", value: fmt.every(data.cadenceSeconds) },
                  feed.data ? { term: "Next run", value: feed.data.enabled ? <Countdown value={feed.data.nextRunAt} /> : "paused" } : null,
                  feed.data?.lastSuccessAt ? { term: "Last success", value: <RelativeTime value={feed.data.lastSuccessAt} /> } : null,
                  { term: "History", value: data.historyMode === "changes" ? "Every change logged" : "Latest only" },
                  acquisitions.data?.length
                    ? {
                        term: "Recent runs",
                        value: (
                          <span className="grid gap-1">
                            <span className="flex flex-wrap">
                              {acquisitions.data.slice(0, 6).map((run) => {
                                const look = RUN_LOOK[run.status];
                                const RunIcon = look.icon;
                                const label = `${RUN_LABEL[run.status]} · ${fmt.dateTime(run.completedAt ?? run.requestedAt)}${run.error ? ` · ${run.error}` : ""}`;
                                return (
                                  <Tooltip key={run.id} content={label}>
                                    <span tabIndex={0} role="img" aria-label={label} className={`inline-flex size-6 items-center justify-center rounded-full ${look.className}`}>
                                      <RunIcon size={14} weight="fill" aria-hidden="true" />
                                    </span>
                                  </Tooltip>
                                );
                              })}
                            </span>
                            <span className="text-xs text-kumo-subtle">Newest first. Hover or focus one for its time.</span>
                          </span>
                        ),
                      }
                    : null,
                  { term: "Catalog entry", value: <Link href="/api/catalog.dcat.json">DCAT JSON-LD</Link> },
                ]}
              />
            </LayerCard.Primary>
          </LayerCard>
        </aside>
      </div>

      <section aria-labelledby="lineage-title" className="grid gap-4">
        <div className="grid gap-1.5">
          <p className="font-mono text-[0.7rem] font-medium uppercase tracking-[0.12em] text-kumo-brand">Lineage</p>
          <h2 id="lineage-title" className="font-display text-2xl text-kumo-strong sm:text-3xl">
            How the current version was built
          </h2>
          <p className="max-w-2xl text-sm text-kumo-subtle">From the publisher's source to what this page serves: when it was read, checked and published.</p>
        </div>
        <ol className="grid gap-3 md:grid-cols-4">
          <Step n={1} label="Source" last={false}>
            {feed.data ? (
              <>
                <a href={publisherHref(feed.data.publisher)} className="font-display text-lg text-kumo-strong hover:underline">
                  {feed.data.publisher}
                </a>
                <span>Shared {throughOf(feed.data)}</span>
                {source ? (
                  <Link href={source.href} target="_blank" rel="noopener noreferrer">
                    {source.hostname} <Link.ExternalIcon />
                  </Link>
                ) : null}
                {current?.sourcePublishedAt ? <span>Source published {fmt.dateTime(current.sourcePublishedAt)}</span> : null}
              </>
            ) : (
              <Loader size="sm" />
            )}
          </Step>
          <Step n={2} label="Read" last={false}>
            {current ? (
              <>
                <span className="font-display text-lg text-kumo-strong">
                  <RelativeTime value={current.observedAt} />
                </span>
                <span>
                  {fmt.dateTime(current.observedAt)}
                  {current.completeness ? ` · ${current.completeness}` : ""}
                </span>
                {current.revisions !== undefined ? (
                  <span>
                    {fmt.int(current.rows ?? 0)} rows · {fmt.int(current.revisions)} changes
                  </span>
                ) : null}
              </>
            ) : (
              <span>{acquisitions.loading ? "Loading the latest run…" : "No successful collection yet."}</span>
            )}
          </Step>
          <Step n={3} label="Checked" last={false}>
            {current?.normalizer ? (
              <>
                <span className="font-display text-lg text-kumo-strong">{current.normalizer.id}</span>
                <span className="flex items-center gap-2">
                  code version {current.normalizer.version} <Badge variant={current.status === "failed" ? "error" : "success"}>{current.status}</Badge>
                </span>
                {current.quality ? (
                  <span>
                    {fmt.int(current.quality.acceptedRecords)} accepted, {fmt.int(current.quality.rejectedRecords)} rejected
                  </span>
                ) : null}
              </>
            ) : (
              <span>Waiting for the first accepted batch.</span>
            )}
          </Step>
          <Step n={4} label="Published" last>
            <span className="font-display text-lg text-kumo-strong">
              <RelativeTime value={data.updatedAt} />
            </span>
            <span>
              version {fmt.int(data.version)} · {fmt.int(data.rowCount)} {data.role === "time-series" ? "points" : "records"}
            </span>
            {data.watermark ? <span>data through {fmt.dateTime(data.watermark)}</span> : null}
            <span>stale after {fmt.span(data.staleAfterSeconds)} without a refresh</span>
          </Step>
        </ol>
      </section>
    </Shell>
  );
}

function Step({ n, label, last, children }: { n: number; label: string; last: boolean; children: ReactNode }) {
  return (
    <li className="relative">
      <LayerCard className="flex h-full flex-col">
        <LayerCard.Secondary className="flex items-center gap-2 font-mono text-[0.7rem] uppercase tracking-[0.08em]">
          <span className="grid size-5 place-items-center rounded-full bg-kumo-brand text-[0.65rem] font-semibold text-kumo-inverse">{n}</span>
          {label}
        </LayerCard.Secondary>
        <LayerCard.Primary className="grid flex-1 content-start gap-1 text-xs text-kumo-subtle">{children}</LayerCard.Primary>
      </LayerCard>
      {last ? null : (
        <ArrowRightIcon aria-hidden="true" size={16} className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-kumo-canvas text-kumo-subtle md:block" />
      )}
    </li>
  );
}

mountPage(<ProductPage />);
