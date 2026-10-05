import { Banner, Button, Input, LinkButton, Loader, Popover, Select } from "@cloudflare/kumo";
import { ArrowUpIcon, CheckCircleIcon, CloudIcon, PlusIcon, SignOutIcon, StopIcon, WarningCircleIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AskError,
  answer,
  readAccounts,
  readSession,
  signInHref,
  signOut,
  systemPrompt,
  withPage,
  type AskAccounts,
  type AskSession,
  type AssistantTurn,
  type ChatMessage,
} from "../../lib/ask";
import { localHref } from "../../lib/locale";
import { ASK } from "../../text/ask";

// The agent's panel. Charts and maps load only when an answer has one.
const Visuals = lazy(() => import("./Visuals"));

const LINK = "font-medium text-kumo-link hover:underline";

/** Fingers rather than a mouse: buttons get the larger size, and opening the panel does not raise the keyboard by itself. */
const TOUCH = window.matchMedia("(pointer: coarse)").matches;
const ICON_SIZE = TOUCH ? "lg" : "sm";
/** Selects, fields and suggestions: touch-sized on a touch screen, compact with a mouse. */
const CONTROL_SIZE = TOUCH ? "lg" : "sm";
/** Below Tailwind's sm breakpoint the panel fills the screen. */
const PHONE = window.matchMedia("(max-width: 639px)");
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
/** The account-ID field's id, which a question asked without one moves focus to. */
const ACCOUNT_FIELD = "ask-account";

const SUGGESTIONS = ASK.suggestions;

/** Why sign-in came back without a session, as the callback names it. */
const SIGNIN_FAILURES = new Map([
  ["denied", ASK.signInFailures.denied],
  ["expired", ASK.signInFailures.expired],
  ["failed", ASK.signInFailures.failed],
]);

/* ---------- What this browser keeps ---------- */

/** The visitor's account and model, in this browser; the conversation, in this tab, so it follows them from page to page. */
const ACCOUNT_KEY = "ask-account";
const MODEL_KEY = "ask-model";
const CONVERSATION_KEY = "ask-conversation";

function remembered(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage only lose the convenience.
  }
}

interface Exchange {
  question: string;
  turn: AssistantTurn | undefined;
}

interface Saved {
  exchanges: Exchange[];
  transcript: ChatMessage[];
}

/** The conversation as this tab left it. An answer cut off by leaving a page is marked so, and taken out of what the model reads. */
function savedConversation(): Saved {
  try {
    const text = sessionStorage.getItem(CONVERSATION_KEY);
    if (!text) return { exchanges: [], transcript: [] };
    // SAFETY: only this panel writes the key, in this tab, from these same types.
    const saved = JSON.parse(text) as Saved;
    const last = saved.exchanges.at(-1);
    if (last && !last.turn?.done) {
      last.turn = {
        steps: last.turn?.steps ?? [],
        visuals: last.turn?.visuals ?? [],
        text: last.turn?.text ?? "",
        thinking: false,
        done: true,
        neurons: 0,
        error: ASK.stoppedOnLeaving,
      };
      dropLastQuestion(saved.transcript);
    }
    return saved;
  } catch {
    return { exchanges: [], transcript: [] };
  }
}

/**
 * Takes the last question and everything after it out of what the model reads, so a question that
 * failed part-way leaves no tool call unanswered. A transcript with no question is left as it is.
 */
function dropLastQuestion(transcript: ChatMessage[]) {
  const asked = transcript.findLastIndex((message) => message.role === "user");
  if (asked >= 0) transcript.splice(asked);
}

function saveConversation(saved: Saved) {
  try {
    sessionStorage.setItem(CONVERSATION_KEY, JSON.stringify(saved));
  } catch {
    // A conversation too large for the tab's storage is still on screen; only the next page loses it.
  }
}

const lisbonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());

/* ---------- Answers ---------- */

/** Answers render as Markdown; links to this site stay in the tab, and the conversation follows; others open a new one. */
const MARKDOWN: Components = {
  a: ({ href, children }) => {
    const external = href !== undefined && /^https?:/.test(href) && !href.startsWith(window.location.origin);
    return (
      <a href={href} className={LINK} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}>
        {children}
      </a>
    );
  },
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
};

const PROSE =
  "min-w-0 text-sm leading-relaxed text-kumo-default [&_code]:rounded [&_code]:bg-kumo-recessed [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.9em] [&_h1]:mt-3 [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold [&_strong]:text-kumo-strong [&_td]:border-b [&_td]:border-kumo-line [&_td]:px-2 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-kumo-line [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_ul]:list-disc [&_ul]:pl-5";

