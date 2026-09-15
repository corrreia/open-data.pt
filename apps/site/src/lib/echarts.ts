// ECharts core with only the pieces the site's charts use; Kumo's chart components take this instance.
import { BarChart, LineChart, MapChart, ScatterChart } from "echarts/charts";
import { AriaComponent, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([LineChart, BarChart, ScatterChart, MapChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, MarkLineComponent, AriaComponent, VisualMapComponent, CanvasRenderer]);

export { echarts };

