import { Loader } from "@cloudflare/kumo";
import { ChatsCircleIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSiteLocation } from "../../lib/navigation";

// The agent in the corner of every page. This part is all every page loads: whether the agent is on
// here, and a button. The panel, the model's sandbox and the MCP server load when it first opens, and
// stay loaded: closing the panel docks it, so an answer in progress carries on and the button says so.

const AskPanel = lazy(() => import("./AskPanel"));

/** Kept for this tab only: whether the agent is on here, and whether its panel was open on the last page. */
const ENABLED_KEY = "ask-enabled";
const OPEN_KEY = "ask-open";

function readKey(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Without storage the panel only forgets it was open when the page changes.
  }
}

/** The gap kept between the corner button and the footer once the footer scrolls into view. */
const FOOTER_GAP_PX = 12;

/**
 * How far the site's footer reaches up into the window, in pixels: 0 until it scrolls into view.
 * The corner button rises by as much, so it sits just above the footer instead of over its links.
 * Each page draws a footer of its own, so it is found again whenever the page changes.
 */
function useFooterRise(page: string): number {
  const [rise, setRise] = useState(0);
  useEffect(() => {
    const footer = document.getElementById("site-footer");
    if (!footer) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setRise(Math.max(0, Math.round(window.innerHeight - footer.getBoundingClientRect().top)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    // Pages that load their content after the first paint move the footer without any scrolling.
    const resized = new ResizeObserver(schedule);
    resized.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      resized.disconnect();
    };
  }, [page]);
  return rise;
}

/** Why sign-in came back without a session, when the callback says so in the address's fragment. */
function signInFailure(): string | undefined {
  return /^#ask-signin=(\w+)$/.exec(window.location.hash)?.[1];
}

/** Told when the open panel fills a phone's screen, so the Shell can take the page behind it out of reach. */
export function AskLauncher({ onModalChange }: { onModalChange: (modal: boolean) => void }) {
  const [enabled, setEnabled] = useState(() => {
    const known = readKey(ENABLED_KEY);
    return known === null ? undefined : known === "1";
  });
  const [failure] = useState(signInFailure);
  // Sign-in comes back on #ask or #ask-signin=…; otherwise the panel stays as it was on the last page.
  const [open, setOpen] = useState(() => window.location.hash === "#ask" || failure !== undefined || readKey(OPEN_KEY) === "1");

  useEffect(() => {
    if (window.location.hash === "#ask" || failure) window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  }, [failure]);

  useEffect(() => {
    if (enabled !== undefined) return;
    const controller = new AbortController();
    fetch("/ask/session", { headers: { accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        // SAFETY: /ask/session answers JSON with an `enabled` flag; anything else leaves the agent off.
        const session = response.ok ? ((await response.json()) as { enabled?: boolean }) : {};
        writeKey(ENABLED_KEY, session.enabled === true ? "1" : "0");
        setEnabled(session.enabled === true);
      })
      .catch(() => setEnabled(false));
    return () => controller.abort();
  }, [enabled]);

  useEffect(() => {
    writeKey(OPEN_KEY, open ? "1" : "0");
  }, [open]);

  // Mounted once opened, then kept: hiding the panel never stops what it is doing.
  const [mounted, setMounted] = useState(open);
  const [running, setRunning] = useState(false);
  // An answer that finished while the panel was docked, until the visitor opens it.
  const [unread, setUnread] = useState(false);
  const openNow = useRef(open);
  const button = useRef<HTMLButtonElement>(null);
  const rise = useFooterRise(useSiteLocation().page);
  // Clear of the home indicator, and of the footer once it is in view.
  const corner = { bottom: `max(1rem, env(safe-area-inset-bottom), ${rise + FOOTER_GAP_PX}px)` };

  const show = () => {
    setMounted(true);
    setOpen(true);
    setUnread(false);
  };
  const dock = useCallback(() => setOpen(false), []);
  const wasRunning = useRef(false);
  const onRunning = useCallback((now: boolean) => {
    // Only an answer that was running and has finished is news; the panel reporting "not running" as it mounts is not.
    if (wasRunning.current && !now && !openNow.current) setUnread(true);
    wasRunning.current = now;
    setRunning(now);
  }, []);

  useEffect(() => {
    // Focus goes back to the button the panel was opened from.
    if (openNow.current && !open) button.current?.focus();
    openNow.current = open;
  }, [open]);

  if (!enabled) return null;
  const status = running ? "The agent is still answering." : unread ? "The agent's answer is ready." : "";
  return (
    <>
      {mounted ? (
        <Suspense
          fallback={
            <div
              style={corner}
              className="fixed right-4 z-40 flex items-center gap-2 rounded-full border border-kumo-line bg-kumo-base px-4 py-3 text-sm text-kumo-subtle shadow-md"
            >
              <Loader size="sm" /> Opening…
            </div>
          }
        >
          <AskPanel open={open} failure={failure} onClose={dock} onRunning={onRunning} onModalChange={onModalChange} />
        </Suspense>
      ) : null}
      {open ? null : (
        <button
          ref={button}
          type="button"
          onClick={show}
          aria-haspopup="dialog"
          aria-expanded="false"
          style={corner}
          className="fixed right-4 z-40 flex min-h-11 items-center gap-2 rounded-full bg-kumo-brand px-4 py-3 text-sm font-medium text-kumo-inverse shadow-md transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none motion-reduce:hover:scale-100"
        >
          {running ? (
            <Loader size="sm" />
          ) : (
            <span className="relative">
              <ChatsCircleIcon size={20} weight="fill" aria-hidden="true" />
              {unread ? <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-kumo-brand bg-current" aria-hidden="true" /> : null}
            </span>
          )}
          {running ? "Answering…" : unread ? "Answer ready" : "Ask the data"}
        </button>
      )}
      <span className="sr-only" role="status">
        {open ? "" : status}
      </span>
    </>
  );
}
