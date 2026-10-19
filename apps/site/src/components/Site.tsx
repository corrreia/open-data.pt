import { createContext, startTransition, useEffect, useLayoutEffect, useState, type ComponentType } from "react";
import { pagePath } from "@open-data-pt/api";
import { SITE_PAGES, countPageView, placeWindow, preloadPages, reloadForUpdate, useSiteLocation } from "../lib/navigation";
import { AskLauncher } from "./ask/AskLauncher";
import { Shell } from "./Shell";

/** How long after the first page draws the other pages start loading, so they never compete with it. */
const PRELOAD_DELAY_MS = 2000;

/** Whether the agent's panel covers the page, as it does on a phone; the page is out of reach while it does. */
export const AgentModal = createContext(false);

interface Shown {
  /** The location entry and page on screen. */
  entry: number;
  page: string;
  /** The page's path, which names its section of the header. */
  path: string;
  Page: ComponentType;
  /** Counts the pages drawn; a new one is a new page, mounted afresh. */
  mount: number;
}

/**
 * The site in a tab: the header and footer, the page at the current address between them, and the
 * agent's panel beside it. Following a link to another page swaps only the page, so the header stays
 * put and an answer the panel is writing carries on.
 * The page that was showing stays until the next one has loaded; a page that cannot load (a deploy
 * has replaced its files) loads the address afresh instead.
 */
export function Site({ initial }: { initial: ComponentType }) {
  const location = useSiteLocation();
  const [shown, setShown] = useState<Shown>(() => ({ entry: location.entry, page: location.page, path: pagePath(location.pathname), Page: initial, mount: 0 }));
  const [agentModal, setAgentModal] = useState(false);

  useEffect(() => {
    if (location.entry === shown.entry && location.page === shown.page) return;
    // A link always opens its page anew, the current one too; the back and forward buttons do when they lead to
    // another page, and only move the window between sections of the same one. A page rewriting its own address stays.
    const opens = location.arrival === "link" || (location.arrival === "history" && location.page !== shown.page);
    if (!opens) {
      setShown((before) => ({ ...before, entry: location.entry, page: location.page }));
      if (location.arrival === "history") placeWindow(location);
      return;
    }
    const path = pagePath(location.pathname);
    const page = SITE_PAGES.get(path);
    if (!page) {
      window.location.reload();
      return;
    }
    let current = true;
    page.load().then(
      (module) => {
        if (!current) return;
        // Before the page draws, so a page that names what it shows can set its own title over this one.
        document.title = page.title;
        startTransition(() => setShown((before) => ({ entry: location.entry, page: location.page, path, Page: module.default, mount: before.mount + 1 })));
      },
      () => {
        if (current) reloadForUpdate();
      },
    );
    return () => {
      current = false;
    };
  }, [location, shown.entry, shown.page]);

  // A moment after the first page has drawn, the others load too: a link then opens its page at once, even after
  // a deploy has replaced the files this tab would otherwise fetch. (Safari has no requestIdleCallback.)
  useEffect(() => {
    const timer = window.setTimeout(preloadPages, PRELOAD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Once a new page has drawn: the window where it belongs, focus at the start of the page, and the visit counted.
  useLayoutEffect(() => {
    if (shown.mount === 0) return;
    placeWindow(location);
    if (location.arrival === "link") document.getElementById("content")?.focus({ preventScroll: true });
    countPageView();
    // Only when a page is drawn anew, not when the address changes under the same one.
  }, [shown.mount]);

  return (
    <AgentModal value={agentModal}>
      <Shell section={SITE_PAGES.get(shown.path)?.section ?? "home"}>
        <shown.Page key={shown.mount} />
      </Shell>
      <AskLauncher drawn={shown.mount} onModalChange={setAgentModal} />
    </AgentModal>
  );
}
