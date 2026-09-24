import { CommandPalette } from "@cloudflare/kumo";
import { BookOpenIcon, BuildingsIcon, ChartLineIcon, CompassIcon, DatabaseIcon, HandHeartIcon, HeartbeatIcon, MapPinIcon, TableIcon, ScalesIcon } from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";
import { productHref } from "../lib/api";
import { buildListings, buildPublishers, fetchFeeds, fetchProducts, publisherHref, topicLabel } from "../lib/catalog";
import { useQuery } from "../lib/query";

interface SearchItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  icon: ReactNode;
  haystack: string;
}

interface SearchGroup {
  id: string;
  label: string;
  items: SearchItem[];
}

const PAGES: SearchItem[] = [
  { id: "page-catalog", title: "Catalog", detail: "Every dataset, with filters", href: "/catalog/", icon: <CompassIcon />, haystack: "catalog datasets browse" },
  { id: "page-publishers", title: "Publishers", detail: "Who publishes the data", href: "/publisher/", icon: <BuildingsIcon />, haystack: "publishers institutions" },
  { id: "page-licences", title: "Licences", detail: "The terms the data is served under", href: "/licence/", icon: <ScalesIcon />, haystack: "licences licenses terms reuse" },
  { id: "page-status", title: "Status", detail: "Is everything being collected", href: "/status/", icon: <HeartbeatIcon />, haystack: "status uptime downtime incidents" },
  { id: "page-start", title: "Start here", detail: "Use the API in three requests", href: "/start/", icon: <BookOpenIcon />, haystack: "start api docs curl" },
  {
    id: "page-operations",
    title: "Operations",
    detail: "Every feed, run and rule",
    href: "/operations/",
    icon: <DatabaseIcon />,
    haystack: "operations feeds runs policies usage",
  },
  {
    id: "page-contribute",
    title: "Contribute",
    detail: "Suggest a source, add a dataset, report a problem",
    href: "/contribute/",
    icon: <HandHeartIcon />,
    haystack: "contribute help github source code open source suggest report",
  },
];

const PER_GROUP = 8;

/** Spotlight search over datasets, their tables, publishers and pages. Data loads the first time it opens. */
export function SearchPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [search, setSearch] = useState("");
  const products = useQuery(open ? "products" : null, fetchProducts);
  const feeds = useQuery(open ? "feeds" : null, fetchFeeds);
  const failed = products.error ?? feeds.error;

  const index = useMemo(() => {
    if (!products.data || !feeds.data) return { listings: [], publishers: [] };
    const listings = buildListings(products.data, feeds.data);
    const listingItems: SearchItem[] = listings.map(({ product, title, description, publisher, topics }) => ({
      id: product.slug,
      title,
      detail: publisher.name,
      href: productHref(product.slug),
      icon:
        product.role === "time-series" ? (
          <ChartLineIcon />
        ) : product.schema.fields.some((field) => field.type === "geometry" || field.type === "latitude") ? (
          <MapPinIcon />
        ) : (
          <TableIcon />
        ),
      haystack: `${title} ${product.slug} ${publisher.name} ${topics.map(topicLabel).join(" ")} ${description}`.toLocaleLowerCase(),
    }));
    const publisherItems: SearchItem[] = buildPublishers(listings).map((publisher) => ({
      id: `publisher-${publisher.id}`,
      title: publisher.name,
      detail: `${publisher.listings.length} ${publisher.listings.length === 1 ? "table or series" : "tables and series"}`,
      href: publisherHref(publisher.id),
      icon: <BuildingsIcon />,
      haystack: publisher.name.toLocaleLowerCase(),
    }));
    return { listings: listingItems, publishers: publisherItems };
  }, [products.data, feeds.data]);

  const groups = useMemo<SearchGroup[]>(() => {
    const words = search.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matches = (item: SearchItem) => words.every((word) => item.haystack.includes(word) || item.title.toLocaleLowerCase().includes(word));
    const pick = (items: SearchItem[]) => (words.length ? items.filter(matches) : items).slice(0, PER_GROUP);
    return [
      { id: "listings", label: "Tables and series", items: pick(index.listings) },
      { id: "publishers", label: "Publishers", items: pick(index.publishers) },
      { id: "pages", label: "Pages", items: pick(PAGES) },
    ].filter((group) => group.items.length > 0);
  }, [index, search]);

  const go = (href: string, newTab = false) => {
    if (newTab) window.open(href, "_blank", "noopener");
    else window.location.assign(href);
    onOpenChange(false);
  };

  return (
    <CommandPalette.Root
      open={open}
      onOpenChange={onOpenChange}
      items={groups}
      value={search}
      onValueChange={setSearch}
      itemToStringValue={(group: SearchGroup) => group.label}
      onSelect={(item: SearchItem, details: { newTab: boolean }) => go(item.href, details.newTab)}
      getSelectableItems={(all: SearchGroup[]) => all.flatMap((group) => group.items)}
    >
      <CommandPalette.Input aria-label="Search datasets, publishers and pages" placeholder="Search datasets, publishers and pages…" />
      <CommandPalette.List>
        {/* Page results can match while the catalog is still failing, and Empty never renders then. */}
        {failed ? (
          <p role="alert" className="px-3 py-2 text-sm text-kumo-danger">
            Could not load the catalog ({failed.message}). Datasets and publishers are missing from these results; close the search and open it again to retry.
          </p>
        ) : null}
        <CommandPalette.Results>
          {(group: SearchGroup) => (
            <CommandPalette.Group key={group.id} items={group.items}>
              <CommandPalette.GroupLabel>{group.label}</CommandPalette.GroupLabel>
              <CommandPalette.Items>
                {(item: SearchItem) => (
                  <CommandPalette.Item key={item.id} value={item} onClick={() => go(item.href)}>
                    {/* The title is what you choose by: it takes the room, and the detail gives way first. */}
                    <span className="flex w-full min-w-0 items-center gap-3">
                      <span className="shrink-0 text-kumo-subtle">{item.icon}</span>
                      <span className="min-w-0 flex-1 truncate" title={item.title}>
                        {item.title}
                      </span>
                      <span className="hidden min-w-0 max-w-[40%] truncate pl-3 text-xs text-kumo-subtle sm:inline" title={item.detail}>
                        {item.detail}
                      </span>
                    </span>
                  </CommandPalette.Item>
                )}
              </CommandPalette.Items>
            </CommandPalette.Group>
          )}
        </CommandPalette.Results>
        <CommandPalette.Empty>
          {failed
            ? "No page matches that search either."
            : products.loading || feeds.loading
              ? "Loading the catalog…"
              : `No dataset, publisher or page matches “${search.trim()}”.`}
        </CommandPalette.Empty>
      </CommandPalette.List>
      <CommandPalette.Footer>
        <span className="flex items-center gap-2 text-xs">
          <kbd className="rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 text-xs">↑↓</kbd> Move
          <kbd className="ml-2 rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 text-xs">↵</kbd> Open
          <kbd className="ml-2 rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 text-xs">esc</kbd> Close
        </span>
      </CommandPalette.Footer>
    </CommandPalette.Root>
  );
}
