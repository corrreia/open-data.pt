import { CommandPalette } from "@cloudflare/kumo";
import { BookOpenIcon, BuildingsIcon, ChartLineIcon, CompassIcon, DatabaseIcon, HandHeartIcon, HeartbeatIcon, MapPinIcon, TableIcon, ScalesIcon } from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";
import { productHref } from "../lib/api";
import { buildListings, buildPublishers, fetchFeeds, fetchProducts, listingHaystack, publisherHref, searchable, searchWords } from "../lib/catalog";
import { localHref } from "../lib/locale";
import { useQuery } from "../lib/query";
import { LISTINGS } from "../text/listings";
import { SEARCH } from "../text/search";

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

/** The site's pages, found by their words in either language whichever the page is in, as `searchable` writes them. */
const PAGES: SearchItem[] = [
  {
    id: "page-catalog",
    ...SEARCH.pages.catalog,
    href: localHref("/catalog/"),
    icon: <CompassIcon />,
    haystack: "catalog datasets browse catalogo conjuntos dados explorar",
  },
  {
    id: "page-publishers",
    ...SEARCH.pages.publishers,
    href: localHref("/publisher/"),
    icon: <BuildingsIcon />,
    haystack: "publishers institutions entidades publicadoras instituicoes",
  },
  {
    id: "page-licences",
    ...SEARCH.pages.licences,
    href: localHref("/licence/"),
    icon: <ScalesIcon />,
    haystack: "licences licenses terms reuse licencas termos reutilizacao",
  },
  {
    id: "page-status",
    ...SEARCH.pages.status,
    href: localHref("/status/"),
    icon: <HeartbeatIcon />,
    haystack: "status uptime downtime incidents estado disponibilidade falhas incidentes",
  },
  { id: "page-start", ...SEARCH.pages.start, href: localHref("/start/"), icon: <BookOpenIcon />, haystack: "start api docs curl comecar documentacao" },
  {
    id: "page-operations",
    ...SEARCH.pages.operations,
    href: localHref("/operations/"),
    icon: <DatabaseIcon />,
    haystack: "operations feeds runs policies usage operacoes fontes recolhas regras utilizacao",
  },
  {
    id: "page-contribute",
    ...SEARCH.pages.contribute,
    href: localHref("/contribute/"),
    icon: <HandHeartIcon />,
    haystack: "contribute help github source code open source suggest report contribuir ajudar codigo fonte aberto sugerir avisar problema",
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
    const listingItems: SearchItem[] = listings.map((listing) => {
      const { product, title, publisher } = listing;
      return {
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
        haystack: listingHaystack(listing),
      };
    });
    const publisherItems: SearchItem[] = buildPublishers(listings).map((publisher) => ({
      id: `publisher-${publisher.id}`,
      title: publisher.name,
      detail: LISTINGS.count(publisher.listings.length),
      href: publisherHref(publisher.id),
      icon: <BuildingsIcon />,
      haystack: searchable(publisher.name),
    }));
    return { listings: listingItems, publishers: publisherItems };
  }, [products.data, feeds.data]);

  const groups = useMemo<SearchGroup[]>(() => {
    const words = searchWords(search);
    const matches = (item: SearchItem) => words.every((word) => item.haystack.includes(word) || searchable(item.title).includes(word));
    const pick = (items: SearchItem[]) => (words.length ? items.filter(matches) : items).slice(0, PER_GROUP);
    return [
      { id: "listings", label: SEARCH.groups.listings, items: pick(index.listings) },
      { id: "publishers", label: SEARCH.groups.publishers, items: pick(index.publishers) },
      { id: "pages", label: SEARCH.groups.pages, items: pick(PAGES) },
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
      <CommandPalette.Input aria-label={SEARCH.inputLabel} placeholder={SEARCH.placeholder} />
      <CommandPalette.List>
        {/* Page results can match while the catalog is still failing, and Empty never renders then. */}
        {failed ? (
          <p role="alert" className="px-3 py-2 text-sm text-kumo-danger">
            {SEARCH.failed(failed.message)}
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
        <CommandPalette.Empty>{failed ? SEARCH.noPageEither : products.loading || feeds.loading ? SEARCH.loading : SEARCH.noMatch(search.trim())}</CommandPalette.Empty>
      </CommandPalette.List>
      <CommandPalette.Footer>
        <span className="flex items-center gap-2 text-xs">
          <kbd className="rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 text-xs">↑↓</kbd> {SEARCH.move}
          <kbd className="ml-2 rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 text-xs">↵</kbd> {SEARCH.open}
          <kbd className="ml-2 rounded border border-kumo-hairline bg-kumo-base px-1.5 py-0.5 text-xs">esc</kbd> {SEARCH.close}
        </span>
      </CommandPalette.Footer>
    </CommandPalette.Root>
  );
}
