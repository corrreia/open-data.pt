import { Button, ClipboardText, LayerCard, LinkButton, TableOfContents, useTableOfContentsActiveId } from "@cloudflare/kumo";
import { ArrowRightIcon, BracketsCurlyIcon, CheckIcon, CopyIcon, GiftIcon, KeyIcon, SealCheckIcon } from "@phosphor-icons/react";
import { useMemo, type ReactNode } from "react";
import { PageHead, RoleBadge, SectionHead } from "../components/common";
import { mountPage } from "../components/mount";
import { CommandBlock, useCopy } from "../components/ops/CommandBlock";
import { useHashLanding } from "../components/ops/useHashLanding";
import { Shell } from "../components/Shell";
import { productHref } from "../lib/api";
import { fetchProducts } from "../lib/catalog";
import { fmt, plural } from "../lib/format";
import { useQuery } from "../lib/query";
import type { Product, Role } from "../lib/types";

const API = "https://open-data.pt";
const MCP_URL = `${API}/mcp`;
const LINK = "font-medium text-kumo-link hover:underline";

/** What a reader pastes into their assistant so it connects the server itself, whatever app it runs in. */
const MCP_SETUP_PROMPT = `Connect the open-data.pt MCP server to this assistant.

- Address: ${MCP_URL}
- Transport: Streamable HTTP (a remote server; no API key, no sign-in)
- Name: open-data-pt

Add it to the MCP settings of the app you are running in. In Claude Code that is:
claude mcp add --transport http open-data-pt ${MCP_URL}

Then tell me whether I need to restart or reload for it to appear. Once connected, its search and execute tools read free Portuguese public data.`;
function InlineCode({ children }: { children: ReactNode }) {
  return <code className="rounded bg-kumo-recessed px-1 py-0.5 font-mono text-[0.85em] text-kumo-strong">{children}</code>;
}

/* ---------- Content ---------- */

interface PageSection {
  id: string;
  label: string;
}

const SECTIONS: PageSection[] = [
  { id: "three-requests", label: "Three requests" },
  { id: "mcp", label: "AI assistants (MCP)" },
  { id: "kinds", label: "Five kinds of product" },
  { id: "history", label: "Where the past lives" },
  { id: "etiquette", label: "Limits and manners" },
  { id: "every-way-in", label: "Every way in" },
];

interface Pledge {
  icon: ReactNode;
  lead: string;
  body: ReactNode;
}

const PLEDGES: Pledge[] = [
  { icon: <GiftIcon size={20} />, lead: "Free.", body: "Reads cost nothing and never will. The platform runs on a hobby budget by design." },
  {
    icon: <KeyIcon size={20} />,
    lead: "No key.",
    body: (
      <>
        The whole API is open and read-only; there is nothing to write. Requests are rate limited per client, and a <InlineCode>429</InlineCode> response says when to retry.
      </>
    ),
  },
  { icon: <SealCheckIcon size={20} />, lead: "Credited.", body: "Each product carries the licence and attribution of its publisher." },
  {
    icon: <BracketsCurlyIcon size={20} />,
    lead: "Machine first.",
    body: (
      <>
        JSON everywhere, CORS on, OpenAPI 3.1, DCAT 3, an{" "}
        <a href="#mcp" className={LINK}>
          MCP server
        </a>{" "}
        and a plain-text{" "}
        <a href="/llms.txt" className={LINK}>
          llms.txt
        </a>
        .
      </>
    ),
  },
];

interface ReadHint {
  what: string;
  path: string;
}

interface KindGuide {
  role: Role;
  text: string;
  reads: ReadHint[];
}

const KINDS: KindGuide[] = [
  {
    role: "reference",
    text: "A complete, slow-changing set such as stops, stations, or municipalities. Each collection replaces the whole set.",
    reads: [{ what: "Records", path: "/records" }],
  },
  { role: "current-state", text: "The latest state of each entity: vehicle positions, fuel prices, fire risk.", reads: [{ what: "Records", path: "/records" }] },
  {
    role: "event-log",
    text: "Things that happened, kept with corrections and retractions.",
    reads: [
      { what: "Current records", path: "/records" },
      { what: "Applicable history", path: "/events" },
      { what: "Durable revisions", path: "/changes/range" },
    ],
  },
  {
    role: "time-series",
    text: "Numeric points keyed by series and event time.",
    reads: [
      { what: "The hot window", path: "/series" },
      { what: "Durable ranges", path: "/series/range" },
    ],
  },
  { role: "summary", text: "A small aggregate derived from a sibling product in the same run, such as a fleet count.", reads: [{ what: "Records", path: "/records" }] },
];

interface HistoryEndpoint {
  path: string;
  text: string;
}

