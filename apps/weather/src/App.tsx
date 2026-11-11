import { TooltipProvider } from "@cloudflare/kumo";
import { type ComponentType, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { format, lisbonToday } from "./format.ts";
import { Climate } from "./sections/Climate.tsx";
import { Earth } from "./sections/Earth.tsx";
import { Forecast } from "./sections/Forecast.tsx";
import { Indices } from "./sections/Indices.tsx";
import { Observations } from "./sections/Observations.tsx";
import { Sea } from "./sections/Sea.tsx";
import { Warnings } from "./sections/Warnings.tsx";
import { type MapLayer, type Stage, StageContext } from "./stage.tsx";

/** The site's sections, in the order of its navigation: one for each kind of thing IPMA publishes. */
const SECTIONS: { path: string; name: string; Show: ComponentType }[] = [
  { path: "", name: "Previsão", Show: Forecast },
  { path: "avisos", name: "Avisos", Show: Warnings },
  { path: "observacoes", name: "Observações", Show: Observations },
  { path: "mar", name: "Mar", Show: Sea },
  { path: "indices", name: "UV e incêndio", Show: Indices },
  { path: "sismos-e-trovoada", name: "Sismos e trovoada", Show: Earth },
  { path: "ultimas-semanas", name: "Últimas semanas", Show: Climate },
];

// The map brings three.js with it, half of what the page weighs: the tables do not wait for it.
const MapView = lazy(async () => ({ default: (await import("./map/MapView.tsx")).MapView }));

const EMPTY: MapLayer = { marks: [], legend: null };
const pathNow = (): string => window.location.hash.replace(/^#\/?/u, "");

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <time dateTime={now.toISOString()} className="hidden text-sm whitespace-nowrap text-kumo-subtle tabular-nums sm:block">
      {format.now(now)}
    </time>
  );
}

export function App() {
  const [path, setPath] = useState(pathNow);
  const [layer, setLayer] = useState<MapLayer>(EMPTY);
  const content = useRef<HTMLElement>(null);
  const section = SECTIONS.find((each) => each.path === path) ?? SECTIONS[0];
  const stage = useMemo<Stage>(() => ({ today: lisbonToday(), setLayer }), []);

  useEffect(() => {
    const follow = (): void => {
      setPath(pathNow());
      // A new section starts at its top, and whoever is reading by ear or by key starts there too.
      setLayer(EMPTY);
      content.current?.scrollTo({ top: 0 });
      content.current?.focus({ preventScroll: true });
    };
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  useEffect(() => {
    if (section !== undefined) document.title = `${section.name} · Tempo em Portugal`;
  }, [section]);

  if (section === undefined) return null;
  return (
    <TooltipProvider>
      <StageContext.Provider value={stage}>
        <div className="flex min-h-dvh flex-col lg:h-dvh">
          <a
            href="#conteudo"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-20 focus:rounded-md focus:bg-kumo-base focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
          >
            Saltar para o conteúdo
          </a>
          <header className="border-b border-kumo-line bg-kumo-base">
            <div className="flex items-center justify-between gap-4 px-4 pt-3 lg:px-6">
              <a href="#/" className="text-lg font-bold tracking-tight text-kumo-strong no-underline [font-stretch:112%]">
                Tempo em Portugal
              </a>
              <Clock />
            </div>
            <nav aria-label="Secções" className="scroll-fade overflow-x-auto">
              <ul className="flex gap-1 px-2 lg:px-4">
                {SECTIONS.map((each) => {
                  const here = each === section;
                  return (
                    <li key={each.path}>
                      <a
                        href={`#/${each.path}`}
                        aria-current={here ? "page" : undefined}
                        className={`flex min-h-11 items-center border-b-2 px-2.5 text-sm font-medium whitespace-nowrap no-underline -outline-offset-2 ${here ? "border-kumo-brand text-kumo-brand" : "border-transparent text-kumo-subtle hover:text-kumo-strong"}`}
                      >
                        {each.name}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </header>

          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(26rem,34rem)]">
            <Suspense fallback={<div role="status" aria-label="A abrir o mapa" className="h-[52dvh] min-h-72 bg-kumo-recessed lg:h-auto" />}>
              <MapView layer={layer} />
            </Suspense>
            <main id="conteudo" ref={content} tabIndex={-1} className="min-h-0 border-kumo-line bg-kumo-base outline-none lg:overflow-y-auto lg:border-l">
              <div className="grid gap-5 px-4 py-6 lg:px-6">
                <section.Show key={section.path} />
              </div>
            </main>
          </div>

          <footer className="flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-kumo-line bg-kumo-base px-4 py-3 text-xs text-kumo-subtle lg:px-6">
            <p className="max-w-[80ch]">
              Dados do Instituto Português do Mar e da Atmosfera, lidos em{" "}
              <a className="text-kumo-link underline" href="https://open-data.pt/">
                open-data.pt
              </a>
              . Este site não é do IPMA: para decisões que dependam do tempo, consulte{" "}
              <a className="text-kumo-link underline" href="https://www.ipma.pt/">
                ipma.pt
              </a>
              .
            </p>
            <a className="text-kumo-link underline" href="/credits/">
              Ver fontes e créditos
            </a>
          </footer>
        </div>
      </StageContext.Provider>
    </TooltipProvider>
  );
}
