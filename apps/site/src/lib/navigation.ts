/**
 * Moving between the site's pages without loading a new one. Every page is still its own HTML file,
 * which is what a crawler, a link preview or a fresh tab reads; once a page is open, following a link
 * to another of the site's pages swaps the page in place, so what lives beside the pages — the agent's
 * panel and an answer it is still writing, the cached API reads — carries on.
 *
 * A link is followed in place only when a plain click would have loaded another of the site's pages
 * in this tab. A click with a modifier key, a link to a new tab, a download, a link to a section of
 * the same page, and every address outside the site's pages (/docs, /api/…, another site) are the
 * browser's, as they always were.
 */
import { PAGE_VIEW_HEADER } from "@open-data-pt/api";
import { useSyncExternalStore, type ComponentType } from "react";

export interface PageModule {
  default: ComponentType;
}

interface SitePage {
  /** The document title the page's file carries; a page that names what it shows sets its own once it knows. */
  title: string;
  load: () => Promise<PageModule>;
}

/** The site's pages by path, each loaded the first time someone goes to it. */
export const SITE_PAGES = new Map<string, SitePage>([
  ["/", { title: "open-data.pt", load: () => import("../pages/home") }],
  ["/catalog/", { title: "Catalog · open-data.pt", load: () => import("../pages/catalog") }],
  ["/publisher/", { title: "Publishers · open-data.pt", load: () => import("../pages/publisher") }],
  ["/licence/", { title: "Licences · open-data.pt", load: () => import("../pages/licence") }],
  ["/product/", { title: "Dataset · open-data.pt", load: () => import("../pages/product") }],
  ["/start/", { title: "Start here · open-data.pt", load: () => import("../pages/start") }],
  ["/status/", { title: "Status · open-data.pt", load: () => import("../pages/status") }],
  ["/analytics/", { title: "Analytics · open-data.pt", load: () => import("../pages/analytics") }],
  ["/operations/", { title: "Operations · open-data.pt", load: () => import("../pages/operations") }],
  ["/contribute/", { title: "Contribute · open-data.pt", load: () => import("../pages/contribute") }],
  ["/aup/", { title: "Acceptable use · open-data.pt", load: () => import("../pages/aup") }],
]);

/** "/catalog/index.html" is the same page as "/catalog/". */
export const pagePath = (pathname: string) => pathname.replace(/index\.html$/, "");

/** The site page an address opens, or undefined for an address that is not one of them. */
export function sitePageOf(url: URL, origin: string): string | undefined {
  if (url.origin !== origin) return undefined;
  const path = pagePath(url.pathname);
  return SITE_PAGES.has(path) ? path : undefined;
}

/* ---------- Where the tab is ---------- */

/**
 * How the tab reached the address it is at: its first load, a link, the back and forward buttons, or
 * the page rewriting its own address (a filter, a tab) without becoming another page.
 */
export type Arrival = "load" | "link" | "history" | "replace";

export interface SiteLocation {
  pathname: string;
  search: string;
  hash: string;
  /** One page: the same path and query is the same page, whatever its fragment. */
  page: string;
  arrival: Arrival;
  /** Counts the links followed and the history entries visited, so following a link to this very page still opens it anew. */
  entry: number;
  /** Where the window was scrolled when the visitor last left this entry, for the back and forward buttons. */
  scroll: number;
}

interface EntryState {
  scroll?: number;
}

/** What this site keeps in a history entry; anything else there is someone else's. */
function entryState(state: EntryState | null): EntryState {
  return state !== null && Number.isFinite(state.scroll) ? state : {};
}

let entries = 0;

function read(arrival: Arrival): SiteLocation {
  const { pathname, search, hash } = window.location;
  // SAFETY: entries are written by this module, or by the browser as null.
  const scroll = entryState(window.history.state as EntryState | null).scroll ?? 0;
  if (arrival === "link" || arrival === "history") entries += 1;
  return { pathname, search, hash, page: `${pagePath(pathname)}${search}`, arrival, scroll, entry: entries };
}

const listeners = new Set<() => void>();
let current: SiteLocation | undefined;

function settle(arrival: Arrival) {
  current = read(arrival);
  for (const listener of listeners) listener();
}

