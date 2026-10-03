import { Loader } from "@cloudflare/kumo";
import { ChatsCircleIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useState } from "react";

// The agent in the corner of every page. This part is all every page loads: whether the agent is on
// here, and a button. The panel, the model's sandbox and the MCP server load when it first opens.

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

/** Why sign-in came back without a session, when the callback says so in the address's fragment. */
function signInFailure(): string | undefined {
  return /^#ask-signin=(\w+)$/.exec(window.location.hash)?.[1];
}

export function AskLauncher() {
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

  useEffect(() => writeKey(OPEN_KEY, open ? "1" : "0"), [open]);

  if (!enabled) return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-kumo-brand px-4 py-3 text-sm font-medium text-white shadow-md transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <ChatsCircleIcon size={20} weight="fill" aria-hidden="true" />
        Ask the data
      </button>
    );
  }
  return (
    <Suspense
      fallback={
        <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-kumo-line bg-kumo-base px-4 py-3 text-sm text-kumo-subtle shadow-md">
          <Loader size="sm" /> Opening…
        </div>
      }
    >
      <AskPanel failure={failure} onClose={() => setOpen(false)} />
    </Suspense>
  );
}
