import type { SeriesPoint } from "./api.ts";
import { format } from "./format.ts";

/**
 * A small chart of one series over time: a line for a state, bars for sums. Its lowest and highest
 * values are named on the left and its first and last times underneath, and all four are said in
 * words to whoever cannot see it.
 */

const WIDTH = 360;
const HEIGHT = 132;
const LEFT = 44;
const BOTTOM = 22;

export function Chart(props: { points: readonly SeriesPoint[]; bars: boolean; unit: string; name: string; time: (time: string) => string }) {
  const { points, bars } = props;
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return null;
  const values = points.map((point) => point.value);
  const low = bars ? 0 : Math.min(...values);
  const high = Math.max(...values, low + 1e-6);
  const start = Date.parse(first.eventTime);
  const span = Math.max(1, Date.parse(last.eventTime) - start);
  // Bars are as wide as their share of the chart, so the first and last are set in by half of one.
  const inset = bars ? (WIDTH - LEFT - 6) / points.length / 2 : 0;
  const x = (time: string): number => LEFT + inset + ((Date.parse(time) - start) / span) * (WIDTH - LEFT - 6 - inset * 2);
  const y = (value: number): number => 8 + (1 - (value - low) / (high - low)) * (HEIGHT - BOTTOM - 16);
  const summary = `${props.name}, de ${props.time(first.eventTime)} a ${props.time(last.eventTime)}: entre ${format.measure(Math.min(...values), props.unit)} e ${format.measure(Math.max(...values), props.unit)}; último valor ${format.measure(last.value, props.unit)}.`;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={summary} className="block h-auto w-full max-w-md text-kumo-subtle">
      {[high, low].map((value) => (
        <g key={value}>
          <line x1={LEFT} x2={WIDTH} y1={y(value)} y2={y(value)} className="stroke-kumo-line" />
          <text x={LEFT - 6} y={y(value) + 4} textAnchor="end" className="fill-current text-[12px] tabular-nums">
            {format.number(value)}
          </text>
        </g>
      ))}
      {bars ? (
        points.map((point) => (
          <rect
            key={point.eventTime}
            x={x(point.eventTime) - Math.max(0.75, inset - 1)}
            y={y(point.value)}
            width={Math.max(1.5, inset * 2 - 2)}
            height={Math.max(0, y(0) - y(point.value))}
            className="fill-kumo-brand"
          />
        ))
      ) : (
        <polyline
          points={points.map((point) => `${x(point.eventTime).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ")}
          fill="none"
          strokeWidth="2"
          strokeLinejoin="round"
          className="stroke-kumo-brand"
        />
      )}
      <text x={LEFT} y={HEIGHT - 5} className="fill-current text-[12px] tabular-nums">
        {props.time(first.eventTime)}
      </text>
      <text x={WIDTH - 6} y={HEIGHT - 5} textAnchor="end" className="fill-current text-[12px] tabular-nums">
        {props.time(last.eventTime)}
      </text>
    </svg>
  );
}
