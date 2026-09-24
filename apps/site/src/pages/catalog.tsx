import { Badge, Button, Checkbox, Collapsible, Empty, InputGroup, Select } from "@cloudflare/kumo";
import { FunnelSimpleIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { ListingRows } from "../components/ListingRows";
import { PublisherMark } from "../components/PublisherMark";
import { ErrorNote, PageHead, Placeholder } from "../components/common";
import { mountPage } from "../components/mount";
import { Shell } from "../components/Shell";
import { ROLE, UPDATES, buildListings, buildPublishers, fetchFeeds, fetchProducts, publisherHref, topicLabel, type Listing, emptyLast } from "../lib/catalog";
import { fmt, plural } from "../lib/format";
import { useQuery } from "../lib/query";
import type { Role } from "../lib/types";

type FacetId = "topic" | "publisher" | "licence" | "kind" | "updates" | "format";
type SortOrder = "publisher" | "recent" | "name";

interface Facet {
  id: FacetId;
  label: string;
  values: (listing: Listing) => string[];
  /** Show the first few; the rest behind "Show all". */
  collapsed?: number;
  order?: string[];
}

const ROLE_IDS = new Set<string>(Object.keys(ROLE));
const isRole = (value: string): value is Role => ROLE_IDS.has(value);

const FACETS: Facet[] = [
  { id: "topic", label: "Topic", values: (listing) => listing.topics },
  { id: "publisher", label: "Publisher", values: (listing) => [listing.publisher.id], collapsed: 8 },
  { id: "licence", label: "Licence", values: (listing) => [listing.licence.id], collapsed: 6 },
  { id: "kind", label: "Kind of data", values: (listing) => [listing.role] },
  { id: "updates", label: "Updates", values: (listing) => [listing.updates], order: UPDATES.map((bucket) => bucket.id) },
  { id: "format", label: "How it is published", values: (listing) => [listing.format] },
];

const SORTS = { publisher: "Grouped by publisher", recent: "Recently updated first", name: "By name" };
const isSort = (value: string | null): value is SortOrder => value === "publisher" || value === "recent" || value === "name";

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    sort: isSort(sort) ? sort : "publisher",
    selected: new Map<FacetId, string[]>(FACETS.map((facet) => [facet.id, params.getAll(facet.id)])),
  };
}

