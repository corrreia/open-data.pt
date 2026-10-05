import { Button, ClipboardText, LayerCard, LinkButton, TableOfContents, useTableOfContentsActiveId } from "@cloudflare/kumo";
import { ArrowRightIcon, BracketsCurlyIcon, CheckIcon, CopyIcon, GiftIcon, KeyIcon, SealCheckIcon } from "@phosphor-icons/react";
import { useMemo, type ReactNode } from "react";
import { PageHead, RoleBadge, SectionHead, bodyRows, cardRows } from "../components/common";
import { mountPage } from "../components/mount";
import { CommandBlock, useCopy } from "../components/ops/CommandBlock";
import { useHashLanding } from "../components/ops/useHashLanding";
import { Shell } from "../components/Shell";
import { productHref } from "../lib/api";
import { ROLE, fetchProducts } from "../lib/catalog";
import { fmt } from "../lib/format";
import { localHref } from "../lib/locale";
import { useQuery } from "../lib/query";
import type { Product, Role } from "../lib/types";
import { START, type StartPieces } from "../text/start";

const API = "https://open-data.pt";
const MCP_URL = `${API}/mcp`;
const LINK = "font-medium text-kumo-link hover:underline";

const MCP_SETUP_PROMPT = START.setupPrompt(MCP_URL);
function InlineCode({ children }: { children: ReactNode }) {
  return <code className="rounded bg-kumo-recessed px-1 py-0.5 font-mono text-[0.85em] text-kumo-strong">{children}</code>;
}

/** The markup the page's prose is written around: inline code, and links, kept in this page's language. */
const PIECES: StartPieces = {
  code: (text) => <InlineCode>{text}</InlineCode>,
  link: (href, text) => (
    <a href={localHref(href)} className={LINK}>
      {text}
    </a>
  ),
};

/* ---------- Content ---------- */

interface PageSection {
  id: string;
  label: string;
}

const SECTIONS: PageSection[] = [
  { id: "three-requests", label: START.sections.threeRequests },
  { id: "mcp", label: START.sections.mcp },
  { id: "kinds", label: START.sections.kinds },
  { id: "history", label: START.sections.history },
  { id: "etiquette", label: START.sections.etiquette },
  { id: "every-way-in", label: START.sections.everyWayIn },
];

interface Pledge {
  icon: ReactNode;
  lead: string;
  body: ReactNode;
}

const PLEDGES: Pledge[] = [
  { icon: <GiftIcon size={20} />, lead: START.pledges.free.lead, body: START.pledges.free.body(PIECES) },
  { icon: <KeyIcon size={20} />, lead: START.pledges.noKey.lead, body: START.pledges.noKey.body(PIECES) },
  { icon: <SealCheckIcon size={20} />, lead: START.pledges.credited.lead, body: START.pledges.credited.body(PIECES) },
  { icon: <BracketsCurlyIcon size={20} />, lead: START.pledges.machine.lead, body: START.pledges.machine.body(PIECES) },
];

interface ReadHint {
  what: string;
  path: string;
}

interface KindGuide {
  role: Role;
  reads: ReadHint[];
}

const KINDS: KindGuide[] = [
  {
    role: "reference",
    reads: [{ what: START.reads.records, path: "/records" }],
  },
  { role: "current-state", reads: [{ what: START.reads.records, path: "/records" }] },
  {
    role: "event-log",
    reads: [
      { what: START.reads.currentRecords, path: "/records" },
      { what: START.reads.applicableHistory, path: "/events" },
      { what: START.reads.durableRevisions, path: "/changes/range" },
    ],
  },
  {
    role: "time-series",
    reads: [
      { what: START.reads.hotWindow, path: "/series" },
      { what: START.reads.durableRanges, path: "/series/range" },
    ],
  },
  { role: "summary", reads: [{ what: START.reads.records, path: "/records" }] },
];

interface HistoryEndpoint {
  path: string;
  text: string;
}

const HISTORY_ENDPOINTS: HistoryEndpoint[] = [
  { path: "/api/products/{slug}/events?from=<ISO>&to=<ISO>", text: START.history.events },
  { path: "/api/products/{slug}/changes/range?from=<ISO>&to=<ISO>", text: START.history.changes },
  { path: "/api/products/{slug}/series/range?from=<ISO>&to=<ISO>", text: START.history.series },
];

interface Manner {
  lead: string;
  body: ReactNode;
}

const MANNERS: Manner[] = START.manners.map((manner) => ({ lead: manner.lead, body: manner.body(PIECES) }));

interface EntryPoint {
  title: string;
  path: string;
  description: string;
  /** False for an address only a program can use, which a browser would not show. */
  browsable?: boolean;
}