function locationNow(): SiteLocation {
  current ??= read("load");
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The address the tab is at, which changes without a new page loading. */
export const useSiteLocation = () => useSyncExternalStore(subscribe, locationNow);

/** Remembers how far down this entry was read, so coming back to it returns there. */
function keepScroll() {
  window.history.replaceState({ ...window.history.state, scroll: window.scrollY }, "");
}

/**
 * Goes to an address: one of the site's pages in place, anything else as a normal page load.
 * `replace` takes the current history entry's place, as for a redirect.
 */
export function navigate(href: string, replace = false) {
  const url = new URL(href, window.location.href);
  if (!sitePageOf(url, window.location.origin)) {
    window.location.assign(url.href);
    return;
  }
  keepScroll();
  if (replace) window.history.replaceState({ scroll: 0 }, "", url.href);
  else window.history.pushState({ scroll: 0 }, "", url.href);
  settle("link");
}

/**
 * Rewrites this page's own address, as a filter or a tab does, without a new history entry and
 * without opening the page anew; the back button and a shared link then find it as it was left.
 */
export function replaceAddress(href: string) {
  window.history.replaceState(window.history.state, "", href);
  settle("replace");
}

/** Whether a click on a link is one the browser would follow by loading another page in this tab. */
function followsInPlace(event: MouseEvent, link: HTMLAnchorElement): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return false;
  const url = new URL(link.href);
  if (!sitePageOf(url, window.location.origin)) return false;
  // A link to a section of this same page only scrolls, as it always has.
  return !(url.pathname === window.location.pathname && url.search === window.location.search && url.hash);
}

let started = false;

/** Starts following the site's links in place. Once per tab; the address bar, back and forward keep working. */
export function startNavigation() {
  if (started) return;
  started = true;
  // The site puts the window where it belongs once a page has drawn; the browser would do it too early.
  window.history.scrollRestoration = "manual";
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link || !followsInPlace(event, link)) return;
    event.preventDefault();
    navigate(link.href);
  });
  window.addEventListener("popstate", () => settle("history"));
  // Leaving the site, or reloading, the entry keeps where the visitor was.
  window.addEventListener("pagehide", keepScroll);
}

/**
 * Loads this address afresh, once: a deploy replaces the site's files, and a tab opened before it
 * cannot fetch the old ones. Returns false when it already tried for this address, so a file missing
 * for another reason does not reload the tab forever.
 */
export function reloadForUpdate(): boolean {
  try {
    if (sessionStorage.getItem("reloaded-for-update") === window.location.href) return false;
    sessionStorage.setItem("reloaded-for-update", window.location.href);
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/* ---------- Arriving ---------- */

/** How long a page is given to grow tall enough for the place it is scrolled to. */
const SCROLL_PATIENCE_MS = 1500;

/**
 * Puts the window where the visitor expects it on a page that has just drawn: at the section a link
 * names, back where they were with the back and forward buttons, or at the top. Pages draw what they
 * read as it arrives, so this tries again for a moment until the page is tall enough or the section
 * exists, and stops as soon as the visitor scrolls on their own.
 */
export function placeWindow(location: SiteLocation) {
  // Back where the visitor was with the back and forward buttons; at the section a link names, or the top, otherwise.
  const returning = location.arrival === "history";
  const section = !returning && location.hash ? decodeURIComponent(location.hash.slice(1)) : "";
  const target = returning ? location.scroll : 0;
  const deadline = Date.now() + SCROLL_PATIENCE_MS;
  let moved = false;
  const stop = () => {
    moved = true;
  };
  window.addEventListener("wheel", stop, { once: true, passive: true });
  window.addEventListener("touchmove", stop, { once: true, passive: true });
  window.addEventListener("keydown", stop, { once: true });
  const attempt = () => {
    if (moved) return;
    const element = section ? document.getElementById(section) : null;
    if (element) element.scrollIntoView({ block: "start" });
    else window.scrollTo(0, section ? 0 : target);
    const placed = section ? element !== null : Math.abs(window.scrollY - target) < 2;
    if (!placed && Date.now() < deadline) requestAnimationFrame(attempt);
  };
  attempt();
}

/**
 * Counts a page shown in place as the visit it is. The kernel counts page views as it serves a
 * page's file and leaves the site's own reads of the API out; this asks for the page's headers only,
 * marked as a page view, so a visit counts the same however the visitor got there.
 */
export function countPageView() {
  void fetch(window.location.href, { method: "HEAD", headers: { [PAGE_VIEW_HEADER]: "1" }, keepalive: true }).catch(() => undefined);
}
