import { Badge, LayerCard } from "@cloudflare/kumo";
import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { productHref } from "../lib/api";
import { publisherHref, type Dataset, type LabelledProduct } from "../lib/catalog";
import { fmt } from "../lib/format";
import { RelativeTime, RoleBadge, ToneBadge } from "./common";
import { PublisherMark } from "./PublisherMark";

const TONE_WORD = { ok: "Current", warn: "Late", bad: "Failing" } as const;

function ProductLink({ item }: { item: LabelledProduct }) {
  const { product, label } = item;
  const series = product.role === "time-series";
  const capped = series && product.rowCount >= 5000;
  const count = product.rowCount === 0 ? "empty" : `${fmt.compact(product.rowCount)}${capped ? "+" : ""} ${series ? "pts" : "rows"}`;
  return (
    <li className="min-w-0">
      <a
        href={productHref(product.slug)}
        title={product.title}
        className="group flex min-w-0 items-center gap-2 rounded-2xl bg-kumo-base px-2 py-1.5 text-sm text-kumo-default no-underline ring-1 ring-kumo-line transition-colors hover:bg-kumo-tint hover:ring-kumo-focus/40"
      >
        <RoleBadge role={product.role} />
        {/* The label is what tells sibling tables apart, so it wraps rather than being cut. Most
            are one line: the words every product of a dataset repeats are dropped from all of them
            (`labelled` in lib/catalog.ts). Three lines is the backstop for the sources that name a
            series with a sentence; the whole title is this row's tooltip and the product's page. */}
        <span className="line-clamp-3 min-w-0 flex-1 text-pretty">{label}</span>
        <span className="shrink-0 font-mono text-xs text-kumo-subtle">{count}</span>
        <ArrowUpRightIcon className="shrink-0 text-kumo-subtle opacity-0 transition-opacity group-hover:opacity-100" size={14} aria-hidden="true" />
      </a>
    </li>
  );
}

/** One dataset as a layered card: who and how on the top layer, what and its tables below. */
export function DatasetCard({ dataset, showPublisher = true }: { dataset: Dataset; showPublisher?: boolean }) {
  const only = dataset.products.length === 1 ? dataset.products[0]?.product : undefined;
  return (
    <LayerCard>
      <LayerCard.Secondary className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          {showPublisher ? (
            <a href={publisherHref(dataset.publisher.id)} className="inline-flex min-h-6 min-w-0 items-center gap-1.5 font-medium text-kumo-default hover:underline">
              <PublisherMark publisher={dataset.publisher} size={18} className="rounded-sm" />
              {dataset.publisher.name}
            </a>
          ) : null}
          <Badge variant="outline">{dataset.format}</Badge>
          <span className="text-kumo-subtle">{fmt.every(dataset.cadence)}</span>
        </span>
        <span className="flex items-center gap-2 text-kumo-subtle">
          {dataset.empty ? <Badge variant="outline">Empty at the source</Badge> : null}
          <ToneBadge tone={dataset.tone}>{TONE_WORD[dataset.tone]}</ToneBadge>
          {dataset.updatedAt ? <RelativeTime value={dataset.updatedAt} className="font-mono text-xs" /> : null}
        </span>
      </LayerCard.Secondary>
      <LayerCard.Primary className="grid gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="grid min-w-0 content-start gap-1">
          <h3 className="text-base font-semibold leading-snug text-kumo-strong">
            {only ? (
              <a href={productHref(only.slug)} className="text-kumo-strong no-underline hover:underline">
                {dataset.title}
              </a>
            ) : (
              dataset.title
            )}
          </h3>
          {dataset.feed.description ? (
            <p className="line-clamp-2 max-w-[36rem] text-sm text-kumo-subtle" title={dataset.feed.description}>
              {dataset.feed.description}
            </p>
          ) : null}
        </div>
        <ul className="grid min-w-0 content-start gap-1.5" aria-label={`Tables and series of ${dataset.title}`}>
          {dataset.products.map((item) => (
            <ProductLink key={item.product.slug} item={item} />
          ))}
        </ul>
      </LayerCard.Primary>
    </LayerCard>
  );
}