const ENTRY_POINTS: EntryPoint[] = [
  { ...START.entryPoints.products, path: "/api/products" },
  { ...START.entryPoints.mcp, path: "/mcp", browsable: false },
  { ...START.entryPoints.openapi, path: "/openapi.json" },
  { ...START.entryPoints.llms, path: "/llms.txt" },
  { ...START.entryPoints.dcat, path: "/api/catalog.dcat.json" },
  { ...START.entryPoints.feeds, path: "/api/feeds" },
  { ...START.entryPoints.health, path: "/api/health" },
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
        {/* The list already says which step this is, so the number is only drawn, not read twice. */}
        <h3 className="pt-1 font-medium text-kumo-strong">{title}</h3>
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
        {copied ? START.copied : START.copyPrompt}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? START.promptCopied : ""}
      </span>
    </>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-kumo-subtle">{children}</p>;
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`}>
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
          eyebrow={START.eyebrow}
          title={START.title((text) => (
            <em className="text-kumo-brand">{text}</em>
          ))}
        >
          {START.intro}
        </PageHead>
        <ul aria-label={START.pledgesLabel} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLEDGES.map((pledge) => (
            <li key={pledge.lead} className="grid">
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
          <Section id="three-requests" eyebrow={START.threeRequestsEyebrow} title={START.threeRequestsTitle}>
            <p className="max-w-[36rem]">{START.productIntro(PIECES)}</p>
            <ol className="grid gap-8">
              <Step n={1} title={START.listProducts}>
                <CommandBlock command={`curl ${API}/api/products`} label={START.listProducts} />
                <Note>{START.listNote(list ? fmt.int(list.length) : undefined)}</Note>
              </Step>
              <Step n={2} title={START.readRecords}>
                <CommandBlock command={`curl "${API}/api/products/${recordsSlug}/records?limit=100"`} highlight={recordsSlug} label={START.readRecords} />
                <Note>{START.recordsNote(PIECES)}</Note>
              </Step>
              <Step n={3} title={START.readSeries}>
                <CommandBlock command={`curl "${API}/api/products/${seriesSlug}/series?limit=500"`} highlight={seriesSlug} label={START.readSeries} />
                <Note>{START.seriesNote(PIECES)}</Note>
              </Step>
            </ol>
            <p className="max-w-[36rem]">
              {START.productPage(
                PIECES,
                records ? (
                  <a href={productHref(records)} className={LINK}>
                    {records}
                  </a>
                ) : null,
              )}
            </p>
          </Section>

          <Section id="mcp" eyebrow={START.mcpEyebrow} title={START.mcpTitle}>
            <p className="max-w-[36rem]">{START.mcpIntro(PIECES)}</p>
            <div className="flex max-w-2xl flex-wrap items-center gap-2">
              <ClipboardText size="base" text={MCP_URL} className="min-w-0 flex-1 basis-64" labels={{ copyAction: START.copyMcpAddress }} />
              <CopyPromptButton />
            </div>
          </Section>

          <Section id="kinds" eyebrow={START.kindsEyebrow} title={START.kindsTitle}>
            <p className="max-w-[36rem]">{START.kindsIntro(PIECES)}</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-3">
              {KINDS.map((kind) => {
                const count = byRole.get(kind.role);
                return (
                  <LayerCard key={kind.role} className={cardRows(4)}>
                    <LayerCard.Secondary className="flex items-center justify-between gap-2">
                      <RoleBadge role={kind.role} />
                      {count ? (
                        <a
                          href={localHref(`/catalog/?kind=${encodeURIComponent(kind.role)}`)}
                          className="inline-flex items-center gap-1 text-xs text-kumo-subtle no-underline hover:text-kumo-strong"
                        >
                          {START.products(count)} <ArrowRightIcon size={12} />
                        </a>
                      ) : null}
                    </LayerCard.Secondary>
                    <LayerCard.Primary className={`gap-3 ${bodyRows(3)}`}>
                      <p className="font-mono text-xs text-kumo-subtle">role: "{kind.role}"</p>
                      <p className="text-sm leading-relaxed text-kumo-default">{ROLE[kind.role].description}</p>
                      <dl className="grid content-start gap-1.5 border-t border-kumo-hairline pt-3 text-sm">
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

          <Section id="history" eyebrow={START.historyEyebrow} title={START.historyTitle}>
            <p className="max-w-[36rem]">{START.historyIntro}</p>
            <LayerCard>
              <LayerCard.Primary className="p-0">
                <ul className="divide-y divide-kumo-hairline">
                  {HISTORY_ENDPOINTS.map((endpoint) => (
                    <li key={endpoint.path} className="grid gap-1 px-4 py-3">
                      <code className="wrap-anywhere font-mono text-sm text-kumo-strong">
                        <span className="mr-2 text-kumo-brand">GET</span>
                        {endpoint.path}
                      </code>
                      <span className="text-sm text-kumo-subtle">{endpoint.text}</span>
                    </li>
                  ))}
                </ul>
              </LayerCard.Primary>
            </LayerCard>
            <p className="max-w-[36rem]">{START.historyCursors}</p>
            <CommandBlock
              command={`curl "${API}/api/products/${seriesSlug}/series/range?from=2026-01-01T00%3A00%3A00Z&to=2027-01-01T00%3A00%3A00Z&limit=500"`}
              highlight={seriesSlug}
              label={START.readYear}
            />
            <Note>{START.historyCache}</Note>
          </Section>

          <Section id="etiquette" eyebrow={START.etiquetteEyebrow} title={START.etiquetteTitle}>
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

          <Section id="every-way-in" eyebrow={START.everyWayInEyebrow} title={START.everyWayInTitle}>
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
                          <ClipboardText size="base" text={url} className="min-w-0 flex-1" labels={{ copyAction: START.copyAddress(entry.title) }} />
                          {entry.browsable === false ? null : (
                            <LinkButton href={entry.path} variant="ghost" size="sm">
                              {START.open}
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

        <aside aria-label={START.onThisPage} className="hidden lg:sticky lg:top-24 lg:block">
          <TableOfContents>
            <TableOfContents.Title>{START.onThisPage}</TableOfContents.Title>
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
