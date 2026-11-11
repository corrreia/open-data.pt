import { Banner, Button, Loader } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, ArrowUpIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { COMPASS } from "./format.ts";
import { css } from "./scales.ts";

/** What a read from open-data.pt is doing: still out, back, or failed. */
export type Read<Data> = { state: "loading" } | { state: "ready"; data: Data } | { state: "failed"; message: string; retry: () => void };

/** Reads once when shown, and again when asked to after a failure. */
export function useRead<Data>(read: () => Promise<Data>): Read<Data> {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Read<Data>>({ state: "loading" });
  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  useEffect(() => {
    let current = true;
    setResult({ state: "loading" });
    read().then(
      (data) => current && setResult({ state: "ready", data }),
      (error: Error) => current && setResult({ state: "failed", message: error.message, retry }),
    );
    return () => {
      current = false;
    };
    // The read is the section's own and does not change while it is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  return result;
}

export function Pending(props: { what: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-6 text-sm text-kumo-subtle">
      <Loader size="sm" /> A ler {props.what}…
    </p>
  );
}

export function Failed(props: { what: string; message: string; retry: () => void }) {
  return (
    <div className="grid justify-items-start gap-3 py-4">
      <Banner
        variant="error"
        icon={<WarningCircleIcon weight="fill" />}
        title={`Não foi possível ler ${props.what}`}
        description={`${props.message}. Verifique a ligação e tente de novo.`}
      />
      <Button variant="secondary" icon={<ArrowClockwiseIcon />} onClick={props.retry}>
        Tentar de novo
      </Button>
    </div>
  );
}

/** Says there is nothing to show, and why. */
export function Nothing(props: { children: ReactNode }) {
  return <p className="rounded-lg bg-kumo-recessed px-4 py-3 text-sm text-kumo-subtle">{props.children}</p>;
}

/** A section's title and what it holds. The title is the page's heading. */
export function Heading(props: { title: string; children?: ReactNode }) {
  return (
    <header className="grid gap-2">
      <h1 className="text-2xl font-bold tracking-tight text-kumo-strong">{props.title}</h1>
      {props.children ? <p className="max-w-[60ch] text-sm text-kumo-subtle">{props.children}</p> : null}
    </header>
  );
}

export function Subheading(props: { children: ReactNode }) {
  return <h2 className="mt-2 text-base font-semibold text-kumo-strong">{props.children}</h2>;
}

/** A level named in words on its own colour: the colour is IPMA's, the word is what says it. */
export function Level(props: { colour: number; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium text-kumo-default">
      <span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-black/30" style={{ background: css(props.colour) }} />
      {props.children}
    </span>
  );
}

/** An arrow pointing where something that comes from a compass point is going, read out as where it comes from. */
export function From(props: { point: string | null; className?: string }) {
  const from = COMPASS.get(props.point ?? "");
  if (from === undefined) return null;
  return (
    <ArrowUpIcon
      weight="bold"
      role="img"
      aria-label={`de ${from.name}`}
      className={`inline-block shrink-0 ${props.className ?? ""}`}
      style={{ rotate: `${from.degrees + 180}deg` }}
    />
  );
}
