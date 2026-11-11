import { Tabs } from "@cloudflare/kumo";
import { format } from "../format.ts";

/** The days a forecast covers, as tabs: today, tomorrow, and the days after by name. */
export function Days(props: { dates: readonly string[]; today: string; value: string; onChange: (date: string) => void }) {
  return (
    <Tabs
      variant="segmented"
      value={props.value}
      onValueChange={(value) => props.onChange(String(value))}
      tabs={props.dates.map((date) => ({ value: date, label: format.day(date, props.today) }))}
    />
  );
}

/** The dates in a list of forecasts from today on, oldest first. */
export function datesFrom(dates: readonly string[], today: string): string[] {
  return [...new Set(dates)].filter((date) => date >= today).toSorted();
}
