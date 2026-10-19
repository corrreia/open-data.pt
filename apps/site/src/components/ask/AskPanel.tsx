import { Banner, Button, Loader } from "@cloudflare/kumo";
import { ArrowsInSimpleIcon, ArrowsOutSimpleIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { readAccounts, readCopilot, readSession, type AskAccounts, type AskModel, type AskSession, type CopilotModels, type Provider } from "../../lib/ask";
import { useSiteLocation } from "../../lib/navigation";
import { CONTROL_SIZE } from "./Answer";
import { Chat, readableError } from "./Chat";
import { SignIn, providerName, signInFailure } from "./Connections";

// The agent's panel: in the corner of a wide screen, or the whole of a phone's, signed in to one or
// both of the providers a model can run on, or offering them.

/** Fingers rather than a mouse: buttons get the larger size, and opening the panel does not raise the keyboard by itself. */
const TOUCH = window.matchMedia("(pointer: coarse)").matches;
const ICON_SIZE = TOUCH ? "lg" : "sm";
/** Below Tailwind's sm breakpoint the panel fills the screen. */
const PHONE = window.matchMedia("(max-width: 639px)");
/** Whether the visitor widened the panel, so answers with charts, maps and tables have room; kept in this browser. */
const WIDE_KEY = "ask-wide";

function rememberedWide(): boolean {
  try {
    return localStorage.getItem(WIDE_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberWide(wide: boolean) {
  try {
    localStorage.setItem(WIDE_KEY, wide ? "1" : "0");
  } catch {
    // Private windows and blocked storage only lose the convenience.
  }
}

interface AskPanelProps {
  /** Docked when false: hidden and out of reach, but still running. */
  open: boolean;
  failure: string | undefined;
  onClose: () => void;
  onRunning: (running: boolean) => void;
  onModalChange: (modal: boolean) => void;
}

/**
 * On a phone the panel takes the visible part of the screen, which shrinks when the keyboard opens:
 * sized to the layout viewport, the box being typed in would sit under the keyboard.
 */
function useVisibleViewport(panel: RefObject<HTMLDivElement | null>, open: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = panel.current;
    if (!open || !viewport || !element) return;
    const fit = () => {
      element.style.setProperty("--ask-height", `${viewport.height}px`);
      element.style.setProperty("--ask-top", `${viewport.offsetTop}px`);
    };
    fit();
    viewport.addEventListener("resize", fit);
    viewport.addEventListener("scroll", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      viewport.removeEventListener("scroll", fit);
    };
  }, [panel, open]);
}

function subscribePhone(listener: () => void) {
  PHONE.addEventListener("change", listener);
  return () => PHONE.removeEventListener("change", listener);
}
const usePhone = () => useSyncExternalStore(subscribePhone, () => PHONE.matches);

/**
 * On a phone the open panel covers the page, so it is modal: the Shell makes the page behind it
 * inert (out of the tab order and the screen reader's reach), and it stays still instead of
 * scrolling along.
 */
function usePhoneModal(modal: boolean, onModalChange: (modal: boolean) => void) {
  useEffect(() => {
    if (!modal) return;
    const root = document.documentElement;
    root.style.overflow = "hidden";
    onModalChange(true);
    return () => {
      root.style.overflow = "";
      onModalChange(false);
    };
  }, [modal, onModalChange]);
}

/** What the agent knows about the visitor's providers once it has asked: their Cloudflare accounts and their Copilot's models. */
interface Reach {
  accounts: AskAccounts["accounts"];
  copilot: CopilotModels | undefined;
}

/** The models the visitor can ask now: Workers AI's when signed in to Cloudflare, then their Copilot plan's. */
function modelsOf(session: AskSession, reach: Reach): AskModel[] {
  const cloudflare = session.providers.cloudflare.signedIn ? session.providers.cloudflare.models.map((model) => ({ provider: "cloudflare" as const, ...model })) : [];
  const copilot = session.providers.github.signedIn ? (reach.copilot?.models ?? []).map((model) => ({ provider: "github" as const, free: false, ...model })) : [];
  return [...cloudflare, ...copilot];
}

export default function AskPanel({ open, failure, onClose, onRunning, onModalChange }: AskPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const phone = usePhone();
  useVisibleViewport(panel, open);
  usePhoneModal(open && phone, onModalChange);
  // On a phone the panel covers the page: following a link from it, or going back, docks it so the page shows.
  // The answer carries on, and the corner button says when it is ready.
  const { entry } = useSiteLocation();
  const entrySeen = useRef(entry);
  useEffect(() => {
    if (entry === entrySeen.current) return;
    entrySeen.current = entry;
    if (open && phone) onClose();
  }, [entry, open, phone, onClose]);
  const [wide, setWide] = useState(rememberedWide);
  const [session, setSession] = useState<AskSession | undefined>();
  const [reach, setReach] = useState<Reach | undefined>();
  const [failed, setFailed] = useState<string | undefined>();

  const load = useCallback(() => {
    setFailed(undefined);
    const read = async () => {
      const current = await readSession();
      const { cloudflare, github } = current.providers;
      // Each provider is asked only when the visitor is signed in to it, and both at once.
      const [listed, copilot] = await Promise.all([cloudflare.signedIn ? readAccounts() : undefined, github.signedIn ? readCopilot() : undefined]);
      setReach({ accounts: listed?.accounts ?? [], copilot });
      setSession({
        ...current,
        providers: {
          cloudflare: { ...cloudflare, signedIn: listed?.signedIn ?? false },
          github: { ...github, signedIn: copilot?.signedIn ?? false },
        },
      });
    };
    read().catch((error: Error) => setFailed(readableError(error)));
  }, []);
  useEffect(load, [load]);

  const signedOut = useCallback((provider: Provider) => {
    setSession((current) => (current ? { ...current, providers: { ...current.providers, [provider]: { ...current.providers[provider], signedIn: false } } } : current));
  }, []);

  // Focus moves into the panel on every open, once it is visible and no longer inert: to the question
  // box with a keyboard, to the panel itself on a touch screen so the keyboard does not spring up.
  const signedIn = session !== undefined && (session.providers.cloudflare.signedIn || session.providers.github.signedIn);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const box = TOUCH ? null : panel.current?.querySelector("textarea");
      (box ?? panel.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, signedIn]);

  let content: ReactNode;
  if (failed)
    content = (
      <div className="grid gap-3 p-4">
        <Banner variant="error" icon={<WarningCircleIcon weight="fill" />} title="The agent could not start" description={failed} />
        <div>
          <Button variant="secondary" size={CONTROL_SIZE} onClick={load}>
            Try again
          </Button>
        </div>
      </div>
    );
  else if (!session || !reach)
    content = (
      <span className="flex items-center gap-2 p-4 text-sm text-kumo-subtle">
        <Loader size="sm" /> Loading…
      </span>
    );
  else if (!signedIn) content = <SignIn session={session} failure={signInFailure(failure)} />;
  else
    content = (
      <Chat
        session={session}
        models={modelsOf(session, reach)}
        accounts={reach.accounts}
        copilotProblem={session.providers.github.signedIn ? reach.copilot?.problem : undefined}
        open={open}
        onSignedOut={signedOut}
        onRunning={onRunning}
      />
    );

  const on = session ? (["cloudflare", "github"] as const).filter((provider) => session.providers[provider].signedIn).map(providerName) : [];
  return (
    <>
      {/* On a phone the panel ends where the visible part of the screen does, but iOS draws the keyboard's
          bar of form controls as a translucent strip below that: this keeps the page from showing through it. */}
      <div
        aria-hidden="true"
        className={`fixed inset-x-0 top-0 -bottom-[100vh] z-40 bg-kumo-base sm:hidden ${open ? "visible opacity-100 motion-safe:[transition:opacity_200ms,visibility_0s]" : "invisible opacity-0 motion-safe:[transition:opacity_200ms,visibility_0s_200ms]"}`}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal={open && phone}
        aria-labelledby="ask-title"
        tabIndex={-1}
        // Docked, the panel stays in the page, so an answer carries on, but nothing in it can be reached.
        // It turns visible at once when it opens, so focus can move into it, and hidden only once it has faded out.
        inert={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className={`fixed inset-x-0 top-[var(--ask-top,0px)] z-40 flex outline-none h-[var(--ask-height,100dvh)] flex-col overflow-hidden bg-kumo-base sm:inset-x-auto sm:top-auto sm:bottom-4 sm:right-4 sm:rounded-2xl sm:border sm:border-kumo-line sm:shadow-md motion-safe:sm:[transition-property:opacity,transform,visibility,width,height] ${wide ? "sm:h-[calc(100dvh-2rem)] sm:w-[min(56rem,calc(100vw-2rem))]" : "sm:h-[min(46rem,calc(100dvh-2rem))] sm:w-[28rem]"} ${open ? "visible opacity-100 motion-safe:[transition:opacity_200ms,transform_200ms,visibility_0s]" : "invisible translate-y-3 opacity-0 motion-safe:[transition:opacity_200ms,transform_200ms,visibility_0s_200ms]"}`}
      >
        <header className="flex items-center gap-2 border-b border-kumo-line px-4 py-3">
          <div className="grid min-w-0 flex-1">
            <h2 id="ask-title" className="font-display text-lg leading-tight text-kumo-strong">
              Ask the data
            </h2>
            <span className="truncate text-xs text-kumo-subtle">{on.length ? `On your own ${on.join(" and ")}` : "On your own account"}</span>
          </div>
          {/* A phone's panel is already the whole screen. */}
          <Button
            variant="ghost"
            size={ICON_SIZE}
            className="hidden sm:inline-flex"
            icon={wide ? <ArrowsInSimpleIcon /> : <ArrowsOutSimpleIcon />}
            onClick={() => {
              setWide(!wide);
              rememberWide(!wide);
            }}
            aria-label={wide ? "Narrow the panel" : "Widen the panel"}
            aria-pressed={wide}
            title={wide ? "Narrow the panel" : "Widen the panel"}
          />
          <Button variant="ghost" size={ICON_SIZE} icon={<XIcon />} onClick={onClose} aria-label="Close" title="Close" />
        </header>
        {content}
      </div>
    </>
  );
}
