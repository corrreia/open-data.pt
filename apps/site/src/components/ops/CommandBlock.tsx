import { Button } from "@cloudflare/kumo";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

/** Copies `text` to the clipboard; `copied` stays true for a moment afterwards. */
export function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };
  return { copied, copy };
}

/**
 * A shell command a reader can copy. `highlight` marks the part they are meant to change, such as a
 * product slug. Kumo's own Code blocks are deprecated and do not highlight, so this is a plain `pre`.
 */
export function CommandBlock({ command, highlight, label }: { command: string; highlight?: string; label?: string }) {
  const { copied, copy } = useCopy(command);
  const at = highlight ? command.indexOf(highlight) : -1;

  return (
    <div className="relative min-w-0 rounded-lg bg-kumo-recessed ring-1 ring-kumo-line">
      {/* Long commands wrap, so the whole line is readable on a phone without scrolling. */}
      <pre className="whitespace-pre-wrap py-3 pl-4 pr-12 font-mono text-[0.8rem] leading-relaxed text-kumo-default [overflow-wrap:anywhere]">
        <code>
          <span aria-hidden="true" className="select-none text-kumo-subtle">
            ${" "}
          </span>
          {highlight && at >= 0 ? (
            <>
              {command.slice(0, at)}
              <mark className="rounded bg-kumo-base px-0.5 font-medium text-kumo-brand">{highlight}</mark>
              {command.slice(at + highlight.length)}
            </>
          ) : (
            command
          )}
        </code>
      </pre>
      {/* Icon only; the text is for screen readers (Kumo's square variant trips the repo's naming rule). */}
      <Button variant="ghost" size="sm" icon={copied ? <CheckIcon /> : <CopyIcon />} onClick={copy} className="absolute right-1.5 top-1.5 gap-0 px-1.5">
        <span className="sr-only" aria-live="polite">{copied ? "Copied" : `Copy ${label ?? "command"}`}</span>
      </Button>
    </div>
  );
}
