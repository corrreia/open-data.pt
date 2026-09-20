// A publisher's mark, or their initials when we have no mark: the same height either
// way, so a wall of publishers reads evenly however many of them sent us a logo.

import { useState } from "react";
import { hueOf, initials } from "../lib/publisher-mark";
import type { Term } from "../lib/types";
import { useDarkMode } from "./common";

/**
 * Marks are drawn on a white tile in both colour modes, because a publisher's
 * wordmark was drawn for their own white page and nothing else is safe for all
 * of them at once. The tile keeps one height and widens for a wordmark, so a
 * crest and a wordmark sit on the same line without either being shrunk to fit
 * the other's shape. `tests/publisher-logos.test.ts` keeps the files from being
 * wider than the tile can show.
 */
export function PublisherMark({ publisher, size = 40, className = "" }: { publisher: Term; size?: number; className?: string }) {
  if (!publisher.logo) {
    const colour = hueOf(publisher.id);
    const monogram = initials(publisher.name);
    return (
      <span
        aria-hidden="true"
        className={`inline-grid shrink-0 place-items-center rounded-lg font-display font-semibold tracking-tight ${className}`}
        style={{
          width: size,
          height: size,
          color: colour,
          backgroundColor: `color-mix(in srgb, ${colour} 14%, transparent)`,
          // A five-letter acronym has to be set smaller than a single letter to fit the same square.
          fontSize: Math.round(size * (0.44 - 0.046 * monogram.length)),
        }}
      >
        {monogram}
      </span>
    );
  }
  return (
    <span
      className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-lg bg-white px-1 ring-1 ring-kumo-line ring-inset ${className}`}
      style={{ height: size, minWidth: size, maxWidth: Math.round(size * 2.6) }}
    >
      <img src={publisher.logo} alt="" loading="lazy" decoding="async" className="max-w-full object-contain" style={{ maxHeight: Math.round(size * 0.7) }} />
    </span>
  );
}

/**
 * The mark again, large and nearly invisible, as the background of whatever card or
 * header it is put in. It is decoration and never the only place the publisher is
 * named: drawn grey so it never competes with the words over it, inverted on a dark
 * page so a dark mark does not vanish into it, and dropped for the few raster marks
 * so small that drawing them this large would read as an artefact rather than as
 * texture. Its parent needs `relative isolate overflow-hidden`, so that it is
 * clipped and stays behind the text.
 */
/** Under this many pixels tall a raster mark blurs into a smear rather than a faint mark. */
const LEGIBLE_SOURCE = 48;

export function PublisherWatermark({ publisher, height }: { publisher: Term; height: number }) {
  const dark = useDarkMode();
  const [tooSmall, setTooSmall] = useState(false);
  if (!publisher.logo || tooSmall) return null;
  return (
    <img
      src={publisher.logo}
      alt=""
      aria-hidden="true"
      onLoad={(event) => {
        const drawn = event.currentTarget;
        if (drawn.src.endsWith(".png") && drawn.naturalHeight < LEGIBLE_SOURCE) setTooSmall(true);
      }}
      className="pointer-events-none absolute top-1/2 -z-10 hidden -translate-y-1/2 object-contain opacity-[0.07] sm:block"
      style={{ height, maxWidth: "62%", right: -Math.round(height / 14), filter: dark ? "grayscale(1) invert(1)" : "grayscale(1)" }}
    />
  );
}