function Catalog() {
  const products = useQuery("products", fetchProducts);
  const feeds = useQuery("feeds", fetchFeeds);
  const initial = useMemo(readUrl, []);
  const [q, setQ] = useState(initial.q);
  const [sort, setSort] = useState<SortOrder>(initial.sort);
  const [selected, setSelected] = useState(initial.selected);
  const [expanded, setExpanded] = useState<Set<FacetId>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(() => window.matchMedia("(min-width: 64rem)").matches);

  const listings = useMemo(() => (products.data && feeds.data ? buildListings(products.data, feeds.data) : []), [products.data, feeds.data]);
  const publisherNames = useMemo(() => new Map(buildPublishers(listings).map((publisher) => [publisher.id, publisher.name])), [listings]);
  const licenceNames = useMemo(() => new Map(listings.map((listing) => [listing.licence.id, listing.licence.name] as const)), [listings]);

  const nameOf = (facet: FacetId, value: string) => {
    if (facet === "topic") return topicLabel(value);
    if (facet === "publisher") return publisherNames.get(value) ?? value;
    if (facet === "licence") return licenceNames.get(value) ?? value;
    if (facet === "kind") return isRole(value) ? ROLE[value].label : value;
    if (facet === "updates") return UPDATES.find((bucket) => bucket.id === value)?.label ?? value;
    return value;
  };

  // The address carries the search, so a filtered catalog can be shared.
  useEffect(() => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (sort !== "publisher") next.set("sort", sort);
    for (const facet of FACETS) for (const value of selected.get(facet.id) ?? []) next.append(facet.id, value);
    const query = next.toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [q, sort, selected]);

  const words = q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matchesQuery = (listing: Listing) => {
    if (words.length === 0) return true;
    const haystack = [listing.title, listing.description, listing.id, listing.publisher.name, listing.format, ...listing.topics.map(topicLabel)].join(" ").toLocaleLowerCase();
    return words.every((word) => haystack.includes(word));
  };
  const matchesFacets = (listing: Listing, except?: FacetId) =>
    FACETS.every((facet) => {
      if (facet.id === except) return true;
      const chosen = selected.get(facet.id) ?? [];
      return chosen.length === 0 || facet.values(listing).some((value) => chosen.includes(value));
    });

  const searched = listings.filter(matchesQuery);
  const visible = searched.filter((listing) => matchesFacets(listing));

  const choose = (facet: FacetId, values: string[]) => setSelected((current) => new Map(current).set(facet, values));
  const clearAll = () => {
    setQ("");
    setSelected(new Map(FACETS.map((facet) => [facet.id, []])));
  };
  const active = FACETS.flatMap((facet) => (selected.get(facet.id) ?? []).map((value) => ({ facet: facet.id, value })));

  const byOrder = (a: Listing, b: Listing) =>
    sort === "recent"
      ? (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
      : sort === "name"
        ? a.title.localeCompare(b.title)
        : a.publisher.name.localeCompare(b.publisher.name) || a.title.localeCompare(b.title);
  const ordered = [...visible].sort((a, b) => emptyLast(a, b) || byOrder(a, b));
  const groups = new Map<string, Listing[]>();
  if (sort === "publisher") for (const listing of ordered) groups.set(listing.publisher.id, [...(groups.get(listing.publisher.id) ?? []), listing]);

  const facetPanel = (
    <div className="grid gap-6">
      {FACETS.map((facet) => {
        const pool = searched.filter((listing) => matchesFacets(listing, facet.id));
        const counts = new Map<string, number>();
        for (const listing of pool) for (const value of facet.values(listing)) counts.set(value, (counts.get(value) ?? 0) + 1);
        const chosen = selected.get(facet.id) ?? [];
        for (const value of chosen) if (!counts.has(value)) counts.set(value, 0);
        let options = [...counts.entries()].sort(
          facet.order
            ? (a, b) => (facet.order ?? []).indexOf(a[0]) - (facet.order ?? []).indexOf(b[0])
            : (a, b) => b[1] - a[1] || nameOf(facet.id, a[0]).localeCompare(nameOf(facet.id, b[0])),
        );
        const hidden = facet.collapsed && !expanded.has(facet.id) ? options.length - facet.collapsed : 0;
        if (hidden > 0) options = options.filter(([value], index) => index < (facet.collapsed ?? 0) || chosen.includes(value));
        return (
          <fieldset key={facet.id} className="grid min-w-0 gap-1.5">
            <legend className="mb-2 font-mono text-xs uppercase tracking-[0.08em] text-kumo-subtle">{facet.label}</legend>
            {options.map(([value, count]) => (
              <Checkbox
                key={value}
                checked={chosen.includes(value)}
                disabled={count === 0 && !chosen.includes(value)}
                onCheckedChange={(checked: boolean) => choose(facet.id, checked ? [...chosen, value] : chosen.filter((each) => each !== value))}
                label={
                  <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                    {/* Long publisher names wrap onto a second line instead of pushing the sidebar sideways. */}
                    <span className="min-w-0 [overflow-wrap:anywhere]">{nameOf(facet.id, value)}</span>
                    <span className="shrink-0 font-mono text-xs text-kumo-subtle">{count}</span>
                  </span>
                }
              />
            ))}
            {hidden > 0 ? (
              <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setExpanded((current) => new Set(current).add(facet.id))}>
                Show all {counts.size}
              </Button>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );

  return (
    <Shell section="catalog">
      <PageHead eyebrow="Catalog" title="Every dataset, and who publishes it">
        Filter by topic, publisher, kind of data, how often it changes, or how the publisher shares it. Every table and series keeps its publisher’s licence and links back to their
        source.
      </PageHead>

      <div className="grid items-start gap-8 lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        {/* The filters scroll with the page: a capped, separately scrolling column hid its last groups behind a second scrollbar. */}
        <aside aria-label="Filters" className="min-w-0">
          <Collapsible.Root open={filtersOpen} onOpenChange={setFiltersOpen}>
            <Collapsible.Trigger render={<Button variant="secondary" size="sm" icon={<FunnelSimpleIcon />} className="lg:hidden" />}>
              {filtersOpen ? "Hide filters" : `Filters${active.length ? ` (${active.length})` : ""}`}
            </Collapsible.Trigger>
            <Collapsible.Panel className="mt-4 lg:mt-0">{facetPanel}</Collapsible.Panel>
          </Collapsible.Root>
        </aside>

        <section aria-label="Tables and series" className="grid min-w-0 gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 basis-72">
              <InputGroup>
                <InputGroup.Addon>
                  <MagnifyingGlassIcon />
                </InputGroup.Addon>
                <InputGroup.Input
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder="Search tables, series and publishers…"
                  aria-label="Search the catalog"
                  autoFocus={Boolean(initial.q)}
                />
              </InputGroup>
            </div>
            <span className="flex items-center gap-2 text-sm text-kumo-subtle">
              <span id="sort-label">Order</span>
              <Select
                aria-labelledby="sort-label"
                className="w-56"
                value={sort}
                onValueChange={(value: string | null) => setSort(isSort(value) ? value : "publisher")}
                items={SORTS}
              />
            </span>
          </div>

          <div className="flex min-h-8 flex-wrap items-center gap-2">
            <p className="text-sm text-kumo-subtle" role="status" aria-live="polite">
              {listings.length === 0
                ? products.error || feeds.error
                  ? ""
                  : "Loading the catalog…"
                : `${plural(visible.length, "table or series", "tables and series")}${visible.length !== listings.length ? `, of ${fmt.int(listings.length)}` : ""}`}
            </p>
            {active.map((item) => (
              <Button
                key={`${item.facet}:${item.value}`}
                size="sm"
                variant="secondary"
                icon={<XIcon />}
                aria-label={`Remove filter ${nameOf(item.facet, item.value)}`}
                onClick={() =>
                  choose(
                    item.facet,
                    (selected.get(item.facet) ?? []).filter((value) => value !== item.value),
                  )
                }
              >
                {nameOf(item.facet, item.value)}
              </Button>
            ))}
            {active.length > 1 || (active.length > 0 && q) ? (
              <Button size="sm" variant="ghost" onClick={clearAll}>
                Clear all
              </Button>
            ) : null}
          </div>

          <ErrorNote
            error={products.error ?? feeds.error}
            what="the catalog"
            onRetry={() => {
              void products.refetch();
              void feeds.refetch();
            }}
          />
          {listings.length === 0 && !products.error && !feeds.error ? <Placeholder rows={4} label="Loading the catalog" /> : null}
          {listings.length > 0 && visible.length === 0 ? (
            <Empty
              icon={<MagnifyingGlassIcon size={40} className="text-kumo-inactive" />}
              title="Nothing matches"
              description="Try another word, or remove a filter."
              contents={
                <Button variant="primary" onClick={clearAll}>
                  Clear search and filters
                </Button>
              }
            />
          ) : null}

          {/* Publisher groups sit well apart: the gap between groups is several times the gap inside one. */}
          {sort === "publisher" ? (
            <div className="grid gap-10">
              {[...groups.entries()].map(([id, group]) => (
                <div key={id} className="grid gap-3">
                  <div className="flex items-center justify-between gap-4 border-b border-kumo-line pb-2">
                    <h2 className="flex min-w-0 items-center gap-2.5 font-display text-xl text-kumo-strong">
                      {group[0] ? <PublisherMark publisher={group[0].publisher} size={28} /> : null}
                      <a href={publisherHref(id)} className="min-w-0 no-underline hover:underline">
                        {group[0]?.publisher.name ?? id}
                      </a>
                    </h2>
                    <Badge variant="secondary">{plural(group.length, "table or series", "tables and series")}</Badge>
                  </div>
                  <ListingRows listings={group} underPublisher />
                </div>
              ))}
            </div>
          ) : (
            <ListingRows listings={ordered} />
          )}
        </section>
      </div>
    </Shell>
  );
}

mountPage(<Catalog />);
