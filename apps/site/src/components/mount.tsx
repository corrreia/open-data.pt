import { TooltipProvider } from "@cloudflare/kumo";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { registerSiteTools } from "../lib/webmcp";
import "../styles.css";

// Every page offers the same tools to an agent in the browser.
registerSiteTools();

// Kumo's tokens follow data-mode; the head script sets it once, and this keeps it in step when the system theme changes.
// Transitions are off for the frame the mode flips in, so the page changes colour at once instead of fading hundreds of elements.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
darkQuery.addEventListener("change", () => {
  const root = document.documentElement;
  root.classList.add("mode-switching");
  root.dataset.mode = darkQuery.matches ? "dark" : "light";
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("mode-switching")));
});

// A deploy replaces the on-demand view files; a page opened before it cannot fetch the old ones.
// Reload once to pick up the new build; the flag stops a loop if the file is missing for another reason.
window.addEventListener("vite:preloadError", (event) => {
  try {
    if (sessionStorage.getItem("reloaded-for-update") === window.location.href) return;
    sessionStorage.setItem("reloaded-for-update", window.location.href);
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});

/** Render a page into the entry's root element. */
export function mountPage(page: ReactNode) {
  const root = document.getElementById("root");
  if (!root) throw new Error("The page has no #root element");
  createRoot(root).render(
    <StrictMode>
      <TooltipProvider delay={250}>{page}</TooltipProvider>
    </StrictMode>,
  );
}
