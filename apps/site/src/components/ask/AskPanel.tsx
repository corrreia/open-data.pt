import { Banner, Button, Input, LinkButton, Loader, Select } from "@cloudflare/kumo";
import { ArrowUpIcon, CheckCircleIcon, CloudIcon, PlusIcon, SignOutIcon, StopIcon, WarningCircleIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
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
import { fmt } from "../../lib/format";

// The agent's panel. Charts and maps load only when an answer has one.
const Visuals = lazy(() => import("./Visuals"));

const LINK = "font-medium text-kumo-link hover:underline";
const ACCOUNT_ID = /^[0-9a-f]{32}$/;

const SUGGESTIONS = [
  "Mapa dos postos de gasóleo mais baratos em Lisboa",
  "Was there an earthquake in Portugal this week?",
  "Chart Portugal's electricity consumption over the last week",
  "Há avisos meteorológicos do IPMA para o Porto?",
];

/** Why sign-in came back without a session, as the callback names it. */
const SIGNIN_FAILURES = new Map([
  ["denied", "You did not allow Workers AI, so nothing was connected."],
  ["expired", "The sign-in took too long or was started in another tab. Try again."],
  ["failed", "Cloudflare did not complete the sign-in. Try again."],
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
        error: "Stopped when you left the page.",
      };
      saved.transcript.splice(saved.transcript.findLastIndex((message) => message.role === "user"));
    }
    return saved;
  } catch {
    return { exchanges: [], transcript: [] };
  }
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
    <ul className="grid gap-1 text-xs text-kumo-subtle" aria-label="What the agent read">
      {turn.steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">
            {step.state === "running" ? (
              <Loader size="sm" />
            ) : step.state === "done" ? (
              <CheckCircleIcon size={14} className="text-kumo-success" aria-label="Done" />
            ) : (
              <WarningCircleIcon size={14} className="text-kumo-warning" aria-label="Failed, and tried again" />
            )}
          </span>
          <span className="min-w-0 break-words">{step.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Answer({ turn }: { turn: AssistantTurn | undefined }) {
  if (!turn) return null;
  return (
    <div className="grid gap-3">
      <Steps turn={turn} />
      {turn.visuals.length ? (
        <Suspense
          fallback={
            <span className="flex items-center gap-2 text-xs text-kumo-subtle">
              <Loader size="sm" /> Drawing…
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
          <Loader size="sm" /> Thinking…
        </span>
      ) : null}
      {turn.error ? <p className="text-sm text-kumo-danger">{turn.error}</p> : null}
      {turn.done && turn.neurons > 0 ? <p className="text-xs text-kumo-subtle">About {fmt.int(Math.ceil(turn.neurons))} neurons of Workers AI on your account</p> : null}
    </div>
  );
}

/* ---------- Signed out ---------- */

function SignIn({ failure }: { failure: string | undefined }) {
  return (
    <div className="grid content-start gap-4 p-4">
      {failure ? <Banner variant="alert" icon={<WarningIcon weight="fill" />} title="Not signed in" description={failure} /> : null}
      <p className="text-sm leading-relaxed text-kumo-default">
        Ask about Portuguese public data in your own words. The agent reads open-data.pt, answers with the datasets it used, and draws charts and maps when they help.
      </p>
      <ol className="grid list-decimal gap-2 pl-5 text-sm leading-relaxed text-kumo-subtle">
        <li>Cloudflare asks whether open-data.pt may use Workers AI on your account. It asks for nothing else.</li>
        <li>You come back to this page, with the agent open.</li>
        <li>The model runs on your account, so Cloudflare bills its use to you. Workers AI's free 10,000 neurons a day cover about ten questions.</li>
      </ol>
      <p className="text-xs leading-relaxed text-kumo-subtle">
        We keep no conversation and no account details: your sign-in is a cookie in this browser, and signing out revokes it.
      </p>
      <div>
        <LinkButton href={signInHref()} variant="primary" icon={<CloudIcon />}>
          Sign in with Cloudflare
        </LinkButton>
      </div>
      <p className="text-xs text-kumo-subtle">
        No Cloudflare account? Claude, ChatGPT and other assistants can read the same data through our{" "}
        <a className={LINK} href="/start/#mcp">
          MCP server
        </a>
        , on your own subscription.
      </p>
    </div>
  );
}

/* ---------- The conversation ---------- */

function Chat({ session, accounts, onSignedOut }: { session: AskSession; accounts: AskAccounts["accounts"]; onSignedOut: () => void }) {
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
  const transcript = useRef<ChatMessage[]>(initial.transcript);
  const abort = useRef<AbortController | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const accountReady = ACCOUNT_ID.test(accountId);

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => () => abort.current?.abort(), []);
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

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || running || !accountReady) return;
    if (!transcript.current.length) transcript.current.push({ role: "system", content: systemPrompt(lisbonToday()) });
    transcript.current.push({ role: "user", content: withPage(text, document.title, `${window.location.pathname}${window.location.search}`) });
    const index = exchanges.length;
    setExchanges((current) => [...current, { question: text, turn: undefined }]);
    setDraft("");
    setRunning(true);
    remember(ACCOUNT_KEY, accountId);
    remember(MODEL_KEY, model);
    const controller = new AbortController();
    abort.current = controller;
    const update = (turn: AssistantTurn) => setExchanges((current) => current.map((exchange, at) => (at === index ? { ...exchange, turn } : exchange)));
    try {
      await answer({ accountId, model, messages: transcript.current, signal: controller.signal, onUpdate: update });
    } catch (error) {
      if (error instanceof AskError && error.status === 401) {
        onSignedOut();
        return;
      }
      const message = controller.signal.aborted ? "Stopped." : error instanceof Error ? error.message : String(error);
      setExchanges((current) =>
        current.map((exchange, at) =>
          at === index
            ? {
                ...exchange,
                turn: {
                  steps: exchange.turn?.steps ?? [],
                  visuals: exchange.turn?.visuals ?? [],
                  text: exchange.turn?.text ?? "",
                  thinking: false,
                  done: true,
                  error: message,
                  neurons: 0,
                },
              }
            : exchange,
        ),
      );
      // A question that failed part-way leaves its tool calls unanswered; drop it so the next one starts clean.
      transcript.current.splice(transcript.current.findLastIndex((message) => message.role === "user"));
    } finally {
      setRunning(false);
      abort.current = undefined;
    }
  };

  const restart = () => {
    abort.current?.abort();
    transcript.current = [];
    setExchanges([]);
    input.current?.focus();
  };

  const leave = async () => {
    abort.current?.abort();
    transcript.current = [];
    setExchanges([]);
    await signOut();
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
          aria-label="Model"
          size="sm"
          className="w-40"
          value={model}
          onValueChange={(value: string | null) => setModel(value ?? "")}
          items={session.models.map((each) => ({ value: each.id, label: each.name }))}
        />
        {accounts.length > 1 ? (
          <Select
            aria-label="Cloudflare account"
            size="sm"
            className="w-40"
            value={accountId}
            onValueChange={(value: string | null) => setAccountId(value ?? "")}
            items={accounts.map((account) => ({ value: account.id, label: account.name }))}
          />
        ) : null}
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" icon={<PlusIcon />} onClick={restart} disabled={!exchanges.length} aria-label="New conversation" title="New conversation" />
          <Button variant="ghost" size="sm" icon={<SignOutIcon />} onClick={() => void leave()} aria-label="Sign out" title="Sign out" />
        </div>
      </div>
      {!accounts.length ? (
        <label className="grid gap-1 border-b border-kumo-line px-4 py-2 text-xs text-kumo-subtle">
          Cloudflare did not list your accounts to us. Paste the account ID from your dashboard's address, dash.cloudflare.com/&lt;account ID&gt;.
          <Input
            size="sm"
            className="font-mono"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value.trim().toLowerCase())}
            placeholder="32 hexadecimal characters"
          />
        </label>
      ) : null}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section aria-label="Conversation" aria-live="polite" className="grid gap-5">
          {exchanges.length ? (
            exchanges.map((exchange, index) => (
              <div key={index} className="grid gap-3">
                <p className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-kumo-tint px-3.5 py-2 text-sm text-kumo-strong">{exchange.question}</p>
                <Answer turn={exchange.turn} />
              </div>
            ))
          ) : (
            <div className="grid gap-3">
              <p className="text-sm text-kumo-subtle">Ask in Portuguese or English. It can draw charts and maps. Try:</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion}
                    variant="secondary"
                    size="sm"
                    className="h-auto whitespace-normal py-1.5 text-left"
                    onClick={() => void ask(suggestion)}
                    disabled={!accountReady}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      <form
        className="flex items-end gap-2 border-t border-kumo-line p-2"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
        }}
      >
        <textarea
          ref={input}
          aria-label="Your question"
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-kumo-strong outline-none placeholder:text-kumo-inactive"
          rows={1}
          value={draft}
          placeholder={accountReady ? "Ask about Portuguese public data…" : "Paste your account ID first"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={!accountReady}
        />
        {running ? (
          <Button variant="secondary" icon={<StopIcon weight="fill" />} aria-label="Stop" onClick={() => abort.current?.abort()} />
        ) : (
          <Button type="submit" variant="primary" icon={<ArrowUpIcon weight="bold" />} aria-label="Ask" disabled={!draft.trim() || !accountReady} />
        )}
      </form>
    </>
  );
}

