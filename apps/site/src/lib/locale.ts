/**
 * The page's language. English pages are where they always were; each one in European Portuguese
 * is the same page under /pt/ (/pt/catalog/?topic=energy), which the kernel serves from the same
 * build with `lang="pt-PT"`. Every navigation loads a page, so the language is read once, from the
 * address, and never changes while the page is open.
 */
export type Locale = "en" | "pt";

const PORTUGUESE_PATH = /^\/pt(?=\/|$)/;

const path = "location" in globalThis ? globalThis.location.pathname : "/";

export const LOCALE: Locale = PORTUGUESE_PATH.test(path) ? "pt" : "en";

/**
 * The locale numbers and dates are written in. A Portuguese page writes them as Portugal does; an
 * English one as the reader's English does, or as British English for a reader whose browser is set
 * to another language, since the page's words are English either way.
 */
export const INTL_LOCALE = LOCALE === "pt" ? "pt-PT" : englishLocale();

function englishLocale() {
  const languages = "navigator" in globalThis ? globalThis.navigator.languages : [];
  return languages.find((language) => /^en(-|$)/i.test(language)) ?? "en-GB";
}

/** What `lang` says each language is, for the links that offer the other one. */
export const LANGUAGE_TAG = { en: "en", pt: "pt-PT" } satisfies { [locale in Locale]: string };

/**
 * The words for this page's language. Each part of the site keeps its English and its Portuguese
 * side by side, and the Portuguese has to say everything the English does: a missing key, or a
 * phrase that takes a count in one language and not in the other, fails the type check.
 */
export function inLocale<T>(text: { en: T; pt: NoInfer<T> }): T {
  return text[LOCALE];
}

/** The site's own pages, the first part of their path: everything else (/docs, /api, /llms.txt) has one language. */
const PAGES = new Set(["catalog", "publisher", "licence", "product", "start", "status", "analytics", "operations", "contribute", "aup"]);

/** Whether a path is one of the site's pages, the home page included. */
function isSitePage(pathname: string) {
  if (pathname === "/" || pathname === "/index.html") return true;
  return PAGES.has(pathname.split("/")[1] ?? "");
}

/**
 * A link to one of the site's pages, in the language of this one: on a Portuguese page, "/catalog/"
 * is "/pt/catalog/". Anything else, and every address on another site, is left as it is.
 */
export function localHref(href: string): string {
  if (LOCALE === "en" || !href.startsWith("/") || href.startsWith("//")) return href;
  const url = new URL(href, "https://open-data.pt");
  return isSitePage(url.pathname) ? `/pt${href}` : href;
}

/** This page in the other language: the same address, query and fragment, with /pt/ added or taken off. */
export function otherLanguageHref(location: Pick<Location, "pathname" | "search" | "hash">): string {
  const { pathname, search, hash } = location;
  const english = pathname.replace(PORTUGUESE_PATH, "") || "/";
  const target = LOCALE === "pt" ? english : `/pt${english}`;
  return `${target}${search}${hash}`;
}