function Steps({ turn }: { turn: AssistantTurn }) {
  if (!turn.steps.length) return null;
  return (
    <ul className="grid gap-1 text-xs text-kumo-subtle" aria-label={ASK.whatItRead}>
      {turn.steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">
            {step.state === "running" ? (
              <Loader size="sm" />
            ) : step.state === "done" ? (
              <CheckCircleIcon size={14} className="text-kumo-success" aria-label={ASK.stepDone} />
            ) : (
              <WarningCircleIcon size={14} className="text-kumo-warning" aria-label={ASK.stepFailed} />
            )}
          </span>
          <span className="min-w-0 break-words">{step.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Answer({ turn, onRetry }: { turn: AssistantTurn | undefined; onRetry: (() => void) | undefined }) {
  if (!turn) return null;
  return (
    <div className="grid gap-3">
      <Steps turn={turn} />
      {turn.visuals.length ? (
        <Suspense
          fallback={
            <span className="flex items-center gap-2 text-xs text-kumo-subtle">
              <Loader size="sm" /> {ASK.drawing}
            </span>
          }
        >
          <Visuals visuals={turn.visuals} />
        </Suspense>
      ) : null}
      {turn.text ? (
        <div className={PROSE}>
          <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN}>
            {turn.text}
          </Markdown>
        </div>
      ) : null}
      {turn.thinking && !turn.done ? (
        <span className="flex items-center gap-2 text-xs text-kumo-subtle">
          <Loader size="sm" /> {ASK.thinking}
        </span>
      ) : null}
      {turn.notice ? <p className="text-xs text-kumo-subtle">{turn.notice}</p> : null}
      {turn.error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm text-kumo-danger">{turn.error}</p>
          {onRetry ? (
            <Button variant="secondary" size={CONTROL_SIZE} onClick={onRetry}>
              {ASK.tryAgain}
            </Button>
          ) : null}
        </div>
      ) : null}
      {turn.done && turn.neurons > 0 ? <p className="text-xs text-kumo-subtle">{ASK.neurons(Math.ceil(turn.neurons))}</p> : null}
    </div>
  );
}

/* ---------- Signed out ---------- */

function SignIn({ failure }: { failure: string | undefined }) {
  return (
    <div className="grid content-start gap-4 p-4">
      {failure ? <Banner variant="alert" icon={<WarningIcon weight="fill" />} title={ASK.notSignedIn} description={failure} /> : null}
      <p className="text-sm leading-relaxed text-kumo-default">{ASK.signInIntro}</p>
      <ol className="grid list-decimal gap-2 pl-5 text-sm leading-relaxed text-kumo-subtle">
        {ASK.signInSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="text-xs leading-relaxed text-kumo-subtle">{ASK.keepNothing}</p>
      <div>
        <LinkButton href={signInHref()} variant="primary" icon={<CloudIcon />}>
          {ASK.signIn}
        </LinkButton>
      </div>
      <p className="text-xs text-kumo-subtle">
        {ASK.noAccount((text) => (
          <a className={LINK} href={localHref("/start/#mcp")}>
            {text}
          </a>
        ))}
      </p>
    </div>
  );
}

/* ---------- The conversation ---------- */

interface ChatProps {
  session: AskSession;
  accounts: AskAccounts["accounts"];
  /** Whether the panel is showing; docked, the conversation carries on out of sight. */
  open: boolean;
  onSignedOut: () => void;
  onRunning: (running: boolean) => void;
}

function Chat({ session, accounts, open, onSignedOut, onRunning }: ChatProps) {
  const [accountId, setAccountId] = useState(() => {
    const saved = remembered(ACCOUNT_KEY);
    return accounts.some((account) => account.id === saved) || (!accounts.length && ACCOUNT_ID.test(saved)) ? saved : (accounts[0]?.id ?? "");
  });
  const [model, setModel] = useState(() => {
    const saved = remembered(MODEL_KEY);
    return session.models.some((offered) => offered.id === saved) ? saved : (session.models[0]?.id ?? "");
  });
  const [initial] = useState(savedConversation);
  const [exchanges, setExchanges] = useState<Exchange[]>(initial.exchanges);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [accountError, setAccountError] = useState(false);
  // What "New conversation" cleared, until the visitor asks again or undoes it.
  const [cleared, setCleared] = useState<Saved | undefined>();
  const transcript = useRef<ChatMessage[]>(initial.transcript);
  const abort = useRef<AbortController | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const accountReady = ACCOUNT_ID.test(accountId);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    onRunning(running);
  }, [running, onRunning]);
  // Reopened, the panel shows the start of the newest answer rather than wherever it was left.
  useEffect(() => {
    if (open) scroller.current?.querySelector("[data-exchange]:last-child")?.scrollIntoView({ block: "start" });
  }, [open]);
  // The question box grows with what is typed, up to its maximum height, and shrinks back once sent.
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [draft]);
  // A new question scrolls into view, so its answer starts where the visitor is looking.
  useEffect(() => {
    if (exchanges.length) scroller.current?.querySelector("[data-exchange]:last-child")?.scrollIntoView({ block: "start" });
  }, [exchanges.length]);
  // Follow the answer as it grows, unless the visitor has scrolled up to read something.
  useEffect(() => {
    const element = scroller.current;
    if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 160) element.scrollTop = element.scrollHeight;
  }, [exchanges]);
  // Kept as it changes, so following a link in an answer keeps the conversation.
  useEffect(() => {
    const timer = window.setTimeout(() => saveConversation({ exchanges, transcript: transcript.current }), 300);
    return () => window.clearTimeout(timer);
  }, [exchanges]);

  /** Asks a question; `retrying` replaces the last exchange, which failed, instead of adding one. */
  const ask = async (question: string, retrying = false) => {
    const text = question.trim();
    const asked = session.models.find((offered) => offered.id === model) ?? session.models[0];
    if (!text || running || !asked) return;
    if (!accountReady) {
      setAccountError(true);
      document.getElementById(ACCOUNT_FIELD)?.focus();
      return;
    }
    setCleared(undefined);
    if (!transcript.current.length) transcript.current.push({ role: "system", content: systemPrompt(lisbonToday()) });
    transcript.current.push({ role: "user", content: withPage(text, document.title, `${window.location.pathname}${window.location.search}`) });
    const index = retrying ? exchanges.length - 1 : exchanges.length;
    setExchanges((current) => [...(retrying ? current.slice(0, -1) : current), { question: text, turn: undefined }]);
    if (!retrying) setDraft("");
    setRunning(true);
    remember(ACCOUNT_KEY, accountId);
    remember(MODEL_KEY, model);
    setNotice(undefined);
    const controller = new AbortController();
    abort.current = controller;
    const update = (turn: AssistantTurn) => setExchanges((current) => current.map((exchange, at) => (at === index ? { ...exchange, turn } : exchange)));
    try {
      await answer({
        accountId,
        model: asked,
        freeModel: session.models.find((offered) => offered.free),
        onModelChange: (changed) => {
          setModel(changed.id);
          remember(MODEL_KEY, changed.id);
        },
        messages: transcript.current,
        signal: controller.signal,
        onUpdate: update,
      });
    } catch (error) {
      if (error instanceof AskError && error.status === 401) {
        onSignedOut();
        return;
      }
      const message = controller.signal.aborted ? ASK.stopped : error instanceof Error ? readableError(error) : String(error);
      setExchanges((current) => current.map((exchange, at) => (at === index ? { ...exchange, turn: endedTurn(exchange.turn, message) } : exchange)));
      // A question that failed part-way leaves its tool calls unanswered; drop it so the next one starts clean.
      dropLastQuestion(transcript.current);
    } finally {
      setRunning(false);
      abort.current = undefined;
    }
  };

  const restart = () => {
    // Cleared mid-answer, the snapshot keeps that answer as stopped and its question out of the transcript,
    // as the abort would have left them, so Undo never brings back a question that is still unanswered.
    const kept = { exchanges, transcript: [...transcript.current] };
    if (running) {
      dropLastQuestion(kept.transcript);
      kept.exchanges = exchanges.map((exchange, at) => (at === exchanges.length - 1 ? { ...exchange, turn: endedTurn(exchange.turn, ASK.stopped) } : exchange));
    }
    abort.current?.abort();
    setCleared(kept);
    transcript.current = [];
    setExchanges([]);
    input.current?.focus();
  };

  const undoRestart = () => {
    if (!cleared) return;
    transcript.current = cleared.transcript;
    setExchanges(cleared.exchanges);
    setCleared(undefined);
  };

  const leave = async () => {
    abort.current?.abort();
    try {
      await signOut();
    } catch (error) {
      setNotice(ASK.stillSignedIn(error instanceof Error ? readableError(error) : String(error)));
      return;
    }
    transcript.current = [];
    setExchanges([]);
    onSignedOut();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask(draft);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-kumo-line px-4 py-2">
        <Select
          aria-label={ASK.model}
          size={CONTROL_SIZE}
          className="w-40"
          value={model}
          onValueChange={(value: string | null) => setModel(value ?? "")}
          items={session.models.map((each) => ({ value: each.id, label: each.name }))}
        />
        {accounts.length > 1 ? (
          <Select
            aria-label={ASK.account}
            size={CONTROL_SIZE}
            className="w-40"
            value={accountId}
            onValueChange={(value: string | null) => setAccountId(value ?? "")}
            items={accounts.map((account) => ({ value: account.id, label: account.name }))}
          />
        ) : null}
        <div className="ml-auto flex gap-3">
          <Button
            variant="ghost"
            size={ICON_SIZE}
            icon={<PlusIcon />}
            onClick={restart}
            disabled={!exchanges.length}
            aria-label={ASK.newConversation}
            title={ASK.newConversation}
          />
          {/* Signing out clears the conversation and revokes open-data.pt's access, so it asks first. */}
          <Popover>
            <Popover.Trigger render={<Button variant="ghost" size={ICON_SIZE} icon={<SignOutIcon />} aria-label={ASK.signOut} title={ASK.signOut} />} />
            <Popover.Content className="grid w-72 max-w-[90vw] gap-3 p-3 text-sm">
              <p className="text-kumo-default">{ASK.signOutQuestion}</p>
              <Button variant="destructive" size={CONTROL_SIZE} onClick={() => void leave()}>
                {ASK.signOutAndClear}
              </Button>
            </Popover.Content>
          </Popover>
        </div>
      </div>
      {!accounts.length ? (
        <label className="grid gap-1 border-b border-kumo-line px-4 py-2 text-xs text-kumo-subtle">
          {ASK.accountIdHelp}
          <Input
            id={ACCOUNT_FIELD}
            size={CONTROL_SIZE}
            aria-invalid={accountError && !accountReady}
            aria-describedby={accountError && !accountReady ? `${ACCOUNT_FIELD}-error` : undefined}
            // 16px on phones: iOS Safari zooms the page into any field with smaller text.
            className="font-mono text-base sm:text-sm"
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={accountId}
            onChange={(event) => setAccountId(event.target.value.trim().toLowerCase())}
            placeholder={ASK.accountIdPlaceholder}
          />
          {accountError && !accountReady ? (
            <span id={`${ACCOUNT_FIELD}-error`} className="text-kumo-danger">
              {ASK.accountIdError}
            </span>
          ) : null}
        </label>
      ) : null}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {/* One short status line is announced, not the whole conversation as it streams in. */}
        <span className="sr-only" role="status">
          {running ? ASK.answering : exchanges.at(-1)?.turn?.error ? ASK.noAnswer(exchanges.at(-1)?.turn?.error ?? "") : exchanges.at(-1)?.turn?.done ? ASK.answerReadyShort : ""}
        </span>
        <section aria-label={ASK.conversation} className="grid gap-5">
          {exchanges.length ? (
            exchanges.map((exchange, index) => (
              <div key={index} data-exchange className="grid scroll-mt-4 gap-3">
                <p className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-kumo-tint px-3.5 py-2 text-sm text-kumo-strong">{exchange.question}</p>
                <Answer turn={exchange.turn} onRetry={index === exchanges.length - 1 && exchange.turn?.error && !running ? () => void ask(exchange.question, true) : undefined} />
              </div>
            ))
          ) : (
            <div className="grid gap-3">
              <p className="text-sm text-kumo-subtle">{ASK.tryThese}</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion}
                    variant="secondary"
                    size={CONTROL_SIZE}
                    className="h-auto min-h-8 whitespace-normal py-1.5 text-left"
                    onClick={() => void ask(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {notice ? (
        <p role="alert" className="border-t border-kumo-line px-4 py-2 text-xs text-kumo-danger">
          {notice}
        </p>
      ) : null}
      {cleared ? (
        <div role="status" className="flex items-center justify-between gap-3 border-t border-kumo-line px-4 py-2 text-xs text-kumo-subtle">
          {ASK.cleared}
          <Button variant="secondary" size={CONTROL_SIZE} onClick={undoRestart}>
            {ASK.undo}
          </Button>
        </div>
      ) : null}
      <form
        className="flex items-end gap-2 border-t border-kumo-line px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
        }}
      >
        <textarea
          ref={input}
          aria-label={ASK.yourQuestion}
          // 16px on phones: iOS Safari zooms the page into any field with smaller text.
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base text-kumo-strong outline-none placeholder:text-kumo-placeholder sm:min-h-10 sm:py-2 sm:text-sm"
          enterKeyHint="send"
          rows={1}
          value={draft}
          placeholder={ASK.askPlaceholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <Button variant="secondary" size={TOUCH ? "lg" : "base"} icon={<StopIcon weight="fill" />} aria-label={ASK.stop} onClick={() => abort.current?.abort()} />
        ) : (
          <Button type="submit" variant="primary" size={TOUCH ? "lg" : "base"} icon={<ArrowUpIcon weight="bold" />} aria-label={ASK.ask} disabled={!draft.trim()} />
        )}
      </form>
    </>
  );
}