const HISTORY_ENDPOINTS: HistoryEndpoint[] = [
  { path: "/api/products/{slug}/events?from=<ISO>&to=<ISO>", text: "The applicable known revision of each event in the interval." },
  { path: "/api/products/{slug}/changes/range?from=<ISO>&to=<ISO>", text: "Durable corrections and retractions in knowledge-time order." },
  { path: "/api/products/{slug}/series/range?from=<ISO>&to=<ISO>", text: "Deduplicated time-series points." },
];

interface Manner {
  lead: string;
  body: ReactNode;
}

const MANNERS: Manner[] = [
  { lead: "Use bounded ranges.", body: "Historical endpoints require a UTC interval of at most 366 days and are cached at the edge." },
  {
    lead: "Poll at the product's cadence.",
    body: "Each product page says how often its feed runs. Near-real-time products refresh every one to five minutes, most others hourly or daily.",
  },
  {
    lead: "Page deterministically.",
    body: (
      <>
        Follow each endpoint's opaque <InlineCode>nextCursor</InlineCode> until it is null; equal timestamps are safe.
      </>
    ),
  },
  { lead: "Attribute the publisher,", body: "not this site. The data is theirs; this site preserves and serves it." },
  {
    lead: "Read the product metadata first.",
    body: (
      <>
        <InlineCode>GET /api/products/{"{slug}"}</InlineCode> carries the schema, unit, row count, watermark and whether the product is stale, so you know what the rows mean before
        you fetch them.
      </>
    ),
  },
  {
    lead: "Something wrong?",
    body: (
      <>
        The{" "}
        <a href="/status/" className={LINK}>
          status page
        </a>{" "}
        shows downtime day by day, and{" "}
        <a href="/operations/#activity" className={LINK}>
          operations
        </a>{" "}
        shows every run, including the failed ones, with a day picker to look at any past day.
      </>
    ),
  },
];

interface EntryPoint {
  title: string;
  path: string;
  description: string;
  /** False for an address only a program can use, which a browser would not show. */
  browsable?: boolean;
}

const ENTRY_POINTS: EntryPoint[] = [
  { title: "Product list", path: "/api/products", description: "Every product with role, schema, counts and freshness. Start here." },
  { title: "MCP server", path: "/mcp", description: "For AI assistants. Streamable HTTP, no key.", browsable: false },
  { title: "OpenAPI 3.1", path: "/openapi.json", description: "The exact contract for every endpoint, including parameters and error formats." },
  { title: "llms.txt", path: "/llms.txt", description: "A plain-text guide for language models: what exists, how to call it, what to avoid." },
  { title: "DCAT 3 catalog", path: "/api/catalog.dcat.json", description: "JSON-LD dataset entries with licence, attribution, publisher and distribution URLs." },
  { title: "Feeds", path: "/api/feeds", description: "Every collection job: its source, cadence, last run and next run. Read-only." },
  { title: "Health", path: "/api/health", description: "A single JSON status for uptime checks." },
];

/* ---------- Examples named after real products ---------- */

/** Among the ten largest products of a kind, the shortest slug reads best in a curl line. */
function biggest(products: Product[], keep: (product: Product) => boolean) {
  return [...products]
    .filter(keep)
    .sort((a, b) => b.rowCount - a.rowCount)
    .slice(0, 10)
    .sort((a, b) => a.slug.length - b.slug.length)[0]?.slug;
}

/* ---------- Pieces ---------- */

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4 gap-y-3">
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-kumo-brand font-mono text-sm text-kumo-inverse">
        {n}
      </span>
      <div className="grid min-w-0 gap-3">
        <h3 className="pt-1 font-medium text-kumo-strong">
          <span className="sr-only">{n}. </span>
          {title}
        </h3>
        {children}
      </div>
    </li>
  );
}

function CopyPromptButton() {
  const { copied, copy } = useCopy(MCP_SETUP_PROMPT);
  return (
    <>
      <Button variant="primary" size="base" icon={copied ? <CheckIcon /> : <CopyIcon />} onClick={copy} className="shrink-0">
        {copied ? "Copied" : "Copy the setup prompt"}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Setup prompt copied" : ""}
      </span>
    </>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-kumo-subtle">{children}</p>;
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <SectionHead eyebrow={eyebrow} title={title} id={`${id}-title`} />
      <div className="grid gap-5 leading-relaxed text-kumo-default">{children}</div>
    </section>
  );
}

/* ---------- Page ---------- */

