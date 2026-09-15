// A feed's health in one word, from its runner's clock: the same judgement the old status script made.

import { Badge } from "@cloudflare/kumo";
import type { Feed } from "../../lib/types";
import type { StatusBadge } from "./runs";

export type Health = "Paused" | "Collecting" | "Never succeeded" | "Never run" | "Stale" | "Retrying" | "Healthy";

/** The word behind the badge, so the column can be sorted and filtered by it. */
export function feedHealth(feed: Feed, now: number): Health {
  if (!feed.enabled) return "Paused";
  if (feed.running) return "Collecting";
  if (!feed.lastSuccessAt) return feed.lastAttemptAt ? "Never succeeded" : "Never run";
  if ((now - new Date(feed.lastSuccessAt).getTime()) / 1000 > feed.staleAfterSeconds) return "Stale";
  if (feed.lastAcquisitionStatus === "failed") return "Retrying";
  return "Healthy";
}

const HEALTH_BADGE = {
  Paused: "neutral",
  Collecting: "info",
  "Never run": "neutral",
  "Never succeeded": "error",
  Stale: "warning",
  Retrying: "warning",
  Healthy: "success",
} satisfies { [health in Health]: StatusBadge };

export function healthLabel(feed: Feed, health: Health) {
  if (health === "Retrying") return `Retrying (${feed.consecutiveFailures ?? 1})`;
  return health;
}

/** The bare word, for counts across feeds where no single feed's detail belongs. */
export function HealthWord({ health }: { health: Health }) {
  return (
    <Badge variant={HEALTH_BADGE[health]} appearance="dot">
      {health}
    </Badge>
  );
}

export function HealthBadge({ feed, health }: { feed: Feed; health: Health }) {
  return (
    <Badge variant={HEALTH_BADGE[health]} appearance="dot">
      {healthLabel(feed, health)}
    </Badge>
  );
}
