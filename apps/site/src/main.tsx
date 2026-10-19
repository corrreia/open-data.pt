import { pagePath } from "@open-data-pt/api";
import { startSite } from "./components/mount";
import { SITE_PAGES } from "./lib/navigation";

// The kernel serves this shell only at the site's pages, so the address always names one; the home page stands in for anything else.
const page = SITE_PAGES.get(pagePath(window.location.pathname)) ?? SITE_PAGES.get("/");
if (!page) throw new Error("The site has no home page");
startSite(page.load);
