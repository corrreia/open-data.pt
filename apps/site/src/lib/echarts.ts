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

// Every chart on the site goes through this instance, Kumo's included: with reduced motion asked for,
// no chart draws itself in, and none replays that entrance when its data or theme changes.
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
echarts.registerPreprocessor((option) => {
  if (reducedMotion.matches) option.animation = false;
});

export { echarts };