/* ---------- The panel ---------- */

export default function AskPanel({ failure, onClose }: { failure: string | undefined; onClose: () => void }) {
  const [session, setSession] = useState<AskSession | undefined>();
  const [accounts, setAccounts] = useState<AskAccounts["accounts"] | undefined>();
  const [failed, setFailed] = useState<string | undefined>();

  useEffect(() => {
    const load = async () => {
      const current = await readSession();
      if (!current.signedIn) return setSession(current);
      const listed = await readAccounts();
      setAccounts(listed.accounts);
      setSession({ ...current, signedIn: listed.signedIn });
    };
    load().catch((error: Error) => setFailed(error.message));
  }, []);

  let content: ReactNode;
  if (failed)
    content = (
      <div className="p-4">
        <Banner variant="error" icon={<WarningCircleIcon weight="fill" />} title="The agent could not start" description={failed} />
      </div>
    );
  else if (!session)
    content = (
      <span className="flex items-center gap-2 p-4 text-sm text-kumo-subtle">
        <Loader size="sm" /> Loading…
      </span>
    );
  else if (!session.signedIn) content = <SignIn failure={failure ? (SIGNIN_FAILURES.get(failure) ?? SIGNIN_FAILURES.get("failed")) : undefined} />;
  else content = <Chat session={session} accounts={accounts ?? []} onSignedOut={() => setSession({ ...session, signedIn: false })} />;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="ask-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-kumo-base sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(46rem,calc(100dvh-2rem))] sm:w-[28rem] sm:rounded-2xl sm:border sm:border-kumo-line sm:shadow-md"
    >
      <header className="flex items-center gap-2 border-b border-kumo-line px-4 py-3">
        <div className="grid min-w-0 flex-1">
          <h2 id="ask-title" className="font-display text-lg leading-tight text-kumo-strong">
            Ask the data
          </h2>
          <span className="text-xs text-kumo-subtle">On your own Cloudflare account</span>
        </div>
        <Button variant="ghost" size="sm" icon={<XIcon />} onClick={onClose} aria-label="Close the agent" title="Close" />
      </header>
      {content}
    </div>
  );
}
