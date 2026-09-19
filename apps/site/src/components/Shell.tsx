import { Button, Sidebar } from "@cloudflare/kumo";
import {
  BookOpenIcon,
  BuildingsIcon,
  CompassIcon,
  GithubLogoIcon,
  HandHeartIcon,
  HeartbeatIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PlugsConnectedIcon,
  ScalesIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { fetchFeeds, fetchProducts } from "../lib/catalog";
import { REPOSITORY } from "../lib/project";
import { prefetch } from "../lib/query";
import { Mark } from "./Mark";
import { SearchPalette } from "./SearchPalette";

export type Section = "home" | "catalog" | "publishers" | "licences" | "status" | "analytics" | "start" | "operations" | "product" | "contribute";

/** The icons are for the phone drawer, where each destination gets a row of its own. */
const NAV: { section: Section | "api"; href: string; label: string; icon: Icon }[] = [
  { section: "catalog", href: "/catalog/", label: "Catalog", icon: CompassIcon },
  { section: "publishers", href: "/publisher/", label: "Publishers", icon: BuildingsIcon },
  { section: "licences", href: "/licence/", label: "Licences", icon: ScalesIcon },
  { section: "status", href: "/status/", label: "Status", icon: HeartbeatIcon },
  { section: "start", href: "/start/", label: "Start here", icon: BookOpenIcon },
  { section: "api", href: "/docs", label: "API", icon: PlugsConnectedIcon },
  { section: "contribute", href: "/contribute/", label: "Contribute", icon: HandHeartIcon },
];

/** Phones: the same destinations as a drawer, so seven links do not wrap into two ragged rows. */
function NavDrawer({ current }: { current: Section | "api" }) {
  return (
    <div className="md:hidden">
      <Sidebar fullScreenOnMobile>
        <Sidebar.Header>
          <Mark size={24} />
          <span className="font-display text-base">open-data.pt</span>
          <Sidebar.Close className="ml-auto" />
        </Sidebar.Header>
        <Sidebar.Content>
          <Sidebar.Menu>
            {NAV.map((item) => (
              <Sidebar.MenuButton key={item.href} href={item.href} icon={item.icon} active={item.section === current}>
                {item.label}
              </Sidebar.MenuButton>
            ))}
          </Sidebar.Menu>
        </Sidebar.Content>
      </Sidebar>
    </div>
  );
}

function isTypingIn(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function Shell({ section, children }: { section: Section; children: ReactNode }) {
  const [searching, setSearching] = useState(false);

  // ⌘K or Ctrl+K anywhere, or "/" outside a text field, opens the search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearching(true);
      } else if (event.key === "/" && !isTypingIn(event.target)) {
        event.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = section === "product" ? "catalog" : section === "operations" ? "status" : section;
  // The palette's data starts loading when the pointer or focus reaches the Search button, so it opens ready.
  const warm = () => {
    prefetch("products", fetchProducts);
    prefetch("feeds", fetchFeeds);
  };

  return (
    <Sidebar.Provider collapsible="offcanvas" mobileBreakpoint={768} defaultOpen={false}>
      {/*
       * `isolate` keeps the header's z-index inside the page, so dialogs and the palette, which Kumo
       * portals to the end of <body>, always paint above it. While the palette is open the page
       * behind it is inert: Tab stays in the palette and screen readers read only the palette.
       */}
      <div className="isolate flex min-h-screen flex-col" inert={searching}>
        <a className="skip-link" href="#content">
          Skip to content
        </a>
        {/* Sticky from md up; on phones the two-row header scrolls away instead of covering a third of the screen. */}
        <header className="relative z-40 border-b md:sticky md:top-0 border-kumo-line bg-[color-mix(in_srgb,var(--color-kumo-canvas)_88%,transparent)] backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:px-6">
            <Sidebar.Trigger className="md:hidden" aria-label="Open the menu">
              <ListIcon size={20} aria-hidden="true" />
            </Sidebar.Trigger>
            <a href="/" className="flex items-center gap-2.5 rounded-lg text-kumo-strong no-underline" aria-label="open-data.pt home">
              <Mark size={32} />
              <span className="font-display text-lg">open-data.pt</span>
            </a>
            <div className="ml-auto flex items-center gap-1.5 sm:order-last">
              <Button
                variant="secondary"
                icon={<MagnifyingGlassIcon />}
                onClick={() => setSearching(true)}
                onPointerEnter={warm}
                onFocus={warm}
                aria-label="Search datasets, publishers and pages"
                aria-keyshortcuts="Control+K Meta+K /"
              >
                <span className="hidden sm:inline">Search</span>
                <kbd className="ml-1 hidden rounded border border-kumo-line bg-kumo-recessed px-1.5 font-mono text-xs text-kumo-subtle md:inline">⌘K</kbd>
              </Button>
              <a
                href={REPOSITORY}
                aria-label="open-data.pt on GitHub"
                title="Source code on GitHub"
                className="grid size-9 place-items-center rounded-lg text-kumo-subtle no-underline transition-colors hover:bg-kumo-tint hover:text-kumo-strong"
              >
                <GithubLogoIcon size={20} aria-hidden="true" />
              </a>
            </div>
            {/* Wide screens carry the destinations in the header; phones open them in the drawer. */}
            <nav aria-label="Primary" className="-mx-1 hidden basis-full flex-wrap items-center gap-0.5 md:ml-auto md:flex md:basis-auto">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  aria-current={item.section === current ? "page" : undefined}
                  className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium text-kumo-subtle no-underline transition-colors hover:bg-kumo-tint hover:text-kumo-strong aria-[current=page]:bg-kumo-tint aria-[current=page]:text-kumo-strong"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </header>

        <main id="content" className="mx-auto grid w-full min-w-0 max-w-7xl flex-1 grid-cols-[minmax(0,1fr)] content-start gap-14 px-4 pb-24 pt-6 sm:px-6">
          {children}
        </main>

        <footer className="border-t border-kumo-line">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap justify-between gap-x-6 gap-y-2 px-4 py-6 text-xs text-kumo-subtle sm:px-6">
            <span>open-data.pt · data from its publishers, under their licences</span>
            <span className="flex flex-wrap gap-x-4 gap-y-1 [&>a]:inline-flex [&>a]:min-h-6 [&>a]:items-center">
              <a className="text-kumo-subtle hover:text-kumo-strong" href="/contribute/">
                Contribute
              </a>
              <a className="text-kumo-subtle hover:text-kumo-strong" href={REPOSITORY}>
                Source code
              </a>
              <a className="text-kumo-subtle hover:text-kumo-strong" href="/status/">
                Status
              </a>
              <a className="text-kumo-subtle hover:text-kumo-strong" href="/operations/">
                Operations
              </a>
              <a className="text-kumo-subtle hover:text-kumo-strong" href="/analytics/">
                Analytics
              </a>
              <a className="text-kumo-subtle hover:text-kumo-strong" href="/docs">
                API reference
              </a>
              <a className="text-kumo-subtle hover:text-kumo-strong" href="/openapi.json">
                OpenAPI 3.1
              </a>
              <a className="text-kumo-subtle hover:text-kumo-strong" href="/start/#mcp">
                MCP server
              </a>
              <a className="text-kumo-subtle hover:text-kumo-strong" href="/llms.txt">
                llms.txt
              </a>
              <a className="text-kumo-subtle hover:text-kumo-strong" href="/api/catalog.dcat.json">
                DCAT catalog
              </a>
            </span>
          </div>
        </footer>
      </div>
      <NavDrawer current={current} />
      <SearchPalette open={searching} onOpenChange={setSearching} />
    </Sidebar.Provider>
  );
}