function Start() {
  const products = useQuery("products", fetchProducts, { staleMs: 60_000 });
  const list = products.data;
  const records = useMemo(() => (list ? biggest(list, (product) => product.role !== "time-series") : undefined), [list]);
  const series = useMemo(() => (list ? biggest(list, (product) => product.role === "time-series") : undefined), [list]);
  const byRole = useMemo(() => {
    const counts = new Map<Role, number>();
    for (const product of list ?? []) counts.set(product.role, (counts.get(product.role) ?? 0) + 1);
    return counts;
  }, [list]);

  const { activeId, selectSection } = useTableOfContentsActiveId({ ids: SECTIONS.map((section) => section.id), offset: 112 });
  useHashLanding(true);

  const recordsSlug = records ?? "{slug}";
  const seriesSlug = series ?? "{slug}";

  return (
    <Shell section="start">
      <div className="grid gap-8">
        <PageHead
          eyebrow="Start here"
          title={
            <>
              Free, keyless, <em className="text-kumo-brand">meant to stay that way</em>.
            </>
          }
        >
          open-data.pt collects Portuguese public data from the institutions that publish it and serves it as clean JSON. There is no account, no API key, no quota to buy, and no
          plan to add one. Use it from a script, a notebook, a spreadsheet, or any tool that speaks HTTP.
        </PageHead>
        <ul aria-label="What you can count on" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLEDGES.map((pledge) => (
            <li key={pledge.lead}>
              <LayerCard className="flex h-full flex-col">
                <LayerCard.Primary className="grid flex-1 content-start gap-2">
                  <span className="text-kumo-brand">{pledge.icon}</span>
                  <p className="text-sm leading-relaxed text-kumo-subtle">
                    <strong className="font-semibold text-kumo-strong">{pledge.lead}</strong> {pledge.body}
                  </p>
                </LayerCard.Primary>
              </LayerCard>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_13rem] xl:gap-16">
        <div className="grid min-w-0 gap-16">
          <Section id="three-requests" eyebrow="Three requests" title="Everything starts from the product list">
            <p className="max-w-[68ch]">
              A <strong>product</strong> is one table you can read: current records, a time series, an event log, or a summary. List them, pick one by its{" "}
              <InlineCode>slug</InlineCode>, then read its rows. Every response is JSON with a <InlineCode>data</InlineCode> array.
            </p>
            <ol className="grid gap-8">
              <Step n={1} title="List the products">
                <CommandBlock command={`curl ${API}/api/products`} label="List the products" />
                <Note>
                  Returns every product with its role, schema, row count, watermark and freshness. {list ? `${fmt.int(list.length)} today` : "About 200 today"}. Cached for 20
                  seconds at the edge.
                </Note>
              </Step>
              <Step n={2} title="Read a product's current records">
                <CommandBlock command={`curl "${API}/api/products/${recordsSlug}/records?limit=100"`} highlight={recordsSlug} label="Read a product's current records" />
                <Note>
                  Follow <InlineCode>nextCursor</InlineCode> for the next page. Add <InlineCode>validAt=&lt;ISO time&gt;</InlineCode> for what was valid then; earlier versions live
                  in the history endpoints.
                </Note>
              </Step>
              <Step n={3} title="Read a time series">
                <CommandBlock command={`curl "${API}/api/products/${seriesSlug}/series?limit=500"`} highlight={seriesSlug} label="Read a time series" />
                <Note>
                  Newest points first. The rolling window holds the last 5,000 points; use the bounded <InlineCode>/series/range</InlineCode> endpoint for durable history.
                </Note>
              </Step>
            </ol>
            <p className="max-w-[68ch]">
              Every product also has a page for humans at <InlineCode>/product/?slug=&lt;slug&gt;</InlineCode> with a chart or table, the schema, the lineage of the run that built
              it, and copyable API links
              {records ? (
                <>
                  , such as{" "}
                  <a href={productHref(records)} className={LINK}>
                    {records}
                  </a>
                </>
              ) : null}
              .
            </p>
          </Section>

          <Section id="mcp" eyebrow="AI assistants" title="Ask the data from an AI assistant">
            <p className="max-w-[68ch]">
              The API is also an <strong>MCP server</strong>, built on Cloudflare's{" "}
              <a href="https://blog.cloudflare.com/code-mode/" className={LINK}>
                Code Mode
              </a>
              . Copy its address into your MCP client, or copy the setup prompt and paste it into your assistant. No key needed.
            </p>
            <div className="flex max-w-2xl flex-wrap items-center gap-2">
              <ClipboardText size="base" text={MCP_URL} className="min-w-0 flex-1 basis-64" labels={{ copyAction: "Copy the MCP server address" }} />
              <CopyPromptButton />
            </div>
          </Section>

          <Section id="kinds" eyebrow="Shapes" title="Five kinds of product, one rule each">
            <p className="max-w-[68ch]">
              The <InlineCode>role</InlineCode> field on a product tells you how it changes and what history you get.
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-3">
              {KINDS.map((kind) => {
                const count = byRole.get(kind.role);
                return (
                  <LayerCard key={kind.role} className="h-full">
                    <LayerCard.Secondary className="flex items-center justify-between gap-2">
                      <RoleBadge role={kind.role} />
                      {count ? (
                        <a
                          href={`/catalog/?kind=${encodeURIComponent(kind.role)}`}
                          className="inline-flex items-center gap-1 text-xs text-kumo-subtle no-underline hover:text-kumo-strong"
                        >
                          {plural(count, "product")} <ArrowRightIcon size={12} />
                        </a>
                      ) : null}
                    </LayerCard.Secondary>
                    <LayerCard.Primary className="grid content-start gap-3">
                      <p className="font-mono text-[0.7rem] text-kumo-subtle">role: "{kind.role}"</p>
                      <p className="text-sm leading-relaxed text-kumo-default">{kind.text}</p>
                      <dl className="grid gap-1.5 border-t border-kumo-hairline pt-3 text-sm">
                        {kind.reads.map((read) => (
                          <div key={read.path} className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <dt className="text-kumo-subtle">{read.what}</dt>
                            <dd>
                              <InlineCode>{read.path}</InlineCode>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </LayerCard.Primary>
                  </LayerCard>
                );
              })}
            </div>
          </Section>

          <Section id="history" eyebrow="History" title="Where the past lives">
            <p className="max-w-[68ch]">
              The fast endpoints serve a rolling window: the current version of each product plus a bounded set of recent points and changes. Every meaningful revision is appended
              to a lake of Parquet tables and stays there. Typed, bounded endpoints expose it:
            </p>
            <LayerCard>
              <LayerCard.Primary className="p-0">
                <ul className="divide-y divide-kumo-hairline">
                  {HISTORY_ENDPOINTS.map((endpoint) => (
                    <li key={endpoint.path} className="grid gap-1 px-4 py-3">
                      <code className="break-all font-mono text-[0.8rem] text-kumo-strong">
                        <span className="mr-2 text-kumo-brand">GET</span>
                        {endpoint.path}
                      </code>
                      <span className="text-sm text-kumo-subtle">{endpoint.text}</span>
                    </li>
                  ))}
                </ul>
              </LayerCard.Primary>
            </LayerCard>
            <p className="max-w-[68ch]">All three use opaque compound cursors and include freshness and coverage.</p>
            <CommandBlock
              command={`curl "${API}/api/products/${seriesSlug}/series/range?from=2026-01-01T00%3A00%3A00Z&to=2027-01-01T00%3A00%3A00Z&limit=500"`}
              highlight={seriesSlug}
              label="Read a year of a time series"
            />
            <Note>Windows that ended over an hour ago are cached for a day; others for five minutes.</Note>
          </Section>

          <Section id="etiquette" eyebrow="Etiquette" title="Limits and manners">
            <LayerCard>
              <LayerCard.Primary className="p-0">
                <dl className="divide-y divide-kumo-hairline">
                  {MANNERS.map((manner) => (
                    <div key={manner.lead} className="grid gap-1 px-4 py-3.5 text-sm leading-relaxed sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-4">
                      <dt className="font-semibold text-kumo-strong">{manner.lead}</dt>
                      <dd className="text-kumo-default">{manner.body}</dd>
                    </div>
                  ))}
                </dl>
              </LayerCard.Primary>
            </LayerCard>
          </Section>

          <Section id="every-way-in" eyebrow="Machine-readable" title="Every way in">
            <LayerCard>
              <LayerCard.Primary className="p-0">
                <ul className="divide-y divide-kumo-hairline">
                  {ENTRY_POINTS.map((entry) => {
                    const url = new URL(entry.path, window.location.origin).toString();
                    return (
                      <li key={entry.path} className="grid gap-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] md:items-center md:gap-6">
                        <div className="min-w-0">
                          <p className="font-medium text-kumo-strong">{entry.title}</p>
                          <p className="text-sm text-kumo-subtle">{entry.description}</p>
                        </div>
                        <div className="flex min-w-0 items-center gap-2">
                          <ClipboardText size="base" text={url} className="min-w-0 flex-1" labels={{ copyAction: `Copy the ${entry.title} address` }} />
                          {entry.browsable === false ? null : (
                            <LinkButton href={entry.path} variant="ghost" size="sm">
                              Open
                            </LinkButton>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </LayerCard.Primary>
            </LayerCard>
          </Section>
        </div>

        <aside aria-label="On this page" className="hidden lg:sticky lg:top-24 lg:block">
          <TableOfContents>
            <TableOfContents.Title>On this page</TableOfContents.Title>
            <TableOfContents.List>
              {SECTIONS.map((section) => (
                <TableOfContents.Item key={section.id} href={`#${section.id}`} active={activeId === section.id} onClick={() => selectSection(section.id)}>
                  {section.label}
                </TableOfContents.Item>
              ))}
            </TableOfContents.List>
          </TableOfContents>
        </aside>
      </div>
    </Shell>
  );
}

mountPage(<Start />);
