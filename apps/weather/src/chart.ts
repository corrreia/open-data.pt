import type { SeriesPoint } from "./api.ts";

/**
 * A small line chart of one series over time: its lowest and highest values named on the left,
 * its first and last times underneath. Enough to see a day's temperature rise and fall.
 */

const SVG = "http://www.w3.org/2000/svg";
const WIDTH = 320;
const HEIGHT = 96;
const LEFT = 38;
const BOTTOM = 16;

function part(tag: string, className: string): SVGElement {
  const made = document.createElementNS(SVG, tag);
  made.setAttribute("class", className);
  return made;
}

export function lineChart(points: readonly SeriesPoint[], bars: boolean, timeLabel: (time: string) => string): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute("class", "chart");
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return svg;
  const values = points.map((point) => point.value);
  const low = bars ? 0 : Math.min(...values);
  const high = Math.max(...values, low + 1e-6);
  const start = Date.parse(first.eventTime);
  const span = Math.max(1, Date.parse(last.eventTime) - start);
  // Bars are as wide as their share of the chart, so the first and last are set in by half of one.
  const inset = bars ? (WIDTH - LEFT - 6) / points.length / 2 : 0;
  const x = (time: string): number => LEFT + inset + ((Date.parse(time) - start) / span) * (WIDTH - LEFT - 6 - inset * 2);
  const y = (value: number): number => 6 + (1 - (value - low) / (high - low)) * (HEIGHT - BOTTOM - 12);

  for (const [value, at] of [
    [high, y(high)],
    [low, y(low)],
  ] as const) {
    const rule = part("line", "rule");
    rule.setAttribute("x1", String(LEFT));
    rule.setAttribute("x2", String(WIDTH));
    rule.setAttribute("y1", String(at));
    rule.setAttribute("y2", String(at));
    const label = part("text", "figure");
    label.setAttribute("x", String(LEFT - 5));
    label.setAttribute("y", String(at + 3.5));
    label.setAttribute("text-anchor", "end");
    label.textContent = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 }).format(value);
    svg.append(rule, label);
  }

  if (bars) {
    const width = Math.max(1.5, inset * 2 - 2);
    for (const point of points) {
      const bar = part("rect", "bar");
      bar.setAttribute("x", String(x(point.eventTime) - width / 2));
      bar.setAttribute("y", String(y(point.value)));
      bar.setAttribute("width", String(width));
      bar.setAttribute("height", String(Math.max(0, y(0) - y(point.value))));
      svg.append(bar);
    }
  } else {
    const line = part("polyline", "line");
    line.setAttribute("points", points.map((point) => `${x(point.eventTime).toFixed(1)},${y(point.value).toFixed(1)}`).join(" "));
    svg.append(line);
  }

  for (const [point, anchor] of [
    [first, "start"],
    [last, "end"],
  ] as const) {
    const label = part("text", "figure");
    label.setAttribute("x", String(anchor === "start" ? LEFT : WIDTH - 6));
    label.setAttribute("y", String(HEIGHT - 3));
    label.setAttribute("text-anchor", anchor);
    label.textContent = timeLabel(point.eventTime);
    svg.append(label);
  }
  return svg;
}
