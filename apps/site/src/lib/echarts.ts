// ECharts core with only the pieces the site's charts use; Kumo's chart components take this instance.
import { BarChart, LineChart, MapChart, ScatterChart } from "echarts/charts";
import { AriaComponent, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  MapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  AriaComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

/**
 * One tooltip for every chart. Kumo's own charts draw theirs on the site's surface with its border
 * and radius; a chart built from plain ECharts options would otherwise show the library's default
 * white box in a different typeface. These are style keys only: each chart keeps its own trigger,
 * formatter and axis pointer. The values are CSS variables, resolved against the chart's container,
 * so the tooltip follows the colour mode.
 */
const TOOLTIP_STYLE = {
  backgroundColor: "var(--color-kumo-base)",
  borderColor: "var(--color-kumo-line)",
  borderWidth: 1,
  padding: [8, 10],
  extraCssText: "border-radius: 0.5rem; box-shadow: 0 4px 6px -1px oklch(0.2 0.02 160 / 0.12), 0 2px 4px -2px oklch(0.2 0.02 160 / 0.1);",
  textStyle: { color: "var(--text-color-kumo-default)", fontFamily: "var(--font-sans)", fontSize: 12 },
};

/** The parts of an ECharts option this file reads; every other key is left as the chart wrote it. */
interface StyledTooltip {
  textStyle?: { [key: string]: string | number };
}

interface StyledOption {
  animation?: boolean;
  tooltip?: StyledTooltip | StyledTooltip[];
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Every chart on the site goes through this instance, Kumo's included: with reduced motion asked for,
// no chart draws itself in, and none replays that entrance when its data or theme changes.
echarts.registerPreprocessor((raw) => {
  // SAFETY: ECharts hands the preprocessor the option object the chart passed; these are the keys this file sets.
  const option = raw as StyledOption;
  if (reducedMotion.matches) option.animation = false;
  const tooltips = option.tooltip === undefined ? [] : Array.isArray(option.tooltip) ? option.tooltip : [option.tooltip];
  for (const tooltip of tooltips) Object.assign(tooltip, TOOLTIP_STYLE, { textStyle: { ...TOOLTIP_STYLE.textStyle, ...tooltip.textStyle } });
});

export { echarts };
