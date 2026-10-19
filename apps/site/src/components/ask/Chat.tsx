import { Banner, Button, Input, Select } from "@cloudflare/kumo";
import { ArrowUpIcon, PlusIcon, StopIcon, WarningIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AskError, answer, systemPrompt, withPage, type AskAccounts, type AskModel, type AskSession, type AssistantTurn, type ChatMessage, type Provider } from "../../lib/ask";
import { Answer, CONTROL_SIZE } from "./Answer";
import { ConnectionsMenu, providerName } from "./Connections";
import { useSuggestions } from "./suggestions";

const TOUCH = window.matchMedia("(pointer: coarse)").matches;
const ICON_SIZE = TOUCH ? "lg" : "sm";
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
/** The account-ID field's id, which a question asked without one moves focus to. */
const ACCOUNT_FIELD = "ask-account";

/* ---------- What this browser keeps ---------- */

/** The visitor's account and model, in this browser; the conversation, in this tab, so it follows them from page to page. */
const ACCOUNT_KEY = "ask-account";
const MODEL_KEY = "ask-model";
/** Named for the shape it holds, so a conversation kept in another shape is left behind rather than misread. */
const CONVERSATION_KEY = "ask-conversation-2";

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

/** An answer that ended without finishing: what it had read, drawn and written so far, and why it ended. */
function endedTurn(turn: AssistantTurn | undefined, error: string): AssistantTurn {
  return {
    steps: turn?.steps ?? [],
    visuals: turn?.visuals ?? [],
    text: turn?.text ?? "",
    reasoning: turn?.reasoning ?? "",
    thinking: false,
    done: true,
    error,
    neurons: turn?.neurons ?? 0,
    tokens: turn?.tokens ?? 0,
    datasets: turn?.datasets ?? [],
  };
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
      last.turn = endedTurn(last.turn, "Stopped when you left the page.");
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

export function clearConversation() {
  try {
    sessionStorage.removeItem(CONVERSATION_KEY);
  } catch {
    // Nothing was kept, then.
  }
}

const lisbonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());

/** A model as the picker and the browser's memory name it: whose it is, then its ID. */
const keyOf = (model: AskModel) => `${model.provider}:${model.id}`;

/** A failure as the visitor can act on it: the kernel's own words, or what a network failure means. */
export function readableError(error: Error): string {
  // fetch rejects with a TypeError ("Failed to fetch", "Load failed") when the request never got an answer.
  if (error instanceof TypeError) return "Could not reach open-data.pt. Check your connection, then try again.";
  return error.message;
}

/* ---------- The conversation ---------- */

interface ChatProps {
  session: AskSession;
  /** Every model the visitor can use now, Workers AI's first, from each provider they are signed in to. */
  models: AskModel[];
  /** The Cloudflare accounts their sign-in reaches. */
  accounts: AskAccounts["accounts"];
  /** Why their GitHub sign-in offers no model, when it offers none. */
  copilotProblem: string | undefined;
  /** Whether the panel is showing; docked, the conversation carries on out of sight. */
  open: boolean;
  onSignedOut: (provider: Provider) => void;
  onRunning: (running: boolean) => void;
}

