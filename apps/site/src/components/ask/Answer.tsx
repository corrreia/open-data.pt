import { Button, Loader } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, CheckCircleIcon, CheckIcon, CopyIcon, DatabaseIcon, LightbulbIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { lazy, Suspense, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { productHref } from "../../lib/api";
import { fetchProducts } from "../../lib/catalog";
import { fmt } from "../../lib/format";
import { siteHref } from "../../lib/navigation";
import { useQuery } from "../../lib/query";
import type { AssistantTurn, Step } from "../../lib/ask";

// One answer of the agent's: what it thought, read and drew, what it wrote, and what can be done with it.
// Charts and maps load only when an answer has one.
const Visuals = lazy(() => import("./Visuals"));

export const LINK = "font-medium text-kumo-link hover:underline";

/** Fingers rather than a mouse: buttons get the larger size. */
const TOUCH = window.matchMedia("(pointer: coarse)").matches;
export const CONTROL_SIZE = TOUCH ? "lg" : "sm";

/** Answers render as Markdown; links to this site stay in the tab, and the conversation follows; others open a new one. */
const MARKDOWN: Components = {
  a: ({ href: written, children }) => {
    const href = written === undefined ? undefined : siteHref(written);
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

/** A block of the model's working: code, output or thinking, in a box that scrolls rather than grows. */
function Working({ label, children }: { label: string; children: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-[0.7rem] font-medium uppercase tracking-wide text-kumo-subtle">{label}</span>
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-kumo-recessed px-2.5 py-2 font-mono text-[0.75rem] leading-relaxed text-kumo-default">
        {children}
      </pre>
    </div>
  );
}

/** A part of the answer that opens to show more, with its own marker in place of the browser's triangle. */
function Disclosure({ summary, icon, children }: { summary: ReactNode; icon: ReactNode; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded text-kumo-subtle hover:text-kumo-strong [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <span className="min-w-0 break-words">{summary}</span>
        <span className="ml-auto shrink-0 text-[0.7rem] text-kumo-subtle group-open:hidden">Show</span>
        <span className="ml-auto hidden shrink-0 text-[0.7rem] text-kumo-subtle group-open:inline">Hide</span>
      </summary>
      <div className="mt-2 mb-1 grid gap-2 pl-6">{children}</div>
    </details>
  );
}

function StepIcon({ step }: { step: Step }) {
  if (step.state === "running") return <Loader size="sm" />;
  if (step.state === "done") return <CheckCircleIcon size={14} className="text-kumo-success" aria-label="Done" />;
  return <WarningCircleIcon size={14} className="text-kumo-warning" aria-label="Failed, and tried again" />;
}

/** What the model read, each step opening on the code it ran and what came back. */
function Steps({ turn }: { turn: AssistantTurn }) {
  if (!turn.steps.length) return null;
  return (
    <ul className="grid gap-1.5 text-xs" aria-label="What the agent read">
      {turn.steps.map((step) => (
        <li key={step.id}>
          <Disclosure summary={step.label} icon={<StepIcon step={step} />}>
            {step.code ? <Working label="Code">{step.code}</Working> : null}
            {step.output ? <Working label={step.state === "failed" ? "Error" : "Result"}>{step.output}</Working> : null}
            {step.state === "running" ? <span className="text-kumo-subtle">Running…</span> : null}
          </Disclosure>
        </li>
      ))}
    </ul>
  );
}

/** The model's own thinking, for models that stream it: closed, since the answer is what was asked for. */
function Reasoning({ turn }: { turn: AssistantTurn }) {
  const thinking = turn.thinking && !turn.done;
  if (!turn.reasoning) {
    return thinking ? (
      <span className="flex items-center gap-2 text-xs text-kumo-subtle">
        <Loader size="sm" /> Thinking…
      </span>
    ) : null;
  }
  return (
    <div className="text-xs">
      <Disclosure summary={thinking ? "Thinking…" : "How it worked this out"} icon={thinking ? <Loader size="sm" /> : <LightbulbIcon size={14} aria-hidden="true" />}>
        <Working label="Thinking">{turn.reasoning}</Working>
      </Disclosure>
    </div>
  );
}

/** The datasets the answer read, by name, each a link to its page. */
function Sources({ slugs }: { slugs: string[] }) {
  const products = useQuery(slugs.length ? "products" : null, fetchProducts);
  if (!slugs.length) return null;
  const titleOf = (slug: string) => products.data?.find((product) => product.slug === slug)?.title ?? slug;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="flex items-center gap-1 text-kumo-subtle">
        <DatabaseIcon size={14} aria-hidden="true" /> Read
      </span>
      {slugs.map((slug) => (
        <a
          key={slug}
          href={productHref(slug)}
          className="max-w-full truncate rounded-full border border-kumo-line px-2 py-0.5 text-kumo-default no-underline hover:border-kumo-brand hover:text-kumo-strong"
        >
          {titleOf(slug)}
        </a>
      ))}
    </div>
  );
}

/** Copies the answer's Markdown, and says so for a moment. */
function CopyAnswer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };
  return (
    <Button variant="ghost" size="xs" icon={copied ? <CheckIcon /> : <CopyIcon />} onClick={copy} aria-label={copied ? "Copied" : "Copy the answer"} title="Copy the answer">
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

interface AnswerProps {
  turn: AssistantTurn | undefined;
  /** Asks the same question again: after a failure, or for another answer to the last one. */
  onRetry: (() => void) | undefined;
}

export function Answer({ turn, onRetry }: AnswerProps) {
  if (!turn) return null;
  const finished = turn.done && !turn.error && turn.text !== "";
  return (
    <div className="grid gap-3">
      <Reasoning turn={turn} />
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
      {turn.notice ? <p className="text-xs text-kumo-subtle">{turn.notice}</p> : null}
      {turn.error ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-sm text-kumo-danger">{turn.error}</p>
          {onRetry ? (
            <Button variant="secondary" size={CONTROL_SIZE} onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : null}
      {turn.done ? <Sources slugs={turn.datasets} /> : null}
      {finished ? (
        <div className="-ml-2 flex flex-wrap items-center gap-1">
          <CopyAnswer text={turn.text} />
          {onRetry ? (
            <Button variant="ghost" size="xs" icon={<ArrowClockwiseIcon />} onClick={onRetry} title="Ask the same question again">
              Ask again
            </Button>
          ) : null}
          <span className="ml-auto pr-1 text-xs text-kumo-subtle">{cost(turn)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** What the answer cost the visitor, in the unit their provider bills. */
function cost(turn: AssistantTurn): string {
  if (turn.neurons > 0) return `About ${fmt.int(Math.ceil(turn.neurons))} neurons of your Workers AI`;
  if (turn.tokens > 0) return `${fmt.int(turn.tokens)} tokens of your Copilot`;
  return "";
}
