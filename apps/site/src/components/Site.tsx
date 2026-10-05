import { createContext, startTransition, useEffect, useLayoutEffect, useState, type ComponentType } from "react";
import { SITE_PAGES, countPageView, pagePath, placeWindow, reloadForUpdate, useSiteLocation } from "../lib/navigation";
import { AskLauncher } from "./ask/AskLauncher";

/** Whether the agent's panel covers the page, as it does on a phone; the page is out of reach while it does. */
export const AgentModal = createContext(false);

interface Shown {
  /** The location entry and page on screen. */
  entry: number;
  page: string;
  Page: ComponentType;
  /** Counts the pages drawn; a new one is a new page, mounted afresh. */
  mount: number;
}

/**
 * The site in a tab: the page at the current address, and the agent's panel beside it. Following a
 * link to another page swaps the page and leaves the panel be, so an answer it is writing carries on.
 * The page that was showing stays until the next one has loaded; a page that cannot load (a deploy
 * has replaced its files) loads the address afresh instead.
 */
export function Site({ initial }: { initial: ComponentType }) {
  const location = useSiteLocation();
  const [shown, setShown] = useState<Shown>(() => ({ entry: location.entry, page: location.page, Page: initial, mount: 0 }));
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
    const page = SITE_PAGES.get(pagePath(location.pathname));
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
        startTransition(() => setShown((before) => ({ entry: location.entry, page: location.page, Page: module.default, mount: before.mount + 1 })));
      },
      () => {
        if (current) reloadForUpdate();
      },
    );
    return () => {
      current = false;
    };
  }, [location, shown.entry, shown.page]);

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
      <shown.Page key={shown.mount} />
      <AskLauncher onModalChange={setAgentModal} />
    </AgentModal>
  );
}
