import { Button } from "@cloudflare/kumo";
import { ArrowsOutIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { MapLayer } from "../stage.tsx";
import { decodeTerrain, decodeWater, type TerrainManifest, type WaterManifest } from "../terrain/format.ts";
import { createMap, type MapScene } from "./scene.ts";

/**
 * The map and what a section has pinned to it. The marks are part of the page, kept over their
 * places as the map moves: sharp at any zoom, and pressable. Whatever a mark says is also in the
 * section's table, so the keyboard's way to it is the table, and the marks stay out of the tab order.
 */

async function openMap(canvas: HTMLCanvasElement): Promise<MapScene> {
  const [about, bytes] = await Promise.all([fetch("/terrain.json"), fetch("/terrain.bin")]);
  if (!about.ok || !bytes.ok) throw new Error(`o terreno respondeu ${about.status} e ${bytes.status}`);
  // SAFETY: terrain.json is written by bake.ts from a TerrainManifest and ships beside this script.
  const map = createMap(canvas, decodeTerrain((await about.json()) as TerrainManifest, await bytes.arrayBuffer()));
  // Rivers and lagoons are baked like the terrain; a build without them still draws everything else.
  const [aboutWater, waterBytes] = await Promise.all([fetch("/water.json"), fetch("/water.bin")]);
  if (aboutWater.ok && waterBytes.ok && aboutWater.headers.get("content-type")?.includes("json") === true) {
    // SAFETY: water.json is written by bake.ts from a WaterManifest and ships beside this script.
    map.addWater(decodeWater((await aboutWater.json()) as WaterManifest, await waterBytes.arrayBuffer()));
  }
  return map;
}

export function MapView(props: { layer: MapLayer }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapScene>();
  const [failure, setFailure] = useState<string>();
  const [said, setSaid] = useState("");
  const { marks, paint, legend } = props.layer;

  useEffect(() => {
    if (canvas.current === null) return;
    let current = true;
    openMap(canvas.current).then(
      (opened) => current && setMap(opened),
      (error: Error) => current && setFailure(error.message),
    );
    return () => {
      current = false;
    };
  }, []);

  // Lit as the sun stands, and drawn for the page's own light or dark.
  useEffect(() => {
    if (map === undefined) return;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const light = (): void => {
      map.light(new Date());
      map.setDark(dark.matches);
    };
    light();
    dark.addEventListener("change", light);
    const timer = setInterval(light, 60_000);
    return () => {
      dark.removeEventListener("change", light);
      clearInterval(timer);
    };
  }, [map]);

  useEffect(() => map?.paint(paint), [map, paint]);
  useEffect(() => setSaid(""), [marks]);

  // Marks are given most important first. One that would cover a mark already placed waits until
  // the map is zoomed in far enough for both to fit; dots are let touch.
  useEffect(() => {
    if (map === undefined) return;
    const place = (): void => {
      const taken: [left: number, top: number, right: number, bottom: number][] = [];
      const elements = overlay.current?.children ?? [];
      marks.forEach((mark, index) => {
        const element = elements[index];
        if (!(element instanceof HTMLElement)) return;
        const at = map.toScreen(mark.longitude, mark.latitude);
        if (at === undefined) {
          element.style.visibility = "hidden";
          return;
        }
        const halfWide = element.offsetWidth / 2;
        const halfTall = element.offsetHeight / 2;
        const box: [number, number, number, number] = [at[0] - halfWide, at[1] - halfTall, at[0] + halfWide, at[1] + halfTall];
        const crowded = halfWide > 9 && taken.some((other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]);
        element.style.visibility = crowded ? "hidden" : "visible";
        if (crowded) return;
        taken.push(box);
        element.style.translate = `${at[0].toFixed(1)}px ${at[1].toFixed(1)}px`;
      });
    };
    place();
    return map.onMove(place);
  }, [map, marks]);

  return (
    <section aria-label="Mapa" className="flex min-h-0 flex-col">
      <div className="relative h-[52dvh] min-h-72 overflow-hidden lg:h-auto lg:flex-1">
        <canvas
          ref={canvas}
          aria-label="Mapa de Portugal continental em relevo. Arraste para mover, use a roda ou dois dedos para aproximar; as setas do teclado também movem."
          tabIndex={0}
          className="absolute inset-0 block size-full cursor-grab touch-none active:cursor-grabbing"
        />
        <div ref={overlay} className="pointer-events-none absolute inset-0 overflow-hidden">
          {marks.map((mark) => (
            <button
              key={mark.id}
              type="button"
              tabIndex={-1}
              aria-label={mark.detail}
              onClick={() => {
                setSaid(mark.detail);
                mark.onSelect?.();
              }}
              // A mark smaller than a fingertip still takes a fingertip: its hit area reaches past what is drawn.
              className="pointer-events-auto absolute top-0 left-0 -translate-1/2 cursor-pointer whitespace-nowrap before:absolute before:top-1/2 before:left-1/2 before:size-full before:min-h-7 before:min-w-7 before:-translate-1/2"
              style={{ visibility: "hidden" }}
            >
              {mark.node}
            </button>
          ))}
        </div>
        <div className="absolute top-3 left-3">
          <Button variant="secondary" size="sm" icon={<ArrowsOutIcon />} disabled={map === undefined} onClick={() => map?.home()}>
            Ver o país inteiro
          </Button>
        </div>
        {failure === undefined ? null : (
          <p className="absolute inset-0 grid place-items-center bg-kumo-recessed p-6 text-center text-sm text-kumo-subtle">
            Não foi possível desenhar o mapa: {failure}. As tabelas ao lado têm os mesmos dados.
          </p>
        )}
      </div>
      <div className="grid gap-1 border-t border-kumo-line bg-kumo-elevated px-4 py-3 text-sm text-kumo-subtle">
        {legend}
        {/* Always here, and empty until a mark is pressed, so that what it then says is announced. */}
        <p role="status" className="min-h-5 font-medium text-kumo-default">
          {said}
        </p>
      </div>
    </section>
  );
}
