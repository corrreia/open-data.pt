import { productHref } from "../lib/api";
import { ROLE, withoutPublisher, type Listing } from "../lib/catalog";
import { fmt } from "../lib/format";
import { ROLE_COLOR, ROLE_ICON, RelativeTime } from "./common";

const TONE_DOT = { ok: "bg-kumo-success", warn: "bg-kumo-warning", bad: "bg-kumo-danger" } as const;
const TONE_WORD = { ok: "Current", warn: "Late", bad: "Failing" } as const;

function size(listing: Listing): string {
  if (listing.empty) return "empty";
  const series = listing.role === "time-series";
  return `${fmt.compact(listing.rows)}${series && listing.rows >= 5000 ? "+" : ""} ${series ? "pts" : "rows"}`;
}

/**
 * Tables and series as rows: what each is, what kind of data, how big, how
 * often it changes, and how fresh it is. Under a publisher's heading a row
 * drops the publisher's name from its title; elsewhere it names them.
 */
export function ListingRows({ listings, underPublisher = false }: { listings: Listing[]; underPublisher?: boolean }) {
  return (
    <ul className="divide-y divide-kumo-line overflow-hidden rounded-xl bg-kumo-elevated ring-1 ring-kumo-line">
      {listings.map((listing) => {
        const Icon = ROLE_ICON[listing.role];
        return (
          <li
            key={listing.id}
            className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 px-4 py-2.5 transition-colors hover:bg-kumo-tint/60 md:grid-cols-[minmax(0,1fr)_7.5rem_6rem_6rem_7.5rem] md:items-center"
          >
            <div className="min-w-0">
              <a href={productHref(listing.id)} className="line-clamp-2 text-sm font-semibold text-pretty text-kumo-strong no-underline hover:underline" title={listing.title}>
                {underPublisher ? withoutPublisher(listing) : listing.title}
                {underPublisher ? null : <span className="font-normal text-kumo-subtle"> · {listing.publisher.name}</span>}
              </a>
              <p className="truncate text-xs text-kumo-subtle" title={listing.description}>
                {listing.description}
              </p>
            </div>
            {/* On a phone these four wrap onto one line under the title; from md up each is a column. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-kumo-default">
                <Icon aria-hidden="true" size={14} weight="fill" className="shrink-0" style={{ color: ROLE_COLOR[listing.role] }} />
                {ROLE[listing.role].label}
              </span>
              <span className="whitespace-nowrap font-mono text-xs text-kumo-subtle md:text-right">{size(listing)}</span>
              <span className="whitespace-nowrap text-xs text-kumo-subtle">{fmt.every(listing.cadence)}</span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-kumo-subtle" title={TONE_WORD[listing.tone]}>
                <span className={`size-2 shrink-0 rounded-full ${TONE_DOT[listing.tone]}`} role="img" aria-label={TONE_WORD[listing.tone]} />
                {listing.updatedAt ? <RelativeTime value={listing.updatedAt} className="font-mono" /> : "never"}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
