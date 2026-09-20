// A publisher's mark, or their initials when we have no mark: the same height either
// way, so a wall of publishers reads evenly however many of them sent us a logo.

import { hueOf, initials } from "../lib/publisher-mark";
import type { Term } from "../lib/types";

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