/* ---------- The panel ---------- */

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

/** An answer that ended without finishing: what it had read, drawn and written so far, and why it ended. */
function endedTurn(turn: AssistantTurn | undefined, error: string): AssistantTurn {
  return { steps: turn?.steps ?? [], visuals: turn?.visuals ?? [], text: turn?.text ?? "", thinking: false, done: true, error, neurons: turn?.neurons ?? 0 };
}

/** A failure as the visitor can act on it: the kernel's own words, or what a network failure means. */
function readableError(error: Error): string {
  // fetch rejects with a TypeError ("Failed to fetch", "Load failed") when the request never got an answer.
  if (error instanceof TypeError) return ASK.unreachable;
  return error.message;
}

export default function AskPanel({ open, failure, onClose, onRunning, onModalChange }: AskPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const phone = usePhone();
  useVisibleViewport(panel, open);
  usePhoneModal(open && phone, onModalChange);
  const [session, setSession] = useState<AskSession | undefined>();
  const [accounts, setAccounts] = useState<AskAccounts["accounts"] | undefined>();
  const [failed, setFailed] = useState<string | undefined>();

  const load = useCallback(() => {
    setFailed(undefined);
    const read = async () => {
      const current = await readSession();
      if (!current.signedIn) return setSession(current);
      const listed = await readAccounts();
      setAccounts(listed.accounts);
      setSession({ ...current, signedIn: listed.signedIn });
    };
    read().catch((error: Error) => setFailed(readableError(error)));
  }, []);
  useEffect(load, [load]);

  // Focus moves into the panel on every open, once it is visible and no longer inert: to the question
  // box with a keyboard, to the panel itself on a touch screen so the keyboard does not spring up.
  const ready = session?.signedIn === true;
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const box = TOUCH ? null : panel.current?.querySelector("textarea");
      (box ?? panel.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, ready]);

  let content: ReactNode;
  if (failed)
    content = (
      <div className="grid gap-3 p-4">
        <Banner variant="error" icon={<WarningCircleIcon weight="fill" />} title={ASK.couldNotStart} description={failed} />
        <div>
          <Button variant="secondary" size={CONTROL_SIZE} onClick={load}>
            {ASK.tryAgain}
          </Button>
        </div>
      </div>
    );
  else if (!session)
    content = (
      <span className="flex items-center gap-2 p-4 text-sm text-kumo-subtle">
        <Loader size="sm" /> {ASK.loading}
      </span>
    );
  else if (!session.signedIn) content = <SignIn failure={failure ? (SIGNIN_FAILURES.get(failure) ?? SIGNIN_FAILURES.get("failed")) : undefined} />;
  else content = <Chat session={session} accounts={accounts ?? []} open={open} onSignedOut={() => setSession({ ...session, signedIn: false })} onRunning={onRunning} />;

  return (
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
      className={`fixed inset-x-0 top-[var(--ask-top,0px)] z-40 flex outline-none h-[var(--ask-height,100dvh)] flex-col overflow-hidden bg-kumo-base sm:inset-x-auto sm:top-auto sm:bottom-4 sm:right-4 sm:h-[min(46rem,calc(100dvh-2rem))] sm:w-[28rem] sm:rounded-2xl sm:border sm:border-kumo-line sm:shadow-md ${open ? "visible opacity-100 motion-safe:[transition:opacity_200ms,transform_200ms,visibility_0s]" : "invisible translate-y-3 opacity-0 motion-safe:[transition:opacity_200ms,transform_200ms,visibility_0s_200ms]"}`}
    >
      <header className="flex items-center gap-2 border-b border-kumo-line px-4 py-3">
        <div className="grid min-w-0 flex-1">
          <h2 id="ask-title" className="font-display text-lg leading-tight text-kumo-strong">
            {ASK.askTheData}
          </h2>
          <span className="text-xs text-kumo-subtle">{ASK.onYourAccount}</span>
        </div>
        <Button variant="ghost" size={ICON_SIZE} icon={<XIcon />} onClick={onClose} aria-label={ASK.close} title={ASK.close} />
      </header>
      {content}
    </div>
  );
}