export function Chat({ session, models, accounts, copilotProblem, open, onSignedOut, onRunning }: ChatProps) {
  const [accountId, setAccountId] = useState(() => {
    const saved = remembered(ACCOUNT_KEY);
    return accounts.some((account) => account.id === saved) || (!accounts.length && ACCOUNT_ID.test(saved)) ? saved : (accounts[0]?.id ?? "");
  });
  const [chosen, setChosen] = useState(remembered(MODEL_KEY));
  // A model the visitor chose that is no longer offered (signed out of its provider) gives way to the first that is.
  const model = models.find((offered) => keyOf(offered) === chosen) ?? models[0];
  const [initial] = useState(savedConversation);
  const [exchanges, setExchanges] = useState<Exchange[]>(initial.exchanges);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [accountError, setAccountError] = useState(false);
  // What "New conversation" cleared, until the visitor asks again or undoes it.
  const [cleared, setCleared] = useState<Saved | undefined>();
  const transcript = useRef<ChatMessage[]>(initial.transcript);
  const abort = useRef<AbortController | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const suggestions = useSuggestions();

  const needsAccount = model?.provider === "cloudflare";
  const accountReady = !needsAccount || ACCOUNT_ID.test(accountId);

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

  const choose = (key: string) => {
    setChosen(key);
    remember(MODEL_KEY, key);
  };

  /** Asks a question; `retrying` replaces the last exchange instead of adding one. */
  const ask = async (question: string, retrying = false) => {
    const text = question.trim();
    if (!text || running || !model) return;
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
    if (needsAccount) remember(ACCOUNT_KEY, accountId);
    const controller = new AbortController();
    abort.current = controller;
    const update = (turn: AssistantTurn) => setExchanges((current) => current.map((exchange, at) => (at === index ? { ...exchange, turn } : exchange)));
    try {
      await answer({
        accountId,
        model,
        freeModel: models.find((offered) => offered.provider === "cloudflare" && offered.free),
        onModelChange: (changed) => choose(keyOf(changed)),
        messages: transcript.current,
        signal: controller.signal,
        onUpdate: update,
      });
    } catch (error) {
      if (error instanceof AskError && error.status === 401) {
        onSignedOut(model.provider);
        return;
      }
      const message = controller.signal.aborted ? "Stopped." : error instanceof Error ? readableError(error) : String(error);
      setExchanges((current) => current.map((exchange, at) => (at === index ? { ...exchange, turn: endedTurn(exchange.turn, message) } : exchange)));
      // A question that failed part-way leaves its tool calls unanswered; drop it so the next one starts clean.
      dropLastQuestion(transcript.current);
    } finally {
      setRunning(false);
      abort.current = undefined;
    }
  };

  /** The last question again: after a failure it was already taken out of the transcript; after an answer, its answer goes too. */
  const askAgain = (exchange: Exchange) => {
    if (!exchange.turn?.error) dropLastQuestion(transcript.current);
    void ask(exchange.question, true);
  };

  const forget = () => {
    abort.current?.abort();
    transcript.current = [];
    setExchanges([]);
    setCleared(undefined);
    clearConversation();
  };

  const restart = () => {
    // Cleared mid-answer, the snapshot keeps that answer as stopped and its question out of the transcript,
    // as the abort would have left them, so Undo never brings back a question that is still unanswered.
    const kept = { exchanges, transcript: [...transcript.current] };
    if (running) {
      dropLastQuestion(kept.transcript);
      kept.exchanges = exchanges.map((exchange, at) => (at === exchanges.length - 1 ? { ...exchange, turn: endedTurn(exchange.turn, "Stopped.") } : exchange));
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

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask(draft);
    }
  };

  const providers = [...new Set(models.map((each) => each.provider))];
  const last = exchanges.at(-1);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-kumo-line px-4 py-2">
        {model ? (
          <Select
            aria-label="Model"
            size={CONTROL_SIZE}
            className="w-44"
            value={keyOf(model)}
            onValueChange={(value: string | null) => choose(value ?? "")}
            renderValue={(value: string | null) => models.find((each) => keyOf(each) === value)?.name ?? value}
          >
            {providers.map((provider) => (
              <Select.Group key={provider}>
                {providers.length > 1 ? <Select.GroupLabel>{providerName(provider)}</Select.GroupLabel> : null}
                {models
                  .filter((each) => each.provider === provider)
                  .map((each) => (
                    <Select.Option key={keyOf(each)} value={keyOf(each)}>
                      <span className="grid">
                        <span>{each.name}</span>
                        {each.note ? <span className="text-xs text-kumo-subtle">{each.note}</span> : null}
                      </span>
                    </Select.Option>
                  ))}
              </Select.Group>
            ))}
          </Select>
        ) : null}
        {needsAccount && accounts.length > 1 ? (
          <Select
            aria-label="Cloudflare account"
            size={CONTROL_SIZE}
            className="w-36"
            value={accountId}
            onValueChange={(value: string | null) => setAccountId(value ?? "")}
            items={accounts.map((account) => ({ value: account.id, label: account.name }))}
          />
        ) : null}
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size={ICON_SIZE} icon={<PlusIcon />} onClick={restart} disabled={!exchanges.length} aria-label="New conversation" title="New conversation" />
          <ConnectionsMenu
            session={session}
            onSignedOut={(provider) => {
              forget();
              onSignedOut(provider);
            }}
          />
        </div>
      </div>
      {needsAccount && !accounts.length ? (
        <label className="grid gap-1 border-b border-kumo-line px-4 py-2 text-xs text-kumo-subtle">
          Cloudflare did not list your accounts to us. Paste the account ID from your dashboard's address, dash.cloudflare.com/&lt;account ID&gt;.
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
            placeholder="32 hexadecimal characters"
          />
          {accountError && !accountReady ? (
            <span id={`${ACCOUNT_FIELD}-error`} className="text-kumo-danger">
              That is not an account ID. Use the 32 characters after dash.cloudflare.com/ in your dashboard's address.
            </span>
          ) : null}
        </label>
      ) : null}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {/* One short status line is announced, not the whole conversation as it streams in. */}
        <span className="sr-only" role="status">
          {running ? "Answering…" : last?.turn?.error ? `No answer: ${last.turn.error}` : last?.turn?.done ? "Answer ready." : ""}
        </span>
        <section aria-label="Conversation" className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-6">
          {!model && copilotProblem ? <Banner variant="alert" icon={<WarningIcon weight="fill" />} title="No model to ask" description={copilotProblem} /> : null}
          {exchanges.length ? (
            exchanges.map((exchange, index) => (
              <div key={index} data-exchange className="grid scroll-mt-4 gap-3">
                <p className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-kumo-tint px-3.5 py-2 text-sm text-kumo-strong">{exchange.question}</p>
                <Answer turn={exchange.turn} onRetry={index === exchanges.length - 1 && exchange.turn?.done && !running ? () => askAgain(exchange) : undefined} />
              </div>
            ))
          ) : model ? (
            <div className="grid min-w-0 gap-3">
              <p className="text-sm text-kumo-subtle">
                {suggestions.about ? (
                  <>
                    Ask about <span className="font-medium text-kumo-strong">{suggestions.about}</span>, or anything else, in Portuguese or English. Try:
                  </>
                ) : (
                  "Ask in Portuguese or English. It can draw charts and maps. Try:"
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.questions.map((suggestion) => (
                  <Button
                    key={suggestion}
                    variant="secondary"
                    size={CONTROL_SIZE}
                    // Kumo sizes a button to its text on one line; a long question wraps inside the panel instead.
                    className="h-auto min-h-8 w-auto max-w-full whitespace-normal py-1.5 text-left"
                    onClick={() => void ask(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {cleared ? (
        <div role="status" className="flex items-center justify-between gap-3 border-t border-kumo-line px-4 py-2 text-xs text-kumo-subtle">
          Conversation cleared.
          <Button variant="secondary" size={CONTROL_SIZE} onClick={undoRestart}>
            Undo
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
          aria-label="Your question"
          // 16px on phones: iOS Safari zooms the page into any field with smaller text.
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base text-kumo-strong outline-none placeholder:text-kumo-placeholder disabled:opacity-60 sm:min-h-10 sm:py-2 sm:text-sm"
          enterKeyHint="send"
          rows={1}
          value={draft}
          disabled={!model}
          placeholder={model ? "Ask about the data…" : "Sign in to a provider with a model to ask"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <Button variant="secondary" size={TOUCH ? "lg" : "base"} icon={<StopIcon weight="fill" />} aria-label="Stop" onClick={() => abort.current?.abort()} />
        ) : (
          <Button type="submit" variant="primary" size={TOUCH ? "lg" : "base"} icon={<ArrowUpIcon weight="bold" />} aria-label="Ask" disabled={!draft.trim() || !model} />
        )}
      </form>
    </>
  );
}
