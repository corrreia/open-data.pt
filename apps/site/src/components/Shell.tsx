import { Button } from "@cloudflare/kumo";
import { GithubLogoIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { REPOSITORY } from "../lib/project";
import { Mark } from "./Mark";
import { SearchPalette } from "./SearchPalette";

export type Section = "home" | "catalog" | "publishers" | "licences" | "status" | "analytics" | "start" | "operations" | "product" | "contribute";

const NAV: { section: Section | "api"; href: string; label: string }[] = [
  { section: "catalog", href: "/catalog/", label: "Catalog" },
  { section: "publishers", href: "/publisher/", label: "Publishers" },
  { section: "licences", href: "/licence/", label: "Licences" },
  { section: "status", href: "/status/", label: "Status" },
  { section: "start", href: "/start/", label: "Start here" },
  { section: "api", href: "/docs", label: "API" },
  { section: "contribute", href: "/contribute/", label: "Contribute" },
];

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

  return (
    <div className="flex min-h-screen flex-col">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-kumo-line bg-[color-mix(in_srgb,var(--color-kumo-canvas)_88%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:px-6">
          <a href="/" className="flex items-center gap-2.5 rounded-lg text-kumo-strong no-underline" aria-label="open-data.pt home">
            <Mark size={32} />
            <span className="font-display text-lg">open-data.pt</span>
          </a>
          <div className="ml-auto flex items-center gap-1.5 sm:order-last">
            <Button variant="secondary" icon={<MagnifyingGlassIcon />} onClick={() => setSearching(true)} aria-label="Search datasets and publishers">
              <span className="hidden sm:inline">Search</span>
              <kbd className="ml-1 hidden rounded border border-kumo-line bg-kumo-recessed px-1.5 font-mono text-[0.65rem] text-kumo-subtle md:inline">⌘K</kbd>
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
          <nav aria-label="Primary" className="-mx-1 flex basis-full flex-wrap items-center gap-0.5 sm:ml-auto sm:basis-auto">
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
          <span className="flex flex-wrap gap-x-3 gap-y-1">
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

      <SearchPalette open={searching} onOpenChange={setSearching} />
    </div>
  );
}
